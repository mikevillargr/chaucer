use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Not signed in to {0}")]
    NotSignedIn(String),
    #[error("Google sign-in isn't set up yet")]
    MissingClientConfig,
    #[error("Sign-in failed: {0}")]
    Auth(String),
    #[error("Gmail returned {status}: {message}")]
    Api { status: u16, message: String },
    #[error("Network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Keychain error: {0}")]
    Keychain(#[from] keyring::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn other(msg: impl Into<String>) -> Self {
        Error::Other(msg.into())
    }

    /// True for API errors with the given HTTP status.
    pub fn is_status(&self, code: u16) -> bool {
        matches!(self, Error::Api { status, .. } if *status == code)
    }
}

// Commands return errors to the webview as plain strings.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
