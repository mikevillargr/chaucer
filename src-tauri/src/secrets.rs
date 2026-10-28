//! macOS Keychain storage for refresh tokens and LLM API keys.

use crate::error::Result;

const SERVICE: &str = "com.mikevillargr.letterbox";

fn entry(key: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, key)?)
}

pub fn get(key: &str) -> Result<Option<String>> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
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
