//! Files in the app data directory: the Google OAuth client and user preferences.
//! Secrets (refresh tokens, LLM keys) live in the Keychain instead; see `secrets`.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GoogleClient {
    pub client_id: String,
    pub client_secret: String,
}

pub struct Config {
    dir: PathBuf,
    prefs: Mutex<Map<String, Value>>,
}

impl Config {
    pub fn load(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let prefs = std::fs::read_to_string(dir.join("prefs.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Ok(Config { dir: dir.to_path_buf(), prefs: Mutex::new(prefs) })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn google_client(&self) -> Option<GoogleClient> {
        let raw = std::fs::read_to_string(self.dir.join("google-client.json")).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn set_google_client(&self, client: &GoogleClient) -> Result<()> {
        write_private(&self.dir.join("google-client.json"), &serde_json::to_vec_pretty(client)?)
    }

    pub fn prefs(&self) -> Map<String, Value> {
        self.prefs.lock().unwrap().clone()
    }

    pub fn pref(&self, key: &str) -> Option<Value> {
        self.prefs.lock().unwrap().get(key).cloned()
    }

    /// Shallow-merges `patch` into the stored preferences; `null` removes a key.
    pub fn update_prefs(&self, patch: Map<String, Value>) -> Result<Map<String, Value>> {
        let mut prefs = self.prefs.lock().unwrap();
        for (k, v) in patch {
            if v.is_null() {
                prefs.remove(&k);
            } else {
                prefs.insert(k, v);
            }
        }
        write_private(&self.dir.join("prefs.json"), &serde_json::to_vec_pretty(&*prefs)?)?;
        Ok(prefs.clone())
    }
}

fn write_private(path: &Path, data: &[u8]) -> Result<()> {
    std::fs::write(path, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prefs_merge_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = Config::load(dir.path()).unwrap();
        let mut patch = Map::new();
        patch.insert("theme".into(), json!("dark"));
        patch.insert("density".into(), json!("compact"));
        cfg.update_prefs(patch).unwrap();

        let mut patch = Map::new();
        patch.insert("density".into(), Value::Null);
        cfg.update_prefs(patch).unwrap();

        let reloaded = Config::load(dir.path()).unwrap();
        assert_eq!(reloaded.pref("theme"), Some(json!("dark")));
        assert_eq!(reloaded.pref("density"), None);
    }
}
