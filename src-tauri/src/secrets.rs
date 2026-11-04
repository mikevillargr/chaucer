//! OS credential storage for refresh tokens and LLM API keys: the macOS Keychain, or Windows
//! Credential Manager (keyring picks the backend by platform).

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Real OS credential store round trip across separate processes. Run by hand:
    ///   CHAUCER_CRED_PHASE=write cargo test --lib secrets -- --ignored
    ///   CHAUCER_CRED_PHASE=read  cargo test --lib secrets -- --ignored
    ///   CHAUCER_CRED_PHASE=delete cargo test --lib secrets -- --ignored
    #[test]
    #[ignore = "touches the real OS credential store"]
    fn credential_round_trip_across_processes() {
        let key = "test:roundtrip";
        match std::env::var("CHAUCER_CRED_PHASE").as_deref() {
            Ok("write") => set(key, "s3cret-value").unwrap(),
            Ok("read") => assert_eq!(get(key).unwrap().as_deref(), Some("s3cret-value")),
            Ok("delete") => {
                delete(key).unwrap();
                assert_eq!(get(key).unwrap(), None);
            }
            _ => panic!("set CHAUCER_CRED_PHASE=write|read|delete"),
        }
    }
}
