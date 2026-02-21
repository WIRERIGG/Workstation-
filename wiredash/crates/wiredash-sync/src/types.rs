use serde::{Deserialize, Serialize};
use wiredash_crypto::types::Cipher;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const AUTH_HOST: &str = "https://auth.streetwriters.co";
pub const API_HOST: &str = "https://api.notesnook.com";
pub const SSE_HOST: &str = "https://events.streetwriters.co";
pub const SUBSCRIPTIONS_HOST: &str = "https://subscriptions.streetwriters.co";
pub const CLIENT_ID: &str = "workstation";
pub const CURRENT_DATABASE_VERSION: f64 = 6.1;
pub const SYNC_BATCH_SIZE: usize = 100;
pub const CONFLICT_THRESHOLD_MS: i64 = 60_000;
pub const SIGNALR_RECORD_SEPARATOR: u8 = 0x1E;

/// Syncable item types in sync order.
pub const SYNC_COLLECTIONS: &[(&str, &str)] = &[
    ("settingitem", "settings"),
    ("attachment", "attachments"),
    ("content", "content"),
    ("notebook", "notebooks"),
    ("shortcut", "shortcuts"),
    ("reminder", "reminders"),
    ("relation", "relations"),
    ("tag", "tags"),
    ("color", "colors"),
    ("note", "notes"),
    ("vault", "vaults"),
];

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    /// Timestamp (ms) when the token was saved locally.
    pub t: i64,
    pub scope: String,
}

impl Token {
    pub fn is_expired(&self) -> bool {
        let expiry_ms = self.t + self.expires_in * 1000;
        chrono::Utc::now().timestamp_millis() >= expiry_ms
    }

    pub fn is_refreshable(&self) -> bool {
        self.scope.contains("offline_access") && !self.refresh_token.is_empty()
    }
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub salt: String,
    #[serde(rename = "attachmentsKey")]
    pub attachments_key: Option<Cipher>,
    pub mfa: Option<MfaConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaConfig {
    #[serde(rename = "isEnabled")]
    pub is_enabled: bool,
    #[serde(rename = "primaryMethod")]
    pub primary_method: String,
}

// ---------------------------------------------------------------------------
// Sync Items
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncItem {
    pub id: String,
    pub v: f64,
    #[serde(flatten)]
    pub cipher: Cipher,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncTransferItem {
    pub items: Vec<SyncItem>,
    pub r#type: String,
    pub count: usize,
}

// ---------------------------------------------------------------------------
// Auth Request/Response
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
    pub additional_data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    pub error_description: Option<String>,
}

// ---------------------------------------------------------------------------
// Sync Enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncMode {
    Full,
    Fetch,
    Send,
}

#[derive(Debug, Clone)]
pub struct SyncResult {
    pub pushed: usize,
    pub pulled: usize,
    pub conflicts: usize,
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("auth failed: {0}")]
    AuthFailed(String),
    #[error("token expired and refresh failed")]
    TokenExpired,
    #[error("SignalR error: {0}")]
    SignalR(String),
    #[error("encryption error: {0}")]
    Crypto(#[from] wiredash_crypto::types::CryptoError),
    #[error("database error: {0}")]
    Database(anyhow::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("websocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
}
