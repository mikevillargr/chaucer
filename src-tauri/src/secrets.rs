//! macOS Keychain storage for refresh tokens and LLM API keys.

use crate::error::Result;

const SERVICE: &str = "com.mikevillargr.chaucer";
/// Keychain service used before the app was renamed from Letterbox; read once and migrated.
const LEGACY_SERVICE: &str = "com.mikevillargr.letterbox";

fn entry(key: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, key)?)
}

fn read(service: &str, key: &str) -> Result<Option<String>> {
    match keyring::Entry::new(service, key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn get(key: &str) -> Result<Option<String>> {
    if let Some(v) = read(SERVICE, key)? {
        return Ok(Some(v));
    }
    let Some(v) = read(LEGACY_SERVICE, key).unwrap_or(None) else { return Ok(None) };
    set(key, &v)?;
    let _ = keyring::Entry::new(LEGACY_SERVICE, key).and_then(|e| e.delete_credential());
    Ok(Some(v))
}

pub fn set(key: &str, value: &str) -> Result<()> {
    Ok(entry(key)?.set_password(value)?)
}

pub fn delete(key: &str) -> Result<()> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn refresh_token_key(account: &str) -> String {
    format!("refresh:{account}")
}

pub fn llm_key(provider_id: &str) -> String {
    format!("llm:{provider_id}")
}
