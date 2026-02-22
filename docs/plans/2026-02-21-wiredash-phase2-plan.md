# WIREDASH Phase 2 — Sync + Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add sync engine and auth flow so WIREDASH can authenticate against the Notesnook server, push/pull encrypted items via SignalR WebSockets, and resolve conflicts — delivering a CLI tool that syncs notes.

**Architecture:** New `wiredash-sync` crate depends on `wiredash-crypto` (encryption) and `wiredash-db` (storage). HTTP via `reqwest`, WebSocket via `tokio-tungstenite`, async runtime via `tokio`. SignalR JSON Hub Protocol implemented manually (JSON + `\x1e` delimiter). Token management with mutex-guarded auto-refresh. Conflict resolution mirrors Workstation's merger.ts.

**Tech Stack:** Rust, reqwest, tokio, tokio-tungstenite, serde, base64, url, async-mutex

---

## Context for All Tasks

### Existing Crates (Phase 1 — complete)

- **`wiredash-crypto`** — XChaCha20-Poly1305 encrypt/decrypt, Argon2i key derivation (`KeyUtils::derive_key`, `Encryption::encrypt`, `Decryption::decrypt`). Located at `wiredash/crates/wiredash-crypto/`.
- **`wiredash-db`** — SQLite via rusqlite, schema with 16 tables + 2 FTS5. KV table: `kv(key TEXT PK, value TEXT, dateModified INTEGER)`. Located at `wiredash/crates/wiredash-db/`.
- **`wiredash-core`** — 14 entity types, 16 collection modules (notes, notebooks, tags, content, relations, etc.). Located at `wiredash/crates/wiredash-core/`.

### Server Endpoints

| Host | URL | Purpose |
|------|-----|---------|
| AUTH_HOST | `https://auth.streetwriters.co` | Token, account, MFA |
| API_HOST | `https://api.notesnook.com` | Users, sync hub, devices, S3 |
| SSE_HOST | `https://events.streetwriters.co` | Server-sent events |
| SUBSCRIPTIONS_HOST | `https://subscriptions.streetwriters.co` | Billing |

### Sync Protocol Summary

1. SignalR WebSocket to `{API_HOST}/hubs/sync/v2` (JSON Hub Protocol, `\x1e` delimiter, skip negotiation)
2. Fetch: client invokes `RequestFetchV3(deviceId)`, server calls back `SendItems(chunk)` repeatedly
3. Send: client invokes `PushItems(deviceId, SyncTransferItem)` in batches of 100, then `PushCompletedV2(deviceId)`
4. Items are encrypted with XChaCha20-Poly1305 using user's encryption key (Argon2i-derived)
5. Conflict resolution: last-write-wins for most items, content items have 60s threshold + HTML comparison

### Auth Flow Summary

Three-phase token exchange at `POST {AUTH_HOST}/connect/token`:
1. `grant_type=email` → partial-scope token
2. `grant_type=mfa` (if MFA enabled) → upgraded token
3. `grant_type=mfa_password` with Argon2id-hashed password → full access + refresh token

Password hashing: Argon2**id** (NOT Argon2i), 64MB memory, salt = BLAKE2b(email).

### Key Constants

```rust
const CURRENT_DATABASE_VERSION: f64 = 6.1;
const CLIENT_ID: &str = "workstation";
const SYNC_BATCH_SIZE: usize = 100;
const CONFLICT_THRESHOLD_MS: i64 = 60_000;   // 60 seconds
const TOKEN_REFRESH_TIMEOUT_MS: u64 = 10_000; // 10 seconds
const SIGNALR_TIMEOUT_MS: u64 = 300_000;      // 5 minutes
const SIGNALR_RECORD_SEPARATOR: u8 = 0x1E;
```

### Syncable Item Types (in sync order)

```rust
const SYNC_COLLECTIONS: &[(&str, &str)] = &[
    ("settingitem", "settings"),
    ("attachment",  "attachments"),
    ("content",     "content"),
    ("notebook",    "notebooks"),
    ("shortcut",    "shortcuts"),
    ("reminder",    "reminders"),
    ("relation",    "relations"),
    ("tag",         "tags"),
    ("color",       "colors"),
    ("note",        "notes"),
    ("vault",       "vaults"),
];
```

---

## Task 1: Add `wiredash-sync` Crate Scaffold

**Files:**
- Create: `wiredash/crates/wiredash-sync/Cargo.toml`
- Create: `wiredash/crates/wiredash-sync/src/lib.rs`
- Modify: `wiredash/Cargo.toml` (add member)

**Step 1: Create Cargo.toml**

```toml
[package]
name = "wiredash-sync"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
wiredash-crypto = { path = "../wiredash-crypto" }
wiredash-db = { path = "../wiredash-db" }
wiredash-core = { path = "../wiredash-core" }

serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }
anyhow = { workspace = true }
chrono = { workspace = true }

reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.26", features = ["native-tls"] }
url = "2"
base64 = "0.22"
futures-util = "0.3"
tracing = { workspace = true }

[dev-dependencies]
tokio = { version = "1", features = ["full", "test-util"] }
```

**Step 2: Create lib.rs**

```rust
pub mod types;
pub mod password;
pub mod auth;
pub mod token;
pub mod http;
pub mod signalr;
pub mod collector;
pub mod merger;
pub mod sync_engine;

pub use types::*;
```

All modules will be empty stubs initially (just `// TODO` comments). They get filled in subsequent tasks.

**Step 3: Add to workspace**

In `wiredash/Cargo.toml`, add `"crates/wiredash-sync"` to the `members` array.

**Step 4: Verify it compiles**

Run: `cd wiredash && cargo check -p wiredash-sync`
Expected: Compiles with warnings about empty modules.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync wiredash/Cargo.toml
git commit -s -m "setup: scaffold wiredash-sync crate with dependencies"
```

---

## Task 2: KV Storage Module in `wiredash-db`

The token and device ID are stored in the `kv` table. We need a typed KV accessor.

**Files:**
- Create: `wiredash/crates/wiredash-db/src/kv.rs`
- Modify: `wiredash/crates/wiredash-db/src/lib.rs` (add `pub mod kv;`)
- Create: `wiredash/crates/wiredash-db/tests/kv_test.rs`

**Step 1: Write the failing test**

```rust
// tests/kv_test.rs
use wiredash_db::Database;
use wiredash_db::kv::KvStore;

#[test]
fn test_kv_roundtrip() {
    let db = Database::open_memory().unwrap();
    let kv = KvStore::new(&db);

    // Initially empty
    assert!(kv.read("token").unwrap().is_none());

    // Write
    let token_json = serde_json::json!({
        "access_token": "abc123",
        "refresh_token": "def456",
        "expires_in": 3600,
        "t": 1700000000000i64,
        "scope": "workstation.sync offline_access"
    });
    kv.write("token", &token_json).unwrap();

    // Read back
    let stored = kv.read("token").unwrap().expect("should exist");
    assert_eq!(stored["access_token"], "abc123");
    assert_eq!(stored["expires_in"], 3600);

    // Overwrite
    let updated = serde_json::json!({"access_token": "new_token"});
    kv.write("token", &updated).unwrap();
    let re_read = kv.read("token").unwrap().unwrap();
    assert_eq!(re_read["access_token"], "new_token");

    // Delete
    kv.delete("token").unwrap();
    assert!(kv.read("token").unwrap().is_none());
}

#[test]
fn test_kv_read_typed() {
    let db = Database::open_memory().unwrap();
    let kv = KvStore::new(&db);

    kv.write("deviceId", &serde_json::json!("abc123def")).unwrap();

    let device_id: Option<String> = kv.read_as("deviceId").unwrap();
    assert_eq!(device_id, Some("abc123def".to_string()));
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-db --test kv_test -- --nocapture`
Expected: FAIL — `kv` module doesn't exist yet.

**Step 3: Implement KvStore**

```rust
// wiredash-db/src/kv.rs
use rusqlite::params;
use crate::Database;

pub struct KvStore<'a> {
    db: &'a Database,
}

impl<'a> KvStore<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Read a JSON value from the KV table.
    pub fn read(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT value FROM kv WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, Option<String>>(0))?;
        match rows.next() {
            Some(row) => {
                let val_str = row?;
                match val_str {
                    Some(s) => Ok(serde_json::from_str(&s).ok()),
                    None => Ok(None),
                }
            }
            None => Ok(None),
        }
    }

    /// Read and deserialize a KV value into a concrete type.
    pub fn read_as<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>, anyhow::Error> {
        match self.read(key)? {
            Some(v) => Ok(Some(serde_json::from_value(v)?)),
            None => Ok(None),
        }
    }

    /// Write a JSON value to the KV table (INSERT OR REPLACE).
    pub fn write(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        let val_json = serde_json::to_string(value)?;
        self.db.execute(
            "INSERT OR REPLACE INTO kv (key, value, dateModified) VALUES (?1, ?2, ?3)",
            params![key, val_json, now],
        )?;
        Ok(())
    }

    /// Delete a KV entry.
    pub fn delete(&self, key: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM kv WHERE key = ?1", params![key])?;
        Ok(())
    }
}
```

Add `pub mod kv;` to `wiredash-db/src/lib.rs`. Also add `serde_json` and `chrono` as dependencies of `wiredash-db` if not already present.

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-db --test kv_test -- --nocapture`
Expected: 2 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-db/
git commit -s -m "core: add KV storage module to wiredash-db"
```

---

## Task 3: Password Hashing (Argon2id) in `wiredash-crypto`

The **server-facing password** uses Argon2**id** (different from Argon2**i** used for encryption keys). Salt = BLAKE2b hash of the user's email, truncated to `pwhash::SALTBYTES`. Output = 32 bytes, base64-encoded. Memory = 64MB (vs 8MB for encryption).

**Files:**
- Create: `wiredash/crates/wiredash-crypto/src/password.rs`
- Modify: `wiredash/crates/wiredash-crypto/src/lib.rs` (add `pub mod password;`)
- Create: `wiredash/crates/wiredash-crypto/tests/password_test.rs`

**Step 1: Write the failing test**

```rust
// tests/password_test.rs
use wiredash_crypto::password::Password;

#[test]
fn test_password_hash_deterministic() {
    // Same password + email → same hash every time
    let hash1 = Password::hash("my-secret-password", "user@example.com").unwrap();
    let hash2 = Password::hash("my-secret-password", "user@example.com").unwrap();
    assert_eq!(hash1, hash2);
}

#[test]
fn test_password_hash_different_emails_produce_different_hashes() {
    let hash1 = Password::hash("same-password", "alice@example.com").unwrap();
    let hash2 = Password::hash("same-password", "bob@example.com").unwrap();
    assert_ne!(hash1, hash2);
}

#[test]
fn test_password_hash_is_base64() {
    let hash = Password::hash("test-password", "test@example.com").unwrap();
    // Should be base64-decodable and produce 32 bytes
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let decoded = engine.decode(&hash).expect("should be valid base64");
    assert_eq!(decoded.len(), 32, "hash should be 32 bytes");
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-crypto --test password_test -- --nocapture`
Expected: FAIL — `password` module doesn't exist.

**Step 3: Implement Password hashing**

```rust
// wiredash-crypto/src/password.rs
use crate::types::CryptoError;
use base64::Engine;
use sodiumoxide::crypto::generichash;
use sodiumoxide::crypto::pwhash::argon2id13 as pwhash;

const OPS_LIMIT: pwhash::OpsLimit = pwhash::OpsLimit(3);
// 64 MB — different from encryption's 8 MB
const MEM_LIMIT: pwhash::MemLimit = pwhash::MemLimit(1024 * 1024 * 64);

pub struct Password;

impl Password {
    /// Hash a password for server authentication.
    ///
    /// Uses Argon2id with salt = BLAKE2b(email) truncated to SALTBYTES (16 bytes).
    /// Returns base64url-no-pad encoded 32-byte hash.
    pub fn hash(password: &str, email: &str) -> Result<String, CryptoError> {
        sodiumoxide::init().map_err(|_| CryptoError::InitFailed)?;

        // Salt = BLAKE2b hash of email, truncated to pwhash::SALTBYTES
        let email_hash = generichash::hash(
            email.as_bytes(),
            Some(pwhash::SALTBYTES),
            None,
        ).map_err(|_| CryptoError::KeyDerivationFailed)?;

        let mut salt_buf = [0u8; pwhash::SALTBYTES];
        salt_buf.copy_from_slice(&email_hash[..pwhash::SALTBYTES]);
        let salt = pwhash::Salt(salt_buf);

        let mut key = [0u8; 32];
        pwhash::derive_key(
            &mut key,
            password.as_bytes(),
            &salt,
            OPS_LIMIT,
            MEM_LIMIT,
        )
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        Ok(engine.encode(key))
    }
}
```

Add `pub mod password;` to `wiredash-crypto/src/lib.rs`.

**Note:** The `generichash::hash` function takes `(data, output_size, key)`. If the `generichash` API differs in your version of sodiumoxide, use `generichash::Digest` with a custom size. The key point is: BLAKE2b(email, output_len=SALTBYTES).

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-crypto --test password_test -- --nocapture`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-crypto/
git commit -s -m "crypto: add Argon2id password hashing for server auth"
```

---

## Task 4: Auth + Token Types

Define all types used by the auth flow, token management, and sync protocol.

**Files:**
- Create: `wiredash/crates/wiredash-sync/src/types.rs`
- Create: `wiredash/crates/wiredash-sync/tests/types_test.rs`

**Step 1: Write the test**

```rust
// tests/types_test.rs
use wiredash_sync::types::*;

#[test]
fn test_token_is_expired() {
    let mut token = Token {
        access_token: "abc".into(),
        refresh_token: "def".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };

    // Fresh token — not expired
    assert!(!token.is_expired());

    // Expired token (set `t` to 2 hours ago)
    token.t = chrono::Utc::now().timestamp_millis() - 7_200_000;
    assert!(token.is_expired());
}

#[test]
fn test_token_is_refreshable() {
    let token = Token {
        access_token: "abc".into(),
        refresh_token: "def".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    assert!(token.is_refreshable());

    let no_offline = Token {
        scope: "workstation.sync".into(),
        refresh_token: String::new(),
        ..token
    };
    assert!(!no_offline.is_refreshable());
}

#[test]
fn test_sync_transfer_item_serialization() {
    let item = SyncTransferItem {
        items: vec![],
        r#type: "note".into(),
        count: 0,
    };
    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("\"type\":\"note\""));
    assert!(json.contains("\"count\":0"));
}

#[test]
fn test_user_deserialize() {
    let json = r#"{
        "id": "user123",
        "email": "test@example.com",
        "salt": "somesalt",
        "attachmentsKey": {"iv": "a", "salt": "b", "cipher": "c", "length": 10, "alg": "xcha-argon2i13-7", "format": "base64"},
        "mfa": {"isEnabled": false, "primaryMethod": "email"}
    }"#;
    let user: User = serde_json::from_str(json).unwrap();
    assert_eq!(user.email, "test@example.com");
    assert_eq!(user.salt, "somesalt");
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-sync --test types_test -- --nocapture`
Expected: FAIL — types module is empty.

**Step 3: Implement types**

```rust
// wiredash-sync/src/types.rs
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    Database(#[from] anyhow::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("websocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-sync --test types_test -- --nocapture`
Expected: 4 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync/
git commit -s -m "core: add auth, token, and sync types for wiredash-sync"
```

---

## Task 5: HTTP Client with Token Auto-Refresh

Authenticated HTTP client wrapping `reqwest::Client`. The `getToken()` equivalent checks expiry and refreshes via mutex before each request.

**Files:**
- Create: `wiredash/crates/wiredash-sync/src/token.rs`
- Create: `wiredash/crates/wiredash-sync/src/http.rs`
- Create: `wiredash/crates/wiredash-sync/tests/token_test.rs`

**Step 1: Write the failing test**

```rust
// tests/token_test.rs
use wiredash_sync::token::TokenManager;
use wiredash_sync::types::Token;

#[test]
fn test_token_manager_store_and_retrieve() {
    let db = wiredash_db::Database::open_memory().unwrap();
    let tm = TokenManager::new(&db);

    assert!(tm.get_token().unwrap().is_none());

    let token = Token {
        access_token: "test-access".into(),
        refresh_token: "test-refresh".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();

    let retrieved = tm.get_token().unwrap().expect("should exist");
    assert_eq!(retrieved.access_token, "test-access");
}

#[test]
fn test_token_manager_delete() {
    let db = wiredash_db::Database::open_memory().unwrap();
    let tm = TokenManager::new(&db);

    let token = Token {
        access_token: "test".into(),
        refresh_token: "ref".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();
    tm.delete_token().unwrap();
    assert!(tm.get_token().unwrap().is_none());
}

#[test]
fn test_token_manager_access_token_from_fresh_token() {
    let db = wiredash_db::Database::open_memory().unwrap();
    let tm = TokenManager::new(&db);

    let token = Token {
        access_token: "fresh-token".into(),
        refresh_token: "ref".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();

    // Fresh token — should return access_token directly without refresh
    let access = tm.get_access_token_no_refresh().unwrap().unwrap();
    assert_eq!(access, "fresh-token");
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-sync --test token_test -- --nocapture`
Expected: FAIL.

**Step 3: Implement TokenManager**

```rust
// wiredash-sync/src/token.rs
use wiredash_db::Database;
use wiredash_db::kv::KvStore;
use crate::types::{Token, SyncError};

pub struct TokenManager<'a> {
    kv: KvStore<'a>,
}

impl<'a> TokenManager<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { kv: KvStore::new(db) }
    }

    /// Retrieve stored token (no refresh logic — that requires async HTTP).
    pub fn get_token(&self) -> Result<Option<Token>, anyhow::Error> {
        self.kv.read_as::<Token>("token")
    }

    /// Save token to KV store, stamping `t` with current time.
    pub fn save_token(&self, token: &Token) -> Result<(), anyhow::Error> {
        let mut stamped = token.clone();
        stamped.t = chrono::Utc::now().timestamp_millis();
        self.kv.write("token", &serde_json::to_value(&stamped)?)
    }

    /// Delete stored token (logout).
    pub fn delete_token(&self) -> Result<(), anyhow::Error> {
        self.kv.delete("token")
    }

    /// Get access token if the stored token is not expired.
    /// Does NOT attempt refresh (that's async — see `http.rs`).
    pub fn get_access_token_no_refresh(&self) -> Result<Option<String>, anyhow::Error> {
        match self.get_token()? {
            Some(t) if !t.is_expired() => Ok(Some(t.access_token)),
            _ => Ok(None),
        }
    }
}
```

```rust
// wiredash-sync/src/http.rs
use reqwest::Client;
use crate::types::*;
use crate::token::TokenManager;

pub struct HttpClient<'a> {
    client: Client,
    token_manager: &'a TokenManager<'a>,
}

impl<'a> HttpClient<'a> {
    pub fn new(token_manager: &'a TokenManager<'a>) -> Self {
        Self {
            client: Client::new(),
            token_manager,
        }
    }

    /// Get a valid access token. If expired and refreshable, attempt refresh.
    pub async fn get_access_token(&self) -> Result<String, SyncError> {
        let token = self.token_manager.get_token()
            .map_err(SyncError::Database)?
            .ok_or(SyncError::TokenExpired)?;

        if !token.is_expired() {
            return Ok(token.access_token);
        }

        if !token.is_refreshable() {
            return Err(SyncError::TokenExpired);
        }

        // Refresh
        let params = [
            ("grant_type", "refresh_token"),
            ("refresh_token", &token.refresh_token),
            ("scope", &token.scope),
            ("client_id", CLIENT_ID),
        ];

        let resp = self.client
            .post(format!("{}/connect/token", AUTH_HOST))
            .form(&params)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(SyncError::TokenExpired);
        }

        let token_resp: TokenResponse = resp.json().await?;
        let new_token = Token {
            access_token: token_resp.access_token,
            refresh_token: token_resp.refresh_token.unwrap_or(token.refresh_token),
            expires_in: token_resp.expires_in.unwrap_or(3600),
            t: chrono::Utc::now().timestamp_millis(),
            scope: token_resp.scope.unwrap_or(token.scope),
        };

        self.token_manager.save_token(&new_token)
            .map_err(SyncError::Database)?;

        Ok(new_token.access_token)
    }

    /// Make an authenticated GET request.
    pub async fn get(&self, url: &str) -> Result<reqwest::Response, SyncError> {
        let token = self.get_access_token().await?;
        Ok(self.client.get(url)
            .bearer_auth(&token)
            .send()
            .await?)
    }

    /// Make an authenticated POST (form-encoded).
    pub async fn post_form(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> Result<reqwest::Response, SyncError> {
        let token = self.get_access_token().await?;
        Ok(self.client.post(url)
            .bearer_auth(&token)
            .form(params)
            .send()
            .await?)
    }

    /// Make an authenticated POST (JSON).
    pub async fn post_json<T: serde::Serialize>(
        &self,
        url: &str,
        body: &T,
    ) -> Result<reqwest::Response, SyncError> {
        let token = self.get_access_token().await?;
        Ok(self.client.post(url)
            .bearer_auth(&token)
            .json(body)
            .send()
            .await?)
    }

    /// Make an unauthenticated POST (form-encoded). Used for initial auth.
    pub async fn post_form_unauth(
        &self,
        url: &str,
        params: &[(&str, &str)],
    ) -> Result<reqwest::Response, SyncError> {
        Ok(self.client.post(url)
            .form(params)
            .send()
            .await?)
    }

    /// Make a POST with a specific bearer token (for multi-step auth).
    pub async fn post_form_with_token(
        &self,
        url: &str,
        params: &[(&str, &str)],
        bearer: &str,
    ) -> Result<reqwest::Response, SyncError> {
        Ok(self.client.post(url)
            .bearer_auth(bearer)
            .form(params)
            .send()
            .await?)
    }

    pub fn inner(&self) -> &Client {
        &self.client
    }
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-sync --test token_test -- --nocapture`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync/
git commit -s -m "core: add TokenManager and authenticated HttpClient"
```

---

## Task 6: Multi-Step Auth Flow

Implement the 3-phase login flow: email → MFA (optional) → password.

**Files:**
- Create: `wiredash/crates/wiredash-sync/src/auth.rs`
- Create: `wiredash/crates/wiredash-sync/tests/auth_test.rs`

**Step 1: Write tests (unit tests for helper functions)**

We can't integration-test against the real server, so test the request-building and response-parsing logic.

```rust
// tests/auth_test.rs
use wiredash_sync::auth::*;
use wiredash_sync::types::*;

#[test]
fn test_build_email_params() {
    let params = AuthClient::email_params("user@test.com");
    assert_eq!(params.len(), 3);
    assert_eq!(params[0], ("email", "user@test.com".to_string()));
    assert_eq!(params[1], ("grant_type", "email".to_string()));
    assert_eq!(params[2], ("client_id", CLIENT_ID.to_string()));
}

#[test]
fn test_build_password_params() {
    let params = AuthClient::password_params("hashed_pw_base64");
    assert_eq!(params.len(), 4);
    assert_eq!(params[0], ("grant_type", "mfa_password".to_string()));
    assert_eq!(params[1], ("client_id", CLIENT_ID.to_string()));
    assert_eq!(params[2], ("scope", "workstation.sync offline_access IdentityServerApi".to_string()));
    assert_eq!(params[3], ("password", "hashed_pw_base64".to_string()));
}

#[test]
fn test_build_mfa_params() {
    let params = AuthClient::mfa_params("123456", "app");
    assert_eq!(params.len(), 4);
    assert_eq!(params[0], ("grant_type", "mfa".to_string()));
    assert_eq!(params[1], ("client_id", CLIENT_ID.to_string()));
    assert_eq!(params[2], ("mfa:code", "123456".to_string()));
    assert_eq!(params[3], ("mfa:method", "app".to_string()));
}

#[test]
fn test_build_signup_params() {
    let params = AuthClient::signup_params("user@test.com", "hashed");
    assert_eq!(params.len(), 3);
    assert_eq!(params[0], ("email", "user@test.com".to_string()));
    assert_eq!(params[1], ("password", "hashed".to_string()));
    assert_eq!(params[2], ("client_id", CLIENT_ID.to_string()));
}

#[test]
fn test_parse_token_response() {
    let json = r#"{
        "access_token": "jwt-abc",
        "refresh_token": "ref-def",
        "expires_in": 3600,
        "scope": "workstation.sync offline_access IdentityServerApi"
    }"#;
    let resp: TokenResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.access_token, "jwt-abc");
    assert_eq!(resp.refresh_token.as_deref(), Some("ref-def"));
    assert_eq!(resp.expires_in, Some(3600));
}

#[test]
fn test_token_response_to_token() {
    let resp = TokenResponse {
        access_token: "a".into(),
        refresh_token: Some("r".into()),
        expires_in: Some(1800),
        scope: Some("workstation.sync".into()),
        additional_data: None,
    };
    let token = AuthClient::token_response_to_token(&resp);
    assert_eq!(token.access_token, "a");
    assert_eq!(token.refresh_token, "r");
    assert_eq!(token.expires_in, 1800);
    assert!(token.t > 0);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-sync --test auth_test -- --nocapture`
Expected: FAIL.

**Step 3: Implement AuthClient**

```rust
// wiredash-sync/src/auth.rs
use crate::http::HttpClient;
use crate::types::*;
use wiredash_crypto::password::Password;

pub struct AuthClient;

impl AuthClient {
    // -----------------------------------------------------------------------
    // Parameter builders (public for testing)
    // -----------------------------------------------------------------------

    pub fn email_params(email: &str) -> Vec<(&'static str, String)> {
        vec![
            ("email", email.to_string()),
            ("grant_type", "email".to_string()),
            ("client_id", CLIENT_ID.to_string()),
        ]
    }

    pub fn password_params(hashed_password: &str) -> Vec<(&'static str, String)> {
        vec![
            ("grant_type", "mfa_password".to_string()),
            ("client_id", CLIENT_ID.to_string()),
            ("scope", "workstation.sync offline_access IdentityServerApi".to_string()),
            ("password", hashed_password.to_string()),
        ]
    }

    pub fn mfa_params(code: &str, method: &str) -> Vec<(&'static str, String)> {
        vec![
            ("grant_type", "mfa".to_string()),
            ("client_id", CLIENT_ID.to_string()),
            ("mfa:code", code.to_string()),
            ("mfa:method", method.to_string()),
        ]
    }

    pub fn signup_params(email: &str, hashed_password: &str) -> Vec<(&'static str, String)> {
        vec![
            ("email", email.to_string()),
            ("password", hashed_password.to_string()),
            ("client_id", CLIENT_ID.to_string()),
        ]
    }

    pub fn refresh_params(refresh_token: &str, scope: &str) -> Vec<(&'static str, String)> {
        vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.to_string()),
            ("scope", scope.to_string()),
            ("client_id", CLIENT_ID.to_string()),
        ]
    }

    pub fn token_response_to_token(resp: &TokenResponse) -> Token {
        Token {
            access_token: resp.access_token.clone(),
            refresh_token: resp.refresh_token.clone().unwrap_or_default(),
            expires_in: resp.expires_in.unwrap_or(3600),
            t: chrono::Utc::now().timestamp_millis(),
            scope: resp.scope.clone().unwrap_or_default(),
        }
    }

    // -----------------------------------------------------------------------
    // Network operations (require HttpClient)
    // -----------------------------------------------------------------------

    /// Phase 1: Send email, get partial-scope token.
    pub async fn login_email<'a>(
        http: &HttpClient<'a>,
        email: &str,
    ) -> Result<(Token, Option<serde_json::Value>), SyncError> {
        let params = Self::email_params(email);
        let str_params: Vec<(&str, &str)> = params.iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let token_url = format!("{}/connect/token", AUTH_HOST);
        let resp = http.post_form_unauth(&token_url, &str_params).await?;

        if !resp.status().is_success() {
            let err: ErrorResponse = resp.json().await
                .unwrap_or(ErrorResponse { error: "unknown".into(), error_description: None });
            return Err(SyncError::AuthFailed(
                err.error_description.unwrap_or(err.error),
            ));
        }

        let token_resp: TokenResponse = resp.json().await?;
        let token = Self::token_response_to_token(&token_resp);
        Ok((token, token_resp.additional_data))
    }

    /// Phase 2a: Submit MFA code.
    pub async fn login_mfa<'a>(
        http: &HttpClient<'a>,
        bearer: &str,
        code: &str,
        method: &str,
    ) -> Result<Token, SyncError> {
        let params = Self::mfa_params(code, method);
        let str_params: Vec<(&str, &str)> = params.iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let token_url = format!("{}/connect/token", AUTH_HOST);
        let resp = http.post_form_with_token(&token_url, &str_params, bearer).await?;

        if !resp.status().is_success() {
            let err: ErrorResponse = resp.json().await
                .unwrap_or(ErrorResponse { error: "unknown".into(), error_description: None });
            return Err(SyncError::AuthFailed(
                err.error_description.unwrap_or(err.error),
            ));
        }

        let token_resp: TokenResponse = resp.json().await?;
        Ok(Self::token_response_to_token(&token_resp))
    }

    /// Phase 2b: Submit hashed password.
    pub async fn login_password<'a>(
        http: &HttpClient<'a>,
        bearer: &str,
        password: &str,
        email: &str,
    ) -> Result<Token, SyncError> {
        let hashed = Password::hash(password, email)
            .map_err(SyncError::Crypto)?;

        let params = Self::password_params(&hashed);
        let str_params: Vec<(&str, &str)> = params.iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let token_url = format!("{}/connect/token", AUTH_HOST);
        let resp = http.post_form_with_token(&token_url, &str_params, bearer).await?;

        if !resp.status().is_success() {
            let err: ErrorResponse = resp.json().await
                .unwrap_or(ErrorResponse { error: "unknown".into(), error_description: None });
            return Err(SyncError::AuthFailed(
                err.error_description.unwrap_or(err.error),
            ));
        }

        let token_resp: TokenResponse = resp.json().await?;
        Ok(Self::token_response_to_token(&token_resp))
    }

    /// Fetch user profile after authentication.
    pub async fn get_user<'a>(http: &HttpClient<'a>) -> Result<User, SyncError> {
        let url = format!("{}/users", API_HOST);
        let resp = http.get(&url).await?;

        if !resp.status().is_success() {
            return Err(SyncError::AuthFailed("failed to fetch user profile".into()));
        }

        Ok(resp.json().await?)
    }

    /// Register a device for sync.
    pub async fn register_device<'a>(
        http: &HttpClient<'a>,
        device_id: &str,
    ) -> Result<(), SyncError> {
        let url = format!("{}/devices?deviceId={}", API_HOST, device_id);
        let resp = http.post_form(&url, &[]).await?;

        if !resp.status().is_success() {
            return Err(SyncError::AuthFailed("device registration failed".into()));
        }

        Ok(())
    }
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-sync --test auth_test -- --nocapture`
Expected: 6 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync/
git commit -s -m "core: add multi-step auth flow and device registration"
```

---

## Task 7: SignalR JSON Hub Protocol

Implement the SignalR framing protocol: JSON messages delimited by `\x1E`. This is the transport layer for the sync protocol.

**Files:**
- Create: `wiredash/crates/wiredash-sync/src/signalr.rs`
- Create: `wiredash/crates/wiredash-sync/tests/signalr_test.rs`

**Step 1: Write the failing test**

```rust
// tests/signalr_test.rs
use wiredash_sync::signalr::*;

#[test]
fn test_encode_handshake() {
    let msg = SignalRCodec::encode_handshake();
    assert_eq!(msg, "{\"protocol\":\"json\",\"version\":1}\x1e");
}

#[test]
fn test_encode_invocation() {
    let msg = SignalRCodec::encode_invocation("PushCompletedV2", &["device123"]);
    // Should be valid JSON + record separator
    assert!(msg.ends_with('\u{1e}'));
    let json_part = &msg[..msg.len() - 1];
    let parsed: serde_json::Value = serde_json::from_str(json_part).unwrap();
    assert_eq!(parsed["type"], 1); // Invocation = type 1
    assert_eq!(parsed["target"], "PushCompletedV2");
    assert_eq!(parsed["arguments"][0], "device123");
}

#[test]
fn test_encode_invocation_with_id() {
    let msg = SignalRCodec::encode_invocation_with_id(
        "RequestFetchV3",
        &[serde_json::json!("dev123")],
        "inv-1",
    );
    let json_part = &msg[..msg.len() - 1];
    let parsed: serde_json::Value = serde_json::from_str(json_part).unwrap();
    assert_eq!(parsed["type"], 1);
    assert_eq!(parsed["invocationId"], "inv-1");
    assert_eq!(parsed["target"], "RequestFetchV3");
}

#[test]
fn test_decode_messages() {
    // Server sends multiple messages in one frame, separated by \x1e
    let raw = r#"{"type":1,"target":"SendItems","arguments":[{"items":[],"type":"note","count":0}]}"#.to_string() + "\x1e"
        + r#"{"type":6}"# + "\x1e";  // type 6 = Ping

    let msgs = SignalRCodec::decode_messages(&raw);
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["type"], 1);
    assert_eq!(msgs[0]["target"], "SendItems");
    assert_eq!(msgs[1]["type"], 6);
}

#[test]
fn test_decode_empty_and_whitespace() {
    let msgs = SignalRCodec::decode_messages("\x1e");
    assert_eq!(msgs.len(), 0);

    let msgs2 = SignalRCodec::decode_messages("");
    assert_eq!(msgs2.len(), 0);
}

#[test]
fn test_message_type_parsing() {
    assert_eq!(SignalRMessageType::from_value(1), SignalRMessageType::Invocation);
    assert_eq!(SignalRMessageType::from_value(3), SignalRMessageType::Completion);
    assert_eq!(SignalRMessageType::from_value(6), SignalRMessageType::Ping);
    assert_eq!(SignalRMessageType::from_value(7), SignalRMessageType::Close);
    assert_eq!(SignalRMessageType::from_value(99), SignalRMessageType::Unknown);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-sync --test signalr_test -- --nocapture`
Expected: FAIL.

**Step 3: Implement SignalR codec**

```rust
// wiredash-sync/src/signalr.rs
use serde_json::json;

const RS: char = '\x1e'; // Record separator

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalRMessageType {
    Invocation,       // 1
    StreamItem,       // 2
    Completion,       // 3
    StreamInvocation, // 4
    CancelInvocation, // 5
    Ping,             // 6
    Close,            // 7
    Unknown,
}

impl SignalRMessageType {
    pub fn from_value(v: i64) -> Self {
        match v {
            1 => Self::Invocation,
            2 => Self::StreamItem,
            3 => Self::Completion,
            4 => Self::StreamInvocation,
            5 => Self::CancelInvocation,
            6 => Self::Ping,
            7 => Self::Close,
            _ => Self::Unknown,
        }
    }
}

pub struct SignalRCodec;

impl SignalRCodec {
    /// Encode the initial handshake message.
    pub fn encode_handshake() -> String {
        format!("{{\"protocol\":\"json\",\"version\":1}}{RS}")
    }

    /// Encode a fire-and-forget invocation (no invocation ID, no return expected).
    pub fn encode_invocation(target: &str, str_args: &[&str]) -> String {
        let args: Vec<serde_json::Value> = str_args.iter()
            .map(|s| json!(s))
            .collect();
        let msg = json!({
            "type": 1,
            "target": target,
            "arguments": args,
        });
        format!("{}{RS}", serde_json::to_string(&msg).unwrap())
    }

    /// Encode an invocation with an invocation ID (expects a Completion response).
    pub fn encode_invocation_with_id(
        target: &str,
        args: &[serde_json::Value],
        invocation_id: &str,
    ) -> String {
        let msg = json!({
            "type": 1,
            "invocationId": invocation_id,
            "target": target,
            "arguments": args,
        });
        format!("{}{RS}", serde_json::to_string(&msg).unwrap())
    }

    /// Encode a Completion (return value) message — used when the server
    /// invokes a method on the client and the client returns a value.
    pub fn encode_completion(invocation_id: &str, result: &serde_json::Value) -> String {
        let msg = json!({
            "type": 3,
            "invocationId": invocation_id,
            "result": result,
        });
        format!("{}{RS}", serde_json::to_string(&msg).unwrap())
    }

    /// Encode a Ping message.
    pub fn encode_ping() -> String {
        format!("{{\"type\":6}}{RS}")
    }

    /// Decode a raw WebSocket text frame into individual JSON messages.
    /// Messages are separated by \x1e (record separator).
    pub fn decode_messages(raw: &str) -> Vec<serde_json::Value> {
        raw.split(RS)
            .filter(|s| !s.trim().is_empty())
            .filter_map(|s| serde_json::from_str(s).ok())
            .collect()
    }
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-sync --test signalr_test -- --nocapture`
Expected: 6 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync/
git commit -s -m "core: implement SignalR JSON Hub Protocol codec"
```

---

## Task 8: Item Collector (Batch Encrypt for Push)

Collects unsynced items from all 11 syncable collections, encrypts them, and yields `SyncTransferItem` batches.

**Files:**
- Create: `wiredash/crates/wiredash-sync/src/collector.rs`
- Create: `wiredash/crates/wiredash-sync/tests/collector_test.rs`

**Dependencies:** Requires adding a method to `wiredash-db` to query unsynced items generically.

**Step 1: Add `query_unsynced` to wiredash-db**

First, add a helper to `wiredash-db/src/connection.rs`:

```rust
/// Query all unsynced items from a table as JSON strings.
/// Returns Vec<(id, json_string)>.
pub fn query_unsynced(&self, table: &str) -> Result<Vec<(String, String)>, anyhow::Error> {
    // Build column list dynamically from the table's pragma
    let mut cols_stmt = self.conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let col_names: Vec<String> = cols_stmt.query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    let cols_csv = col_names.join(", ");
    let sql = format!(
        "SELECT id, {} FROM {} WHERE synced = 0 AND deleted = 0 ORDER BY id",
        cols_csv, table
    );

    let mut stmt = self.conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        // Build JSON object from all columns
        let mut map = serde_json::Map::new();
        for (i, col) in col_names.iter().enumerate() {
            let val: rusqlite::types::Value = row.get(i + 1)?;
            let json_val = match val {
                rusqlite::types::Value::Null => serde_json::Value::Null,
                rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                rusqlite::types::Value::Real(f) => serde_json::json!(f),
                rusqlite::types::Value::Text(s) => {
                    // Try parsing as JSON first (for nested objects like expiryDate)
                    serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))
                }
                rusqlite::types::Value::Blob(b) => {
                    serde_json::Value::String(base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD, &b
                    ))
                }
            };
            map.insert(col.clone(), json_val);
        }
        Ok((id, serde_json::Value::Object(map).to_string()))
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Mark items as synced (set synced=1) where dateModified <= cutoff.
pub fn mark_synced(&self, table: &str, ids: &[String], cutoff_ms: i64) -> Result<usize, anyhow::Error> {
    if ids.is_empty() {
        return Ok(0);
    }
    let placeholders: Vec<String> = ids.iter().enumerate()
        .map(|(i, _)| format!("?{}", i + 2))
        .collect();
    let sql = format!(
        "UPDATE {} SET synced = 1 WHERE id IN ({}) AND dateModified <= ?1",
        table,
        placeholders.join(", ")
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(cutoff_ms)];
    for id in ids {
        params.push(Box::new(id.clone()));
    }
    let refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    Ok(self.conn.execute(&sql, refs.as_slice())?)
}
```

Note: The above `query_unsynced` builds JSON from row columns dynamically. An alternative is to query raw JSON via `json_object()` if available, but the dynamic approach is more portable.

**Step 2: Write the collector test**

```rust
// tests/collector_test.rs
use wiredash_sync::collector::Collector;
use wiredash_sync::types::*;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

#[test]
fn test_collect_unsynced_notes() {
    let db = Database::open_memory().unwrap();

    // Insert an unsynced note directly
    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 0, 'Test Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["note-1", chrono::Utc::now().timestamp_millis()],
    ).unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector.collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE).unwrap();

    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].r#type, "note");
    assert_eq!(batches[0].count, 1);
    assert_eq!(batches[0].items.len(), 1);
    assert_eq!(batches[0].items[0].id, "note-1");
    assert_eq!(batches[0].items[0].v, CURRENT_DATABASE_VERSION);
    // Cipher should be non-empty
    assert!(!batches[0].items[0].cipher.cipher.is_empty());
}

#[test]
fn test_collect_skips_synced_items() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    // Insert a synced note
    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 1, 0, 'Synced Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["synced-note", now],
    ).unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector.collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE).unwrap();
    assert!(batches.is_empty());
}

#[test]
fn test_collect_local_only_becomes_tombstone() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    // Insert a localOnly unsynced note
    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 0, 'Local Note', 0, 0, 1, 0, 0, ?2)",
        rusqlite::params!["local-note", now],
    ).unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector.collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE).unwrap();

    // localOnly items should be encrypted as deletion tombstones
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].items.len(), 1);

    // We can verify the tombstone by decrypting
    use wiredash_crypto::encryption::Decryption;
    let decrypted = Decryption::decrypt(&batches[0].items[0].cipher, &key).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
    assert_eq!(parsed["deleted"], true);
    assert_eq!(parsed["id"], "local-note");
}
```

**Step 3: Implement Collector**

```rust
// wiredash-sync/src/collector.rs
use wiredash_crypto::encryption::Encryption;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;
use crate::types::*;

pub struct Collector<'a> {
    db: &'a Database,
}

impl<'a> Collector<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Collect unsynced items for one item type, encrypt them, and return
    /// batches of `SyncTransferItem` (each batch up to `batch_size` items).
    pub fn collect_for_type(
        &self,
        item_type: &str,
        table: &str,
        key: &SerializedKey,
        batch_size: usize,
    ) -> Result<Vec<SyncTransferItem>, SyncError> {
        let unsynced = self.db.query_unsynced(table)
            .map_err(SyncError::Database)?;

        if unsynced.is_empty() {
            return Ok(vec![]);
        }

        let mut all_items = Vec::new();
        for (id, json_str) in &unsynced {
            // Check if localOnly — if so, replace with tombstone
            let plaintext = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                let is_local_only = parsed.get("localOnly")
                    .and_then(|v| v.as_i64())
                    .map(|v| v != 0)
                    .unwrap_or(false);

                if is_local_only {
                    // Tombstone: { id, deleted: true, dateModified }
                    let tombstone = serde_json::json!({
                        "id": id,
                        "deleted": true,
                        "dateModified": parsed.get("dateModified").cloned()
                            .unwrap_or(serde_json::json!(chrono::Utc::now().timestamp_millis())),
                    });
                    tombstone.to_string()
                } else {
                    // Remove the `synced` field before encrypting
                    let mut obj = parsed;
                    if let Some(map) = obj.as_object_mut() {
                        map.remove("synced");
                    }
                    obj.to_string()
                }
            } else {
                json_str.clone()
            };

            let cipher = Encryption::encrypt(key, &plaintext)
                .map_err(SyncError::Crypto)?;

            all_items.push(SyncItem {
                id: id.clone(),
                v: CURRENT_DATABASE_VERSION,
                cipher,
            });
        }

        // Split into batches
        let batches: Vec<SyncTransferItem> = all_items
            .chunks(batch_size)
            .map(|chunk| SyncTransferItem {
                items: chunk.to_vec(),
                r#type: item_type.to_string(),
                count: chunk.len(),
            })
            .collect();

        Ok(batches)
    }

    /// Collect all unsynced items across all syncable collections.
    pub fn collect_all(
        &self,
        key: &SerializedKey,
        batch_size: usize,
    ) -> Result<Vec<SyncTransferItem>, SyncError> {
        let mut all_batches = Vec::new();
        for &(item_type, table) in SYNC_COLLECTIONS {
            let batches = self.collect_for_type(item_type, table, key, batch_size)?;
            all_batches.extend(batches);
        }
        Ok(all_batches)
    }
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-sync --test collector_test -- --nocapture`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync/ wiredash/crates/wiredash-db/
git commit -s -m "core: add sync item collector with batch encryption"
```

---

## Task 9: Item Merger (Conflict Resolution)

Port the conflict resolution logic from `merger.ts`. Last-write-wins for most items, content has special 60-second threshold.

**Files:**
- Create: `wiredash/crates/wiredash-sync/src/merger.rs`
- Create: `wiredash/crates/wiredash-sync/tests/merger_test.rs`

**Step 1: Write the failing tests**

```rust
// tests/merger_test.rs
use wiredash_sync::merger::*;
use serde_json::json;

fn make_item(date_modified: i64, deleted: bool) -> serde_json::Value {
    json!({
        "id": "item-1",
        "type": "note",
        "dateModified": date_modified,
        "dateCreated": 1000,
        "synced": false,
        "deleted": deleted,
        "title": "Test"
    })
}

fn make_content(date_modified: i64, date_edited: i64, synced: bool, data: &str) -> serde_json::Value {
    json!({
        "id": "content-1",
        "type": "content",
        "dateModified": date_modified,
        "dateCreated": 1000,
        "synced": synced,
        "deleted": false,
        "data": data,
        "dateEdited": date_edited,
        "locked": false,
        "localOnly": false
    })
}

#[test]
fn test_merge_item_no_local_takes_remote() {
    let remote = make_item(2000, false);
    let result = Merger::merge_item(None, &remote);
    assert!(result.is_some(), "should take remote when no local");
}

#[test]
fn test_merge_item_remote_newer_takes_remote() {
    let local = make_item(1000, false);
    let remote = make_item(2000, false);
    let result = Merger::merge_item(Some(&local), &remote);
    assert!(result.is_some(), "should take remote when newer");
}

#[test]
fn test_merge_item_local_newer_keeps_local() {
    let local = make_item(3000, false);
    let remote = make_item(2000, false);
    let result = Merger::merge_item(Some(&local), &remote);
    assert!(result.is_none(), "should skip remote when local is newer");
}

#[test]
fn test_merge_content_local_not_edited_takes_remote() {
    // Local is synced (not edited), remote is newer → take remote
    let local = make_content(1000, 1000, true, "<p>old</p>");
    let remote = make_content(2000, 2000, false, "<p>new</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert_eq!(result, MergeResult::TakeRemote(remote));
}

#[test]
fn test_merge_content_within_threshold_last_write_wins() {
    let now = chrono::Utc::now().timestamp_millis();
    // Both edited within 60s of each other
    let local = make_content(now, now, false, "<p>local edit</p>");
    let remote = make_content(now + 30_000, now + 30_000, false, "<p>remote edit</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    // Remote is newer → take remote (last-write-wins)
    assert!(matches!(result, MergeResult::TakeRemote(_)));
}

#[test]
fn test_merge_content_outside_threshold_conflict() {
    let now = chrono::Utc::now().timestamp_millis();
    // Edited 2 minutes apart — conflict
    let local = make_content(now, now, false, "<p>local version</p>");
    let remote = make_content(now + 120_000, now + 120_000, false, "<p>remote version</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert!(matches!(result, MergeResult::Conflict { .. }));
}

#[test]
fn test_merge_content_same_html_no_conflict() {
    let now = chrono::Utc::now().timestamp_millis();
    // Same content, 2 minutes apart — no conflict
    let local = make_content(now, now, false, "<p>same text</p>");
    let remote = make_content(now + 120_000, now + 120_000, false, "<p>same text</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    // Same HTML → last-write-wins (no conflict)
    assert!(matches!(result, MergeResult::TakeRemote(_)));
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-sync --test merger_test -- --nocapture`
Expected: FAIL.

**Step 3: Implement Merger**

```rust
// wiredash-sync/src/merger.rs

#[derive(Debug, PartialEq)]
pub enum MergeResult {
    /// Take the remote item (overwrite local).
    TakeRemote(serde_json::Value),
    /// Keep local, store remote as conflicted copy.
    Conflict {
        local: serde_json::Value,
        remote: serde_json::Value,
    },
    /// Skip — keep local as-is.
    Skip,
}

pub struct Merger;

impl Merger {
    /// Generic item merge: last-write-wins on dateModified.
    /// Returns Some(remote) if remote should be taken, None if skip.
    pub fn merge_item(
        local: Option<&serde_json::Value>,
        remote: &serde_json::Value,
    ) -> Option<serde_json::Value> {
        match local {
            None => Some(remote.clone()),
            Some(local_item) => {
                let local_dm = local_item.get("dateModified")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let remote_dm = remote.get("dateModified")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);

                if remote_dm > local_dm {
                    Some(remote.clone())
                } else {
                    None
                }
            }
        }
    }

    /// Content item merge with conflict detection.
    pub fn merge_content(
        local: Option<&serde_json::Value>,
        remote: &serde_json::Value,
        conflict_threshold_ms: i64,
    ) -> MergeResult {
        let local_item = match local {
            None => return MergeResult::TakeRemote(remote.clone()),
            Some(l) => l,
        };

        // If local has localOnly flag, skip entirely
        let local_only = local_item.get("localOnly")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .unwrap_or(false);
        if local_only {
            return MergeResult::Skip;
        }

        // If either is deleted, fall through to basic merge
        let local_deleted = local_item.get("deleted")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .unwrap_or(false);
        let remote_deleted = remote.get("deleted")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .unwrap_or(false);
        if local_deleted || remote_deleted {
            return match Self::merge_item(Some(local_item), remote) {
                Some(r) => MergeResult::TakeRemote(r),
                None => MergeResult::Skip,
            };
        }

        // Check if data fields exist
        let local_data = local_item.get("data").and_then(|v| v.as_str());
        let remote_data = remote.get("data").and_then(|v| v.as_str());
        if local_data.is_none() || remote_data.is_none() {
            return match Self::merge_item(Some(local_item), remote) {
                Some(r) => MergeResult::TakeRemote(r),
                None => MergeResult::Skip,
            };
        }

        // Check resolved state
        let date_resolved = local_item.get("dateResolved").and_then(|v| v.as_i64());
        let remote_dm = remote.get("dateModified").and_then(|v| v.as_i64()).unwrap_or(0);
        let is_resolved = date_resolved.map(|dr| dr == remote_dm).unwrap_or(false);

        // Check if local was edited (synced = false means local has unsynced changes)
        let is_edited = local_item.get("synced")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .map(|synced| !synced)
            .unwrap_or(true);

        if is_edited && !is_resolved {
            let local_de = local_item.get("dateEdited").and_then(|v| v.as_i64()).unwrap_or(0);
            let remote_de = remote.get("dateEdited").and_then(|v| v.as_i64()).unwrap_or(0);
            let time_diff = (remote_de - local_de).abs();

            if time_diff < conflict_threshold_ms || local_data == remote_data {
                // Within threshold or same content → last-write-wins
                let local_dm = local_item.get("dateModified").and_then(|v| v.as_i64()).unwrap_or(0);
                if remote_dm > local_dm {
                    MergeResult::TakeRemote(remote.clone())
                } else {
                    MergeResult::Skip
                }
            } else {
                // Real conflict
                MergeResult::Conflict {
                    local: local_item.clone(),
                    remote: remote.clone(),
                }
            }
        } else if !is_resolved {
            // Local not edited → take remote
            MergeResult::TakeRemote(remote.clone())
        } else {
            // Resolved → skip
            MergeResult::Skip
        }
    }
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-sync --test merger_test -- --nocapture`
Expected: 7 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync/
git commit -s -m "core: add conflict resolution merger for sync"
```

---

## Task 10: Sync Engine Orchestrator

The main `SyncEngine` that ties everything together: connects to the SignalR hub, runs fetch + send, handles server callbacks.

**Files:**
- Create: `wiredash/crates/wiredash-sync/src/sync_engine.rs`
- Create: `wiredash/crates/wiredash-sync/tests/sync_engine_test.rs`

This is the most complex task. The tests here are unit tests for the orchestration logic (message routing, state machine). Integration tests against the real server are deferred.

**Step 1: Write tests**

```rust
// tests/sync_engine_test.rs
use wiredash_sync::sync_engine::*;
use serde_json::json;

#[test]
fn test_process_server_message_ping() {
    let msg = json!({"type": 6});
    let action = SyncProcessor::process_server_message(&msg);
    assert_eq!(action, ServerAction::SendPing);
}

#[test]
fn test_process_server_message_send_items() {
    let msg = json!({
        "type": 1,
        "invocationId": "inv-1",
        "target": "SendItems",
        "arguments": [{
            "items": [{"id": "n1", "v": 6.1, "format": "base64", "alg": "xcha-argon2i13-7", "cipher": "abc", "iv": "def", "salt": "ghi", "length": 10}],
            "type": "note",
            "count": 1
        }]
    });
    let action = SyncProcessor::process_server_message(&msg);
    match action {
        ServerAction::ProcessItems { invocation_id, chunk } => {
            assert_eq!(invocation_id, "inv-1");
            assert_eq!(chunk.r#type, "note");
            assert_eq!(chunk.count, 1);
        }
        _ => panic!("expected ProcessItems"),
    }
}

#[test]
fn test_process_server_message_completion() {
    let msg = json!({"type": 3, "invocationId": "push-1", "result": 1});
    let action = SyncProcessor::process_server_message(&msg);
    match action {
        ServerAction::Completion { invocation_id, result } => {
            assert_eq!(invocation_id, "push-1");
            assert_eq!(result, json!(1));
        }
        _ => panic!("expected Completion"),
    }
}

#[test]
fn test_process_server_message_close() {
    let msg = json!({"type": 7});
    let action = SyncProcessor::process_server_message(&msg);
    assert_eq!(action, ServerAction::Close);
}

#[test]
fn test_process_server_message_send_vault_key() {
    let msg = json!({
        "type": 1,
        "invocationId": "inv-2",
        "target": "SendVaultKey",
        "arguments": [{"cipher": "abc"}]
    });
    let action = SyncProcessor::process_server_message(&msg);
    match action {
        ServerAction::VaultKey { invocation_id, .. } => {
            assert_eq!(invocation_id, "inv-2");
        }
        _ => panic!("expected VaultKey"),
    }
}

#[test]
fn test_device_id_generation() {
    let id1 = generate_device_id();
    let id2 = generate_device_id();
    assert_ne!(id1, id2, "should generate unique device IDs");
    assert!(!id1.is_empty());
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-sync --test sync_engine_test -- --nocapture`
Expected: FAIL.

**Step 3: Implement SyncProcessor and SyncEngine**

```rust
// wiredash-sync/src/sync_engine.rs
use crate::types::*;
use crate::signalr::*;
use crate::collector::Collector;
use crate::merger::{Merger, MergeResult};
use crate::token::TokenManager;
use crate::auth::AuthClient;
use wiredash_crypto::encryption::{Encryption, Decryption};
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

// ---------------------------------------------------------------------------
// Server message processing (testable without network)
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum ServerAction {
    SendPing,
    ProcessItems {
        invocation_id: String,
        chunk: SyncTransferItem,
    },
    VaultKey {
        invocation_id: String,
        key: serde_json::Value,
    },
    Monographs {
        invocation_id: String,
        monographs: serde_json::Value,
    },
    InboxItems {
        invocation_id: String,
        items: serde_json::Value,
    },
    Completion {
        invocation_id: String,
        result: serde_json::Value,
    },
    Close,
    Unknown(serde_json::Value),
}

pub struct SyncProcessor;

impl SyncProcessor {
    /// Process a single SignalR message from the server.
    pub fn process_server_message(msg: &serde_json::Value) -> ServerAction {
        let msg_type = msg.get("type").and_then(|v| v.as_i64()).unwrap_or(0);

        match SignalRMessageType::from_value(msg_type) {
            SignalRMessageType::Ping => ServerAction::SendPing,
            SignalRMessageType::Close => ServerAction::Close,
            SignalRMessageType::Completion => {
                let inv_id = msg.get("invocationId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let result = msg.get("result").cloned().unwrap_or(serde_json::Value::Null);
                ServerAction::Completion { invocation_id: inv_id, result }
            }
            SignalRMessageType::Invocation => {
                let target = msg.get("target").and_then(|v| v.as_str()).unwrap_or("");
                let inv_id = msg.get("invocationId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let args = msg.get("arguments").cloned().unwrap_or(serde_json::json!([]));

                match target {
                    "SendItems" => {
                        let chunk: SyncTransferItem = serde_json::from_value(
                            args.as_array()
                                .and_then(|a| a.first())
                                .cloned()
                                .unwrap_or_default(),
                        )
                        .unwrap_or(SyncTransferItem {
                            items: vec![],
                            r#type: String::new(),
                            count: 0,
                        });
                        ServerAction::ProcessItems { invocation_id: inv_id, chunk }
                    }
                    "SendVaultKey" => {
                        let key = args.as_array()
                            .and_then(|a| a.first())
                            .cloned()
                            .unwrap_or_default();
                        ServerAction::VaultKey { invocation_id: inv_id, key }
                    }
                    "SendMonographs" => {
                        let monographs = args.as_array()
                            .and_then(|a| a.first())
                            .cloned()
                            .unwrap_or_default();
                        ServerAction::Monographs { invocation_id: inv_id, monographs }
                    }
                    "SendInboxItems" => {
                        let items = args.as_array()
                            .and_then(|a| a.first())
                            .cloned()
                            .unwrap_or_default();
                        ServerAction::InboxItems { invocation_id: inv_id, items }
                    }
                    _ => ServerAction::Unknown(msg.clone()),
                }
            }
            _ => ServerAction::Unknown(msg.clone()),
        }
    }
}

/// Generate a unique device ID (ObjectId-style).
pub fn generate_device_id() -> String {
    uuid::Uuid::new_v4().to_string().replace("-", "")[..24].to_string()
}

// ---------------------------------------------------------------------------
// SyncEngine (the full orchestrator — requires async + network)
// ---------------------------------------------------------------------------

pub struct SyncEngine<'a> {
    db: &'a Database,
    token_manager: &'a TokenManager<'a>,
    encryption_key: SerializedKey,
    device_id: String,
}

impl<'a> SyncEngine<'a> {
    pub fn new(
        db: &'a Database,
        token_manager: &'a TokenManager<'a>,
        encryption_key: SerializedKey,
        device_id: String,
    ) -> Self {
        Self { db, token_manager, encryption_key, device_id }
    }

    /// Process a fetched chunk: decrypt items, merge with local, write to DB.
    pub fn process_chunk(&self, chunk: &SyncTransferItem) -> Result<(usize, usize), SyncError> {
        let table = SYNC_COLLECTIONS.iter()
            .find(|(item_type, _)| *item_type == chunk.r#type)
            .map(|(_, table)| *table)
            .unwrap_or(&chunk.r#type);

        let mut pulled = 0;
        let mut conflicts = 0;

        for sync_item in &chunk.items {
            // Decrypt
            let plaintext = Decryption::decrypt(&sync_item.cipher, &self.encryption_key)
                .map_err(SyncError::Crypto)?;
            let mut remote: serde_json::Value = serde_json::from_str(&plaintext)?;

            // Mark as remote + synced
            if let Some(obj) = remote.as_object_mut() {
                obj.insert("synced".into(), serde_json::json!(true));
                obj.insert("remote".into(), serde_json::json!(true));
            }

            // Look up local item
            let local = self.get_local_item(table, &sync_item.id)?;

            // Merge
            let is_content = chunk.r#type == "content";
            if is_content {
                match Merger::merge_content(local.as_ref(), &remote, CONFLICT_THRESHOLD_MS) {
                    MergeResult::TakeRemote(item) => {
                        self.upsert_item(table, &item)?;
                        pulled += 1;
                    }
                    MergeResult::Conflict { mut local, remote } => {
                        // Store remote as conflicted copy in local
                        if let Some(obj) = local.as_object_mut() {
                            obj.insert("conflicted".into(), remote);
                        }
                        self.upsert_item(table, &local)?;
                        conflicts += 1;
                    }
                    MergeResult::Skip => {}
                }
            } else {
                if let Some(merged) = Merger::merge_item(local.as_ref(), &remote) {
                    self.upsert_item(table, &merged)?;
                    pulled += 1;
                }
            }
        }

        Ok((pulled, conflicts))
    }

    fn get_local_item(&self, table: &str, id: &str) -> Result<Option<serde_json::Value>, SyncError> {
        let conn = self.db.conn();
        let sql = format!("SELECT * FROM {} WHERE id = ?1", table);
        let mut stmt = conn.prepare(&sql).map_err(|e| SyncError::Database(e.into()))?;

        // Get column names
        let col_count = stmt.column_count();
        let col_names: Vec<String> = (0..col_count)
            .map(|i| stmt.column_name(i).unwrap_or("").to_string())
            .collect();

        let result = stmt.query_row(rusqlite::params![id], |row| {
            let mut map = serde_json::Map::new();
            for (i, col) in col_names.iter().enumerate() {
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                    rusqlite::types::Value::Real(f) => serde_json::json!(f),
                    rusqlite::types::Value::Text(s) => {
                        serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))
                    }
                    rusqlite::types::Value::Blob(_) => serde_json::Value::Null,
                };
                map.insert(col.clone(), json_val);
            }
            Ok(serde_json::Value::Object(map))
        });

        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(SyncError::Database(e.into())),
        }
    }

    fn upsert_item(&self, table: &str, item: &serde_json::Value) -> Result<(), SyncError> {
        let obj = item.as_object().ok_or_else(|| SyncError::Database(
            anyhow::anyhow!("item is not an object"),
        ))?;

        let id = obj.get("id").and_then(|v| v.as_str()).ok_or_else(|| {
            SyncError::Database(anyhow::anyhow!("item has no id"))
        })?;

        // Get table columns
        let conn = self.db.conn();
        let mut cols_stmt = conn.prepare(&format!("PRAGMA table_info({})", table))
            .map_err(|e| SyncError::Database(e.into()))?;
        let col_names: Vec<String> = cols_stmt.query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| SyncError::Database(e.into()))?
            .filter_map(|r| r.ok())
            .collect();

        // Build INSERT OR REPLACE
        let placeholders: Vec<String> = (1..=col_names.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
            table,
            col_names.join(", "),
            placeholders.join(", "),
        );

        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for col in &col_names {
            let val = obj.get(col).cloned().unwrap_or(serde_json::Value::Null);
            match val {
                serde_json::Value::Null => params.push(Box::new(rusqlite::types::Null)),
                serde_json::Value::Bool(b) => params.push(Box::new(b as i32)),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        params.push(Box::new(i));
                    } else if let Some(f) = n.as_f64() {
                        params.push(Box::new(f));
                    } else {
                        params.push(Box::new(n.to_string()));
                    }
                }
                serde_json::Value::String(s) => params.push(Box::new(s)),
                other => params.push(Box::new(other.to_string())),
            }
        }

        let refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, refs.as_slice()).map_err(|e| SyncError::Database(e.into()))?;

        Ok(())
    }
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-sync --test sync_engine_test -- --nocapture`
Expected: 6 tests PASS.

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-sync/
git commit -s -m "core: add sync engine orchestrator with fetch/merge/push"
```

---

## Task 11: Integration Test — Full Sync Round-Trip (Offline)

End-to-end test that simulates a sync flow without the network: encrypt items, process as if received from server, merge, verify.

**Files:**
- Create: `wiredash/crates/wiredash-sync/tests/integration_test.rs`

**Step 1: Write the integration test**

```rust
// tests/integration_test.rs
use wiredash_sync::collector::Collector;
use wiredash_sync::merger::{Merger, MergeResult};
use wiredash_sync::sync_engine::{SyncEngine, SyncProcessor, ServerAction, generate_device_id};
use wiredash_sync::signalr::SignalRCodec;
use wiredash_sync::token::TokenManager;
use wiredash_sync::types::*;
use wiredash_crypto::encryption::{Encryption, Decryption};
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;
use wiredash_db::kv::KvStore;

#[test]
fn test_full_offline_sync_roundtrip() {
    // -----------------------------------------------------------------------
    // 1. Set up two "devices" (two in-memory databases + shared encryption key)
    // -----------------------------------------------------------------------
    let db_a = Database::open_memory().unwrap();
    let db_b = Database::open_memory().unwrap();

    let key = SerializedKey {
        password: Some("shared-password".into()),
        key: None,
        salt: None,
    };

    // -----------------------------------------------------------------------
    // 2. Device A creates a note
    // -----------------------------------------------------------------------
    let now = chrono::Utc::now().timestamp_millis();
    db_a.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 0, 'Device A Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["note-shared", now],
    ).unwrap();

    // -----------------------------------------------------------------------
    // 3. Device A collects unsynced items (simulates push)
    // -----------------------------------------------------------------------
    let collector_a = Collector::new(&db_a);
    let batches = collector_a.collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE).unwrap();
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].items.len(), 1);

    // -----------------------------------------------------------------------
    // 4. Device B processes the batch (simulates fetch + merge)
    // -----------------------------------------------------------------------
    let tm_b = TokenManager::new(&db_b);
    let device_id = generate_device_id();
    let engine_b = SyncEngine::new(&db_b, &tm_b, key.clone(), device_id);
    let (pulled, conflicts) = engine_b.process_chunk(&batches[0]).unwrap();
    assert_eq!(pulled, 1);
    assert_eq!(conflicts, 0);

    // Verify the note landed in Device B's database
    let row: String = db_b.conn()
        .query_row("SELECT title FROM notes WHERE id = 'note-shared'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(row, "Device A Note");

    // -----------------------------------------------------------------------
    // 5. Device B edits the note
    // -----------------------------------------------------------------------
    let later = now + 5000;
    db_b.execute(
        "UPDATE notes SET title = 'Device B Edit', dateModified = ?1, synced = 0 WHERE id = 'note-shared'",
        rusqlite::params![later],
    ).unwrap();

    // -----------------------------------------------------------------------
    // 6. Device B collects and sends back
    // -----------------------------------------------------------------------
    let collector_b = Collector::new(&db_b);
    let batches_b = collector_b.collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE).unwrap();
    assert_eq!(batches_b.len(), 1);

    // -----------------------------------------------------------------------
    // 7. Device A receives Device B's edit
    // -----------------------------------------------------------------------
    let tm_a = TokenManager::new(&db_a);
    let device_id_a = generate_device_id();
    let engine_a = SyncEngine::new(&db_a, &tm_a, key.clone(), device_id_a);
    let (pulled_a, conflicts_a) = engine_a.process_chunk(&batches_b[0]).unwrap();
    assert_eq!(pulled_a, 1);
    assert_eq!(conflicts_a, 0);

    // Verify Device A now has the updated title
    let updated: String = db_a.conn()
        .query_row("SELECT title FROM notes WHERE id = 'note-shared'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(updated, "Device B Edit");
}

#[test]
fn test_signalr_message_routing() {
    // Verify the full SignalR codec + processor pipeline
    let handshake = SignalRCodec::encode_handshake();
    assert!(handshake.contains("json"));

    let invoke = SignalRCodec::encode_invocation_with_id(
        "RequestFetchV3",
        &[serde_json::json!("dev-1")],
        "fetch-1",
    );
    // Decode what we encoded
    let msgs = SignalRCodec::decode_messages(&invoke);
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["target"], "RequestFetchV3");

    // Process a ping
    let action = SyncProcessor::process_server_message(&serde_json::json!({"type": 6}));
    assert_eq!(action, ServerAction::SendPing);
}

#[test]
fn test_token_kv_roundtrip() {
    let db = Database::open_memory().unwrap();
    let kv = KvStore::new(&db);
    let tm = TokenManager::new(&db);

    // No token initially
    assert!(tm.get_token().unwrap().is_none());

    // Save a token
    let token = Token {
        access_token: "abc".into(),
        refresh_token: "def".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();

    // Read back
    let stored = tm.get_token().unwrap().unwrap();
    assert_eq!(stored.access_token, "abc");
    assert!(!stored.is_expired());
    assert!(stored.is_refreshable());

    // Delete
    tm.delete_token().unwrap();
    assert!(tm.get_token().unwrap().is_none());
}

#[test]
fn test_content_conflict_detection() {
    let now = chrono::Utc::now().timestamp_millis();

    // Two devices edit the same content >60s apart with different data → conflict
    let local = serde_json::json!({
        "id": "c-1", "type": "content", "data": "<p>local text</p>",
        "dateModified": now, "dateEdited": now,
        "synced": false, "deleted": false, "localOnly": false,
    });
    let remote = serde_json::json!({
        "id": "c-1", "type": "content", "data": "<p>remote text</p>",
        "dateModified": now + 120_000, "dateEdited": now + 120_000,
        "synced": false, "deleted": false,
    });

    let result = Merger::merge_content(Some(&local), &remote, CONFLICT_THRESHOLD_MS);
    assert!(matches!(result, MergeResult::Conflict { .. }));

    // Same content → no conflict even if >60s apart
    let remote_same = serde_json::json!({
        "id": "c-1", "type": "content", "data": "<p>local text</p>",
        "dateModified": now + 120_000, "dateEdited": now + 120_000,
        "synced": false, "deleted": false,
    });
    let result2 = Merger::merge_content(Some(&local), &remote_same, CONFLICT_THRESHOLD_MS);
    assert!(matches!(result2, MergeResult::TakeRemote(_)));
}
```

**Step 2: Run all tests**

Run: `cd wiredash && cargo test -p wiredash-sync -- --nocapture`
Expected: ALL tests PASS (types + token + auth + signalr + collector + merger + sync_engine + integration).

**Step 3: Commit**

```bash
git add wiredash/crates/wiredash-sync/
git commit -s -m "core: add sync integration tests for offline round-trip"
```

---

## Task 12: Update lib.rs Exports and Run Full Workspace Tests

Clean up module exports, ensure all crates compile together, run the full test suite.

**Files:**
- Modify: `wiredash/crates/wiredash-sync/src/lib.rs` (ensure all modules are public)
- Modify: `wiredash/crates/wiredash-db/src/lib.rs` (ensure kv is exported)

**Step 1: Verify lib.rs exports**

`wiredash-sync/src/lib.rs` should be:
```rust
pub mod types;
pub mod password;   // re-export from wiredash-crypto for convenience
pub mod auth;
pub mod token;
pub mod http;
pub mod signalr;
pub mod collector;
pub mod merger;
pub mod sync_engine;
```

Wait — `password` is in `wiredash-crypto`, not `wiredash-sync`. Remove the `pub mod password;` line from `wiredash-sync/src/lib.rs`. The auth module already imports from `wiredash_crypto::password::Password` directly.

`wiredash-db/src/lib.rs` should be:
```rust
mod connection;
pub mod kv;
pub use connection::Database;
```

**Step 2: Run full workspace tests**

Run: `cd wiredash && cargo test --workspace -- --nocapture`

Expected: ALL tests across all 4 crates PASS. Count should be approximately:
- `wiredash-crypto`: 6 tests (key, encryption, password)
- `wiredash-db`: 5 tests (schema, kv)
- `wiredash-core`: ~20 tests (types, notes, notebooks, relations, collections, search, integration)
- `wiredash-sync`: ~30 tests (types, token, auth, signalr, collector, merger, sync_engine, integration)

**Step 3: Commit**

```bash
git add wiredash/
git commit -s -m "core: finalize Phase 2 exports and pass full workspace tests"
```

---

## NOT Doing (Deferred)

- **Live server integration test** — Requires real account credentials. Will add in Phase 2.5 or as manual verification step.
- **CLI tool** — Originally planned as Phase 2 deliverable, but the sync engine is now testable without it. CLI will be added in a quick follow-up task.
- **SSE (Server-Sent Events)** — Used for real-time push notifications from other devices. Not needed for basic sync.
- **Attachment upload/download** — S3 file operations for encrypted attachments. Deferred to Phase 3+.
- **Auto-sync** — Event-driven sync on database changes. Deferred to when we have the iced UI.
- **User signup** — Signup endpoint implementation. Login is the priority.
- **MFA setup/management** — Only MFA login verification is implemented, not setup flow.

## Verification Checklist

After all tasks:
1. `cargo test --workspace` — all tests pass
2. `cargo check --workspace` — no compilation errors
3. `cargo clippy --workspace` — no warnings (run but don't block)
4. Verify token storage works: KV round-trip test passes
5. Verify encryption compatibility: items encrypted by collector can be decrypted by sync engine
6. Verify conflict detection: content merge tests cover threshold and HTML comparison
7. Verify SignalR codec: encode/decode round-trip tests pass
