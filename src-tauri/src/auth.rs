//! Google OAuth 2.0 for installed apps: PKCE, system browser, loopback redirect.
//! Refresh tokens are kept in the Keychain; access tokens only in memory.

use crate::config::GoogleClient;
use crate::error::{Error, Result};
use crate::secrets;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, SystemTime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
pub const SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
];
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    error_description: Option<String>,
}

pub struct SignIn {
    pub refresh_token: String,
    pub access_token: String,
    pub expires_in: u64,
}

fn random_b64(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::fill(&mut bytes[..]);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Runs the browser sign-in flow. `open` launches the system browser with the URL.
pub async fn sign_in(
    http: &reqwest::Client,
    client: &GoogleClient,
    login_hint: Option<&str>,
    open: impl FnOnce(&str) -> Result<()>,
) -> Result<SignIn> {
    let verifier = random_b64(48);
    let state = random_b64(16);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let redirect_uri = format!("http://127.0.0.1:{}", listener.local_addr()?.port());

    let mut url = url::Url::parse(AUTH_URL).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", &client.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &SCOPES.join(" "))
        .append_pair("code_challenge", &pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    if let Some(hint) = login_hint {
        url.query_pairs_mut().append_pair("login_hint", hint);
    }
    open(url.as_str())?;

    let code = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(&listener, &state))
        .await
        .map_err(|_| Error::Auth("timed out waiting for the browser".into()))??;

    let tokens: TokenResponse = token_request(
        http,
        &[
            ("code", code.as_str()),
            ("client_id", &client.client_id),
            ("client_secret", &client.client_secret),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
            ("code_verifier", &verifier),
        ],
    )
    .await?;
    let refresh_token = tokens
        .refresh_token
        .ok_or_else(|| Error::Auth("Google didn't return a refresh token".into()))?;
    Ok(SignIn { refresh_token, access_token: tokens.access_token, expires_in: tokens.expires_in })
}

/// Accepts loopback requests until one carries the authorization code (or an error).
async fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String> {
    loop {
        let (mut stream, _) = listener.accept().await?;
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let Some(params) = parse_callback(&request) else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
            continue;
        };
        let (ok, result) = match (params.get("code"), params.get("error")) {
            (_, Some(err)) => (false, Err(Error::Auth(err.clone()))),
            (Some(_), _) if params.get("state").map(String::as_str) != Some(state) => {
                (false, Err(Error::Auth("state mismatch".into())))
            }
            (Some(code), _) => (true, Ok(code.clone())),
            _ => continue,
        };
        let body = if ok {
            "<h2>Signed in to Chaucer.</h2><p>You can close this tab and return to the app.</p>"
        } else {
            "<h2>Sign-in didn't complete.</h2><p>Return to Chaucer and try again.</p>"
        };
        let page = format!(
            "<!doctype html><meta charset=utf-8><body style=\"font-family:-apple-system,sans-serif;padding:48px\">{body}</body>"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
            page.len()
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return result;
    }
}

/// Parses the query string of a `GET /?…` request line; None for other paths.
pub fn parse_callback(request: &str) -> Option<HashMap<String, String>> {
    let target = request.lines().next()?.split_whitespace().nth(1)?;
    let url = url::Url::parse(&format!("http://localhost{target}")).ok()?;
    if url.path() != "/" {
        return None;
    }
    Some(url.query_pairs().into_owned().collect())
}

async fn token_request<T: for<'de> Deserialize<'de>>(
    http: &reqwest::Client,
    form: &[(&str, &str)],
) -> Result<T> {
    let resp = http.post(TOKEN_URL).form(form).send().await?;
    if resp.status().is_success() {
        return Ok(resp.json().await?);
    }
    let status = resp.status().as_u16();
    let err: TokenError = resp
        .json()
        .await
        .unwrap_or(TokenError { error: "unknown_error".into(), error_description: None });
    if err.error == "invalid_grant" {
        return Err(Error::Auth("invalid_grant".into()));
    }
    Err(Error::Api { status, message: err.error_description.unwrap_or(err.error) })
}

pub async fn revoke(http: &reqwest::Client, token: &str) {
    let _ = http.post(REVOKE_URL).form(&[("token", token)]).send().await;
}

/// Hands out valid access tokens per account, refreshing them when they expire.
#[derive(Default)]
pub struct Tokens {
    // Expiry is wall-clock time: `Instant` stops while a Mac sleeps, so a token cached before
    // an overnight sleep would look valid on wake and Gmail would answer 401.
    cache: Mutex<HashMap<String, (String, SystemTime)>>,
}

impl Tokens {
    pub async fn put(&self, account: &str, access: String, expires_in: u64) {
        let expiry = SystemTime::now() + Duration::from_secs(expires_in.saturating_sub(60));
        self.cache.lock().await.insert(account.to_string(), (access, expiry));
    }

    pub async fn forget(&self, account: &str) {
        self.cache.lock().await.remove(account);
    }

    pub async fn access_token(
        &self,
        http: &reqwest::Client,
        client: Option<GoogleClient>,
        account: &str,
    ) -> Result<String> {
        if let Some((token, expiry)) = self.cache.lock().await.get(account) {
            if SystemTime::now() < *expiry {
                return Ok(token.clone());
            }
        }
        let client = client.ok_or(Error::MissingClientConfig)?;
        let refresh = secrets::get(&secrets::refresh_token_key(account))?
            .ok_or_else(|| Error::NotSignedIn(account.to_string()))?;
        let tokens: TokenResponse = token_request(
            http,
            &[
                ("client_id", client.client_id.as_str()),
                ("client_secret", &client.client_secret),
                ("refresh_token", &refresh),
                ("grant_type", "refresh_token"),
            ],
        )
        .await
        .map_err(|e| match e {
            Error::Auth(_) => Error::NotSignedIn(account.to_string()),
            e => e,
        })?;
        self.put(account, tokens.access_token.clone(), tokens.expires_in).await;
        Ok(tokens.access_token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(pkce_challenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[tokio::test]
    async fn cached_token_expires_on_wall_clock() {
        let tokens = Tokens::default();
        let http = reqwest::Client::new();
        tokens.put("a@x.com", "fresh".into(), 3600).await;
        assert_eq!(tokens.access_token(&http, None, "a@x.com").await.unwrap(), "fresh");
        // Within the 60s safety margin counts as expired; with no client configured the
        // refresh path is reached and fails instead of returning the stale token.
        tokens.put("a@x.com", "stale".into(), 30).await;
        assert!(tokens.access_token(&http, None, "a@x.com").await.is_err());
    }

    #[test]
    fn parses_loopback_callback() {
        let req = "GET /?state=abc&code=4%2F0Ab&scope=x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let p = parse_callback(req).unwrap();
        assert_eq!(p["code"], "4/0Ab");
        assert_eq!(p["state"], "abc");
        assert!(parse_callback("GET /favicon.ico HTTP/1.1\r\n\r\n").is_none());
    }
}
