//! Bring-your-own-key LLM providers for the smart features. Provider settings live in
//! preferences (`llmProviders`, `llmFeatures`); API keys live in the Keychain.

use crate::error::{Error, Result};
use crate::model::Message;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    /// "anthropic" | "openai" | "gemini" | "openai_compatible"
    pub kind: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub model: String,
}

pub async fn complete(http: &reqwest::Client, p: &Provider, key: Option<&str>, system: &str, user: &str) -> Result<String> {
    let need_key = || key.filter(|k| !k.is_empty()).ok_or_else(|| Error::other(format!("No API key saved for {}", p.name)));
    let (req, extract): (reqwest::RequestBuilder, fn(&Value) -> Option<String>) = match p.kind.as_str() {
        "anthropic" => (
            http.post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", need_key()?)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": p.model, "max_tokens": 1024, "system": system,
                    "messages": [{ "role": "user", "content": user }]
                })),
            |v| {
                let text: String = v["content"].as_array()?.iter().filter_map(|b| b["text"].as_str()).collect();
                Some(text)
            },
        ),
        "gemini" => (
            http.post(format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent", p.model))
                .header("x-goog-api-key", need_key()?)
                .json(&json!({
                    "systemInstruction": { "parts": [{ "text": system }] },
                    "contents": [{ "role": "user", "parts": [{ "text": user }] }]
                })),
            |v| {
                let text: String =
                    v["candidates"][0]["content"]["parts"].as_array()?.iter().filter_map(|b| b["text"].as_str()).collect();
                Some(text)
            },
        ),
        "openai" | "openai_compatible" => {
            let base = match p.kind.as_str() {
                "openai" => "https://api.openai.com/v1".to_string(),
                _ => p.base_url.clone().filter(|b| !b.is_empty()).ok_or_else(|| Error::other("Base URL is required"))?,
            };
            let mut req = http.post(format!("{}/chat/completions", base.trim_end_matches('/'))).json(&json!({
                "model": p.model,
                "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }]
            }));
            if p.kind == "openai" {
                req = req.bearer_auth(need_key()?);
            } else if let Some(k) = key.filter(|k| !k.is_empty()) {
                req = req.bearer_auth(k);
            }
            (req, |v| v["choices"][0]["message"]["content"].as_str().map(String::from))
        }
        other => return Err(Error::other(format!("Unknown provider type {other}"))),
    };
    let resp = req.send().await?;
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !(200..300).contains(&status) {
        let message = body["error"]["message"].as_str().or(body["error"].as_str()).unwrap_or("request failed").to_string();
        return Err(Error::Api { status, message });
    }
    extract(&body).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).ok_or_else(|| Error::other("The model returned no text"))
}

/// Crude HTML → text for prompts: drops style/script/head blocks and tags.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let lower = html.to_lowercase();
    let mut i = 0;
    let bytes = html.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let rest = &lower[i..];
            let skip_to = ["<style", "<script", "<head"].iter().find(|t| rest.starts_with(*t)).and_then(|t| {
                let close = format!("</{}", &t[1..]);
                rest.find(&close).map(|e| i + e + close.len())
            });
            let end = match skip_to {
                Some(e) => lower[e..].find('>').map(|x| e + x + 1).unwrap_or(bytes.len()),
                None => lower[i..].find('>').map(|x| i + x + 1).unwrap_or(bytes.len()),
            };
            let tag = &lower[i..end.min(lower.len())];
            if ["<br", "<p", "</p", "<div", "</div", "<li", "<tr", "<h"].iter().any(|t| tag.starts_with(t)) {
                out.push('\n');
            }
            i = end;
        } else {
            let next = lower[i..].find('<').map(|x| i + x).unwrap_or(bytes.len());
            out.push_str(&html[i..next]);
            i = next;
        }
    }
    let decoded = html_escape::decode_html_entities(&out).into_owned();
    decoded.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

/// The thread as plain text, newest messages kept when it must be truncated.
pub fn thread_text(subject: &str, messages: &[Message], limit: usize) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut used = 0;
    for m in messages.iter().rev() {
        let body = m.text.clone().unwrap_or_else(|| m.html.as_deref().map(html_to_text).unwrap_or_default());
        let from = if m.from.name.is_empty() { m.from.email.clone() } else { format!("{} <{}>", m.from.name, m.from.email) };
        let date = chrono::DateTime::from_timestamp_millis(m.date).map(|d| d.to_rfc2822()).unwrap_or_default();
        let block = format!("From: {from}\nDate: {date}\n\n{}", body.trim());
        if used + block.len() > limit && !parts.is_empty() {
            break;
        }
        used += block.len();
        parts.push(block.chars().take(limit).collect());
    }
    parts.reverse();
    format!("Subject: {subject}\n\n{}", parts.join("\n\n---\n\n"))
}

pub const SMART_REPLY_SYSTEM: &str = "You suggest quick replies to the latest email in a thread, written as the recipient. \
Return ONLY a JSON array of exactly 3 distinct replies, each under 8 words, natural and polite, matching the thread's language. No other text.";

pub const SUMMARY_SYSTEM: &str = "You summarize email threads for a busy reader. Reply with 2 to 4 short bullet points \
(start each with '• ') covering what happened, any decisions, and anything the reader needs to do. Plain text, no preamble.";

pub const WRITE_SYSTEM: &str = "You help write emails. Follow the user's instruction to draft or rewrite the email body. \
Return ONLY the email body as plain text paragraphs separated by blank lines: no subject line, no markdown, no commentary. \
Don't invent facts; leave [placeholders] for details you don't know.";

/// Pulls the JSON string array out of a model reply that may include extra text.
pub fn parse_replies(raw: &str) -> Vec<String> {
    let (Some(s), Some(e)) = (raw.find('['), raw.rfind(']')) else { return vec![] };
    serde_json::from_str::<Vec<String>>(&raw[s..=e])
        .unwrap_or_default()
        .into_iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .take(3)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Addr;

    #[test]
    fn strips_html() {
        let t = html_to_text("<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;Ann,</p><div>See <b>this</b><br>Thanks</div><script>x()</script></body></html>");
        assert_eq!(t, "Hi\u{a0}Ann,\nSee this\nThanks");
    }

    #[test]
    fn parses_reply_arrays_from_chatty_output() {
        assert_eq!(parse_replies("Sure!\n[\"Sounds good\", \"Thanks!\", \"Let me check\"]"), ["Sounds good", "Thanks!", "Let me check"]);
        assert!(parse_replies("no json here").is_empty());
    }

    #[test]
    fn thread_text_keeps_newest_when_truncating() {
        let msg = |t: &str| Message { from: Addr { name: "Ann".into(), email: "a@x".into() }, text: Some(t.repeat(50)), ..Default::default() };
        let s = thread_text("Plans", &[msg("old "), msg("new ")], 400);
        assert!(s.contains("new") && !s.contains("old"));
    }
}
