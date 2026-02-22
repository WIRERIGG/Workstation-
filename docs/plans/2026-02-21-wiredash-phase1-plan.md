# WIREDASH Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the core Rust library crates (crypto, database, business logic) that can create, read, update, and delete all 17 entity types with byte-compatible encryption — no UI.

**Architecture:** Cargo workspace with 3 library crates (`wiredash-crypto`, `wiredash-db`, `wiredash-core`). rusqlite + sqlcipher for encrypted SQLite. sodiumoxide for libsodium crypto. All collections follow the same `Collection<T>` trait pattern.

**Tech Stack:** Rust 1.82+, rusqlite (bundled-sqlcipher), sodiumoxide, serde/serde_json, chrono, uuid, thiserror/anyhow, tokio (dev-dependency for async tests)

**Reference Design:** `docs/plans/2026-02-21-wiredash-rust-rewrite-design.md`

---

## Task 1: Scaffold Cargo Workspace

**Files:**
- Create: `wiredash/Cargo.toml`
- Create: `wiredash/crates/wiredash-crypto/Cargo.toml`
- Create: `wiredash/crates/wiredash-crypto/src/lib.rs`
- Create: `wiredash/crates/wiredash-db/Cargo.toml`
- Create: `wiredash/crates/wiredash-db/src/lib.rs`
- Create: `wiredash/crates/wiredash-core/Cargo.toml`
- Create: `wiredash/crates/wiredash-core/src/lib.rs`

**Step 1: Create workspace root**

```toml
# wiredash/Cargo.toml
[workspace]
resolver = "2"
members = [
    "crates/wiredash-crypto",
    "crates/wiredash-db",
    "crates/wiredash-core",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "GPL-3.0"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
anyhow = "1"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
```

**Step 2: Create wiredash-crypto crate**

```toml
# wiredash/crates/wiredash-crypto/Cargo.toml
[package]
name = "wiredash-crypto"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
sodiumoxide = "0.2"
base64 = "0.22"
```

```rust
// wiredash/crates/wiredash-crypto/src/lib.rs
pub mod encryption;
pub mod key;
pub mod types;

pub use types::*;
```

**Step 3: Create wiredash-db crate**

```toml
# wiredash/crates/wiredash-db/Cargo.toml
[package]
name = "wiredash-db"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
anyhow.workspace = true
rusqlite = { version = "0.32", features = ["bundled-sqlcipher", "column_decltype"] }
tracing.workspace = true
```

```rust
// wiredash/crates/wiredash-db/src/lib.rs
pub mod connection;
pub mod schema;
pub mod migrations;

pub use connection::Database;
```

**Step 4: Create wiredash-core crate**

```toml
# wiredash/crates/wiredash-core/Cargo.toml
[package]
name = "wiredash-core"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
anyhow.workspace = true
uuid.workspace = true
chrono.workspace = true
tracing.workspace = true
wiredash-crypto = { path = "../wiredash-crypto" }
wiredash-db = { path = "../wiredash-db" }

[dev-dependencies]
tempfile = "3"
```

```rust
// wiredash/crates/wiredash-core/src/lib.rs
pub mod types;
pub mod collections;

pub use types::*;
```

**Step 5: Verify it compiles**

Run: `cd wiredash && cargo check`
Expected: Compiles with no errors.

**Step 6: Initialize git and commit**

```bash
cd wiredash
git init
echo "target/" > .gitignore
git add -A
git commit -s -m "setup: scaffold cargo workspace with 3 crates"
```

---

## Task 2: Core Types — BaseItem and Entity Structs

**Files:**
- Create: `wiredash/crates/wiredash-core/src/types.rs`
- Test: `wiredash/crates/wiredash-core/tests/types_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-core/tests/types_test.rs
use wiredash_core::types::*;

#[test]
fn test_note_serialization_roundtrip() {
    let note = Note {
        base: BaseItem::new("note"),
        title: "Test Note".into(),
        headline: Some("First line".into()),
        content_id: Some("content123".into()),
        pinned: false,
        favorite: true,
        local_only: false,
        conflicted: false,
        readonly: false,
        date_edited: 1700000000000,
        is_generated_title: Some(false),
        archived: Some(false),
        expiry_date: None,
    };

    let json = serde_json::to_string(&note).unwrap();
    let deserialized: Note = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.base.id, note.base.id);
    assert_eq!(deserialized.title, "Test Note");
    assert_eq!(deserialized.favorite, true);
}

#[test]
fn test_base_item_generates_uuid() {
    let a = BaseItem::new("note");
    let b = BaseItem::new("note");
    assert_ne!(a.id, b.id);
    assert_eq!(a.item_type, "note");
    assert!(a.date_created > 0);
}

#[test]
fn test_notebook_default_values() {
    let nb = Notebook {
        base: BaseItem::new("notebook"),
        title: "Work".into(),
        description: None,
        date_edited: 0,
        pinned: false,
    };
    assert_eq!(nb.base.deleted, false);
    assert_eq!(nb.base.synced, false);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-core`
Expected: FAIL — `types` module not found.

**Step 3: Write the types module**

```rust
// wiredash/crates/wiredash-core/src/types.rs
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Timestamp in Unix milliseconds
pub type Timestamp = i64;

fn now_ms() -> Timestamp {
    chrono::Utc::now().timestamp_millis()
}

/// Base fields shared by all syncable items.
/// Maps 1:1 to the 6 base columns in every Workstation SQLite table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BaseItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(rename = "dateCreated")]
    pub date_created: Timestamp,
    #[serde(rename = "dateModified")]
    pub date_modified: Timestamp,
    pub synced: bool,
    pub deleted: bool,
}

impl BaseItem {
    pub fn new(item_type: &str) -> Self {
        let now = now_ms();
        Self {
            id: Uuid::new_v4().to_string(),
            item_type: item_type.to_string(),
            date_created: now,
            date_modified: now,
            synced: false,
            deleted: false,
        }
    }
}

/// Trash metadata for items that support soft-delete (notes, notebooks).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TrashMeta {
    #[serde(rename = "dateDeleted")]
    pub date_deleted: Option<Timestamp>,
    #[serde(rename = "itemType")]
    pub item_type: Option<String>,
    #[serde(rename = "deletedBy")]
    pub deleted_by: Option<String>,
}

// ── Entity types ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(flatten)]
    pub trash: TrashMeta,
    pub title: String,
    pub headline: Option<String>,
    #[serde(rename = "contentId")]
    pub content_id: Option<String>,
    pub pinned: bool,
    pub favorite: bool,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub conflicted: bool,
    pub readonly: bool,
    #[serde(rename = "dateEdited")]
    pub date_edited: Timestamp,
    #[serde(rename = "isGeneratedTitle")]
    pub is_generated_title: Option<bool>,
    pub archived: Option<bool>,
    #[serde(rename = "expiryDate")]
    pub expiry_date: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Notebook {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(flatten)]
    pub trash: TrashMeta,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "dateEdited")]
    pub date_edited: Timestamp,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentItem {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "noteId")]
    pub note_id: Option<String>,
    pub data: Option<String>,
    pub locked: bool,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub conflicted: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "dateEdited")]
    pub date_edited: Timestamp,
    #[serde(rename = "dateResolved")]
    pub date_resolved: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tag {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Color {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    #[serde(rename = "colorCode")]
    pub color_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Attachment {
    #[serde(flatten)]
    pub base: BaseItem,
    pub iv: String,
    pub salt: String,
    pub size: i64,
    pub alg: String,
    pub key: String,
    #[serde(rename = "chunkSize")]
    pub chunk_size: i64,
    pub hash: String,
    #[serde(rename = "hashType")]
    pub hash_type: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub filename: String,
    #[serde(rename = "dateDeleted")]
    pub date_deleted: Option<Timestamp>,
    #[serde(rename = "dateUploaded")]
    pub date_uploaded: Option<Timestamp>,
    pub failed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Relation {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "fromType")]
    pub from_type: String,
    #[serde(rename = "fromId")]
    pub from_id: String,
    #[serde(rename = "toType")]
    pub to_type: String,
    #[serde(rename = "toId")]
    pub to_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Reminder {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    pub description: Option<String>,
    pub priority: String,
    pub date: Timestamp,
    pub mode: String,
    #[serde(rename = "recurringMode")]
    pub recurring_mode: Option<String>,
    #[serde(rename = "selectedDays")]
    pub selected_days: Option<Vec<i32>>,
    #[serde(rename = "localOnly")]
    pub local_only: Option<bool>,
    pub disabled: Option<bool>,
    #[serde(rename = "snoozeUntil")]
    pub snooze_until: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Vault {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    pub key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Shortcut {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "sortIndex")]
    pub sort_index: i32,
    #[serde(rename = "itemId")]
    pub item_id: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Monograph {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "datePublished")]
    pub date_published: Timestamp,
    pub title: String,
    #[serde(rename = "selfDestruct")]
    pub self_destruct: bool,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SettingItem {
    #[serde(flatten)]
    pub base: BaseItem,
    pub key: String,
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistorySession {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "noteId")]
    pub note_id: String,
    #[serde(rename = "sessionContentId")]
    pub session_content_id: String,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub locked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionContentItem {
    #[serde(flatten)]
    pub base: BaseItem,
    pub data: Option<String>,
    #[serde(rename = "contentType")]
    pub content_type: Option<String>,
    pub locked: bool,
    pub compressed: bool,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub title: Option<String>,
}
```

**Step 4: Run tests to verify they pass**

Run: `cd wiredash && cargo test -p wiredash-core`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "core: add all 15 entity type structs with serde"
```

---

## Task 3: Crypto — Key Derivation

**Files:**
- Create: `wiredash/crates/wiredash-crypto/src/types.rs`
- Create: `wiredash/crates/wiredash-crypto/src/key.rs`
- Test: `wiredash/crates/wiredash-crypto/tests/key_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-crypto/tests/key_test.rs
use wiredash_crypto::key::KeyUtils;

#[test]
fn test_derive_key_produces_32_bytes() {
    let password = "test-password-123";
    let (key, salt) = KeyUtils::derive_key(password, None).unwrap();
    assert_eq!(key.len(), 32);
    assert_eq!(salt.len(), 16);
}

#[test]
fn test_derive_key_deterministic_with_same_salt() {
    let password = "test-password-123";
    let (key1, salt) = KeyUtils::derive_key(password, None).unwrap();
    let (key2, _) = KeyUtils::derive_key(password, Some(&salt)).unwrap();
    assert_eq!(key1, key2);
}

#[test]
fn test_derive_key_different_passwords_different_keys() {
    let (key1, salt) = KeyUtils::derive_key("password1", None).unwrap();
    let (key2, _) = KeyUtils::derive_key("password2", Some(&salt)).unwrap();
    assert_ne!(key1, key2);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-crypto`
Expected: FAIL — `key` module not found.

**Step 3: Write types module**

```rust
// wiredash/crates/wiredash-crypto/src/types.rs
use serde::{Deserialize, Serialize};

/// Algorithm identifier string matching Workstation format.
/// Format: "xcha-argon2i13-7" = XChaCha20 + Argon2i 1.3 + base64 URLSAFE_NO_PADDING (variant 7)
pub const ALGORITHM: &str = "xcha-argon2i13-7";

/// Encrypted data envelope — byte-compatible with Workstation's Cipher<"base64"> type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Cipher {
    pub format: String,
    pub alg: String,
    pub cipher: String,
    pub iv: String,
    pub salt: String,
    pub length: usize,
}

/// Serialized key for storage/transmission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedKey {
    pub password: Option<String>,
    pub key: Option<String>,
    pub salt: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("sodiumoxide initialization failed")]
    InitFailed,
    #[error("key derivation failed")]
    KeyDerivationFailed,
    #[error("encryption failed")]
    EncryptionFailed,
    #[error("decryption failed — wrong key or corrupted data")]
    DecryptionFailed,
    #[error("base64 decode error: {0}")]
    Base64Error(#[from] base64::DecodeError),
}
```

**Step 4: Write key derivation module**

```rust
// wiredash/crates/wiredash-crypto/src/key.rs
use crate::types::CryptoError;
use sodiumoxide::crypto::pwhash;

/// Argon2i parameters matching Workstation's packages/crypto/src/keyutils.ts:
/// - opsLimit: 3
/// - memLimit: 8 MB (1024 * 1024 * 8)
/// - algorithm: crypto_pwhash_ALG_ARGON2I13
/// - output key: 32 bytes
const OPS_LIMIT: pwhash::OpsLimit = pwhash::OpsLimit(3);
const MEM_LIMIT: pwhash::MemLimit = pwhash::MemLimit(1024 * 1024 * 8);

pub struct KeyUtils;

impl KeyUtils {
    /// Derive a 32-byte encryption key from a password using Argon2i 1.3.
    /// If salt is None, generates a random 16-byte salt.
    /// Returns (key_bytes, salt_bytes).
    pub fn derive_key(
        password: &str,
        salt: Option<&[u8]>,
    ) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
        sodiumoxide::init().map_err(|_| CryptoError::InitFailed)?;

        let salt_bytes = match salt {
            Some(s) => {
                let mut buf = [0u8; pwhash::SALTBYTES];
                buf.copy_from_slice(&s[..pwhash::SALTBYTES]);
                pwhash::Salt(buf)
            }
            None => pwhash::gen_salt(),
        };

        let mut key = [0u8; 32];
        pwhash::derive_key(
            &mut key,
            password.as_bytes(),
            &salt_bytes,
            OPS_LIMIT,
            MEM_LIMIT,
        )
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

        Ok((key.to_vec(), salt_bytes.0.to_vec()))
    }

    /// Transform a SerializedKey into raw 32-byte key + salt.
    /// If password is set, derives key. If key is set, decodes from base64.
    pub fn transform(serialized: &crate::types::SerializedKey) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
        use base64::Engine;
        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;

        if let Some(ref password) = serialized.password {
            let salt = serialized
                .salt
                .as_ref()
                .map(|s| engine.decode(s))
                .transpose()?;
            Self::derive_key(password, salt.as_deref())
        } else if let Some(ref key_b64) = serialized.key {
            let key = engine.decode(key_b64)?;
            let salt = serialized
                .salt
                .as_ref()
                .map(|s| engine.decode(s))
                .transpose()?
                .unwrap_or_default();
            Ok((key, salt))
        } else {
            Err(CryptoError::KeyDerivationFailed)
        }
    }
}
```

**Step 5: Update lib.rs**

```rust
// wiredash/crates/wiredash-crypto/src/lib.rs
pub mod encryption;
pub mod key;
pub mod types;

pub use types::*;
```

Create placeholder encryption module:
```rust
// wiredash/crates/wiredash-crypto/src/encryption.rs
// Implemented in Task 4
```

**Step 6: Run tests to verify they pass**

Run: `cd wiredash && cargo test -p wiredash-crypto`
Expected: 3 tests PASS.

**Step 7: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "crypto: add Argon2i key derivation matching Workstation params"
```

---

## Task 4: Crypto — Encrypt and Decrypt

**Files:**
- Modify: `wiredash/crates/wiredash-crypto/src/encryption.rs`
- Test: `wiredash/crates/wiredash-crypto/tests/encryption_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-crypto/tests/encryption_test.rs
use wiredash_crypto::encryption::{Decryption, Encryption};
use wiredash_crypto::types::SerializedKey;

#[test]
fn test_encrypt_decrypt_roundtrip() {
    let key = SerializedKey {
        password: Some("my-secret-password".into()),
        key: None,
        salt: None,
    };

    let plaintext = "Hello, WIREDASH!";
    let cipher = Encryption::encrypt(&key, plaintext).unwrap();

    assert_eq!(cipher.format, "base64");
    assert_eq!(cipher.alg, "xcha-argon2i13-7");
    assert_eq!(cipher.length, plaintext.len());
    assert!(!cipher.cipher.is_empty());
    assert!(!cipher.iv.is_empty());
    assert!(!cipher.salt.is_empty());

    // Decrypt using the salt from the cipher (simulates stored data)
    let decrypt_key = SerializedKey {
        password: Some("my-secret-password".into()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let decrypted = Decryption::decrypt(&cipher, &decrypt_key).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_wrong_password_fails() {
    let key = SerializedKey {
        password: Some("correct-password".into()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, "secret data").unwrap();

    let wrong_key = SerializedKey {
        password: Some("wrong-password".into()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let result = Decryption::decrypt(&cipher, &wrong_key);
    assert!(result.is_err());
}

#[test]
fn test_encrypt_produces_different_ciphertexts() {
    let key = SerializedKey {
        password: Some("password".into()),
        key: None,
        salt: None,
    };
    let c1 = Encryption::encrypt(&key, "same text").unwrap();
    let c2 = Encryption::encrypt(&key, "same text").unwrap();
    // Different nonces → different ciphertexts
    assert_ne!(c1.cipher, c2.cipher);
    assert_ne!(c1.iv, c2.iv);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-crypto`
Expected: FAIL — `Encryption`/`Decryption` not found.

**Step 3: Write encryption module**

```rust
// wiredash/crates/wiredash-crypto/src/encryption.rs
use crate::key::KeyUtils;
use crate::types::{Cipher, CryptoError, SerializedKey, ALGORITHM};
use base64::Engine;
use sodiumoxide::crypto::aead::xchacha20poly1305_ietf as aead;

/// Base64 engine matching Workstation's URLSAFE_NO_PADDING (variant 7).
fn engine() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

pub struct Encryption;

impl Encryption {
    /// Encrypt plaintext string with XChaCha20-Poly1305.
    /// Returns a Cipher envelope matching Workstation's Cipher<"base64"> format.
    pub fn encrypt(key: &SerializedKey, plaintext: &str) -> Result<Cipher, CryptoError> {
        sodiumoxide::init().map_err(|_| CryptoError::InitFailed)?;

        let (raw_key, salt) = KeyUtils::transform(key)?;
        let aead_key =
            aead::Key::from_slice(&raw_key).ok_or(CryptoError::EncryptionFailed)?;
        let nonce = aead::gen_nonce();

        let ciphertext = aead::seal(plaintext.as_bytes(), None, &nonce, &aead_key);

        let enc = engine();
        Ok(Cipher {
            format: "base64".into(),
            alg: ALGORITHM.into(),
            cipher: enc.encode(&ciphertext),
            iv: enc.encode(nonce.as_ref()),
            salt: enc.encode(&salt),
            length: plaintext.len(),
        })
    }
}

pub struct Decryption;

impl Decryption {
    /// Decrypt a Cipher envelope back to plaintext string.
    pub fn decrypt(cipher: &Cipher, key: &SerializedKey) -> Result<String, CryptoError> {
        sodiumoxide::init().map_err(|_| CryptoError::InitFailed)?;

        // If key has no salt, use the one from the cipher
        let effective_key = if key.salt.is_none() && !cipher.salt.is_empty() {
            SerializedKey {
                password: key.password.clone(),
                key: key.key.clone(),
                salt: Some(cipher.salt.clone()),
            }
        } else {
            key.clone()
        };

        let (raw_key, _) = KeyUtils::transform(&effective_key)?;
        let enc = engine();

        let ciphertext = enc.decode(&cipher.cipher)?;
        let nonce_bytes = enc.decode(&cipher.iv)?;

        let aead_key =
            aead::Key::from_slice(&raw_key).ok_or(CryptoError::DecryptionFailed)?;
        let nonce =
            aead::Nonce::from_slice(&nonce_bytes).ok_or(CryptoError::DecryptionFailed)?;

        let plaintext =
            aead::open(&ciphertext, None, &nonce, &aead_key)
                .map_err(|_| CryptoError::DecryptionFailed)?;

        String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptionFailed)
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd wiredash && cargo test -p wiredash-crypto`
Expected: 6 tests PASS (3 key + 3 encryption).

**Step 5: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "crypto: add XChaCha20-Poly1305 encrypt/decrypt with base64 envelope"
```

---

## Task 5: Database — Connection and Schema Creation

**Files:**
- Create: `wiredash/crates/wiredash-db/src/connection.rs`
- Create: `wiredash/crates/wiredash-db/src/schema.rs`
- Create: `wiredash/crates/wiredash-db/src/migrations.rs`
- Test: `wiredash/crates/wiredash-db/tests/schema_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-db/tests/schema_test.rs
use wiredash_db::Database;
use tempfile::TempDir;

#[test]
fn test_create_database_and_all_tables() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.db");
    let db = Database::open(path.to_str().unwrap(), None).unwrap();

    // Verify all 16 tables exist (14 real + 2 FTS virtual)
    let tables: Vec<String> = db.query_column(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).unwrap();

    let expected = vec![
        "attachments", "colors", "config", "content", "content_fts",
        "kv", "monographs", "notehistory", "notebooks", "notes",
        "notes_fts", "relations", "reminders", "sessioncontent",
        "settings", "shortcuts", "vaults",
    ];

    for table in &expected {
        assert!(tables.contains(&table.to_string()), "Missing table: {}", table);
    }
}

#[test]
fn test_encrypted_database() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("encrypted.db");
    let _db = Database::open(path.to_str().unwrap(), Some("my-db-password")).unwrap();

    // Opening without password should fail
    let result = Database::open(path.to_str().unwrap(), None);
    assert!(result.is_err() || {
        // Unencrypted open might succeed but queries should fail
        let db2 = result.unwrap();
        db2.query_column::<String>("SELECT name FROM sqlite_master").is_err()
    });
}

#[test]
fn test_insert_and_read_note() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.db");
    let db = Database::open(path.to_str().unwrap(), None).unwrap();

    db.execute(
        "INSERT INTO notes (id, type, dateCreated, dateModified, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES ('n1', 'note', 1000, 1000, 0, 0, 'Test Note', 0, 1, 0, 0, 0, 1000)",
        [],
    ).unwrap();

    let title: String = db.query_one("SELECT title FROM notes WHERE id = 'n1'").unwrap();
    assert_eq!(title, "Test Note");
}
```

Add `tempfile` as dev-dependency:
```toml
# Add to wiredash/crates/wiredash-db/Cargo.toml under [dev-dependencies]
[dev-dependencies]
tempfile = "3"
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-db`
Expected: FAIL — modules not found.

**Step 3: Write database connection**

```rust
// wiredash/crates/wiredash-db/src/connection.rs
use rusqlite::{params, Connection, Result as SqlResult};

pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open (or create) a database file.
    /// If `password` is Some, encrypts via SQLCipher.
    pub fn open(path: &str, password: Option<&str>) -> Result<Self, anyhow::Error> {
        let conn = Connection::open(path)?;

        if let Some(pw) = password {
            conn.pragma_update(None, "key", pw)?;
        }

        // Enable WAL mode for better concurrent read performance
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = Self { conn };
        crate::schema::create_all_tables(&db)?;
        Ok(db)
    }

    /// Open an in-memory database (for tests).
    pub fn open_memory() -> Result<Self, anyhow::Error> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        crate::schema::create_all_tables(&db)?;
        Ok(db)
    }

    pub fn execute(&self, sql: &str, params: impl rusqlite::Params) -> Result<usize, anyhow::Error> {
        Ok(self.conn.execute(sql, params)?)
    }

    pub fn query_one<T: rusqlite::types::FromSql>(&self, sql: &str) -> Result<T, anyhow::Error> {
        Ok(self.conn.query_row(sql, [], |row| row.get(0))?)
    }

    pub fn query_column<T: rusqlite::types::FromSql>(&self, sql: &str) -> Result<Vec<T>, anyhow::Error> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Raw connection access for advanced queries.
    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}
```

**Step 4: Write schema creation**

```rust
// wiredash/crates/wiredash-db/src/schema.rs
use crate::Database;

/// Create all tables matching Workstation's SQLite schema exactly.
/// Column names use camelCase to match the JS/TS ORM layer.
pub fn create_all_tables(db: &Database) -> Result<(), anyhow::Error> {
    db.conn().execute_batch(SCHEMA_SQL)?;
    Ok(())
}

const SCHEMA_SQL: &str = r#"
-- ── Notes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    dateDeleted INTEGER,
    itemType TEXT,
    deletedBy TEXT,
    title TEXT COLLATE NOCASE,
    headline TEXT,
    contentId TEXT,
    pinned BOOLEAN,
    favorite BOOLEAN,
    localOnly BOOLEAN,
    conflicted BOOLEAN,
    readonly BOOLEAN,
    dateEdited INTEGER,
    isGeneratedTitle BOOLEAN,
    archived BOOLEAN,
    expiryDate TEXT
);
CREATE INDEX IF NOT EXISTS note_type ON notes(type);
CREATE INDEX IF NOT EXISTS note_deleted ON notes(deleted);
CREATE INDEX IF NOT EXISTS note_date_deleted ON notes(dateDeleted);

-- ── Notebooks ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    dateDeleted INTEGER,
    itemType TEXT,
    deletedBy TEXT,
    title TEXT COLLATE NOCASE,
    description TEXT,
    dateEdited INTEGER,
    pinned BOOLEAN
);
CREATE INDEX IF NOT EXISTS notebook_type ON notebooks(type);

-- ── Content ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    noteId TEXT,
    data TEXT,
    locked BOOLEAN,
    localOnly BOOLEAN,
    conflicted TEXT,
    sessionId TEXT,
    dateEdited INTEGER,
    dateResolved INTEGER
);
CREATE INDEX IF NOT EXISTS content_noteId ON content(noteId);

-- ── Tags ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    title TEXT COLLATE NOCASE
);

-- ── Colors ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS colors (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    title TEXT COLLATE NOCASE,
    colorCode TEXT UNIQUE
);

-- ── Attachments ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    iv TEXT,
    salt TEXT,
    size INTEGER,
    alg TEXT,
    key TEXT,
    chunkSize INTEGER,
    hash TEXT UNIQUE,
    hashType TEXT,
    mimeType TEXT,
    filename TEXT,
    dateDeleted INTEGER,
    dateUploaded INTEGER,
    failed TEXT
);
CREATE INDEX IF NOT EXISTS attachment_hash ON attachments(hash);

-- ── Relations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    fromType TEXT,
    fromId TEXT,
    toType TEXT,
    toId TEXT
);
CREATE INDEX IF NOT EXISTS relation_from_general ON relations(fromType, toType, fromId);
CREATE INDEX IF NOT EXISTS relation_to_general ON relations(fromType, toType, toId);

-- ── Reminders ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    title TEXT COLLATE NOCASE,
    description TEXT,
    priority TEXT,
    date INTEGER,
    mode TEXT,
    recurringMode TEXT,
    selectedDays TEXT,
    localOnly BOOLEAN,
    disabled BOOLEAN,
    snoozeUntil INTEGER
);

-- ── Vaults ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    title TEXT COLLATE NOCASE,
    key TEXT
);

-- ── Shortcuts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shortcuts (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    sortIndex INTEGER,
    itemId TEXT,
    itemType TEXT
);

-- ── Monographs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monographs (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    datePublished INTEGER,
    title TEXT COLLATE NOCASE,
    selfDestruct BOOLEAN,
    password TEXT
);

-- ── Settings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    key TEXT UNIQUE,
    value TEXT
);

-- ── Note History ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS notehistory (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    noteId TEXT,
    sessionContentId TEXT,
    localOnly BOOLEAN,
    locked BOOLEAN
);
CREATE INDEX IF NOT EXISTS notehistory_noteid ON notehistory(noteId);

-- ── Session Content ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessioncontent (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT,
    dateModified INTEGER,
    dateCreated INTEGER,
    synced BOOLEAN,
    deleted BOOLEAN,
    data TEXT,
    contentType TEXT,
    locked BOOLEAN,
    compressed BOOLEAN,
    localOnly BOOLEAN,
    title TEXT
);

-- ── KV Store ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT,
    dateModified INTEGER
);

-- ── Config ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
    name TEXT PRIMARY KEY NOT NULL,
    value TEXT,
    dateModified INTEGER
);

-- ── FTS5 Virtual Tables ────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED,
    title,
    content='notes',
    tokenize='porter trigram'
);

CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
    id UNINDEXED,
    noteId UNINDEXED,
    data,
    content='content',
    tokenize='porter trigram'
);
"#;
```

**Step 5: Write migrations placeholder**

```rust
// wiredash/crates/wiredash-db/src/migrations.rs
/// Database migration version. Matches Workstation's migration 6.1 + custom additions.
pub const CURRENT_VERSION: &str = "6.1";

/// Run pending migrations. Currently a no-op since we create at latest schema.
/// Future migrations go here when the schema evolves.
pub fn run_migrations(_db: &crate::Database) -> Result<(), anyhow::Error> {
    // Phase 1: create at current schema, no migration history to run
    Ok(())
}
```

**Step 6: Update lib.rs**

```rust
// wiredash/crates/wiredash-db/src/lib.rs
pub mod connection;
pub mod schema;
pub mod migrations;

pub use connection::Database;
```

**Step 7: Run tests to verify they pass**

Run: `cd wiredash && cargo test -p wiredash-db`
Expected: 3 tests PASS.

Note: The `content_fts` test uses `tokenize='porter trigram'` — if the bundled SQLite doesn't support trigram tokenizer, change to `tokenize='porter'`. Check test output.

**Step 8: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "db: add schema creation with all 16 tables and FTS5 indices"
```

---

## Task 6: Core — Collection Trait and Notes Collection

**Files:**
- Create: `wiredash/crates/wiredash-core/src/collections/mod.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/notes.rs`
- Test: `wiredash/crates/wiredash-core/tests/notes_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-core/tests/notes_test.rs
use wiredash_core::collections::notes::Notes;
use wiredash_core::types::{BaseItem, Note, TrashMeta};
use wiredash_db::Database;

fn test_db() -> Database {
    Database::open_memory().unwrap()
}

fn make_note(title: &str) -> Note {
    Note {
        base: BaseItem::new("note"),
        trash: TrashMeta::default(),
        title: title.into(),
        headline: None,
        content_id: None,
        pinned: false,
        favorite: false,
        local_only: false,
        conflicted: false,
        readonly: false,
        date_edited: chrono::Utc::now().timestamp_millis(),
        is_generated_title: Some(false),
        archived: Some(false),
        expiry_date: None,
    }
}

#[test]
fn test_add_and_get_note() {
    let db = test_db();
    let notes = Notes::new(&db);
    let mut note = make_note("My First Note");
    let id = note.base.id.clone();

    notes.add(&note).unwrap();
    let fetched = notes.get(&id).unwrap().unwrap();
    assert_eq!(fetched.title, "My First Note");
    assert_eq!(fetched.base.item_type, "note");
}

#[test]
fn test_list_notes() {
    let db = test_db();
    let notes = Notes::new(&db);
    notes.add(&make_note("Alpha")).unwrap();
    notes.add(&make_note("Beta")).unwrap();
    notes.add(&make_note("Gamma")).unwrap();

    let all = notes.list(None).unwrap();
    assert_eq!(all.len(), 3);
}

#[test]
fn test_update_note() {
    let db = test_db();
    let notes = Notes::new(&db);
    let note = make_note("Original");
    let id = note.base.id.clone();
    notes.add(&note).unwrap();

    notes.update_title(&id, "Updated Title").unwrap();
    let fetched = notes.get(&id).unwrap().unwrap();
    assert_eq!(fetched.title, "Updated Title");
}

#[test]
fn test_soft_delete_note() {
    let db = test_db();
    let notes = Notes::new(&db);
    let note = make_note("To Delete");
    let id = note.base.id.clone();
    notes.add(&note).unwrap();

    notes.move_to_trash(&id).unwrap();

    // Should not appear in normal list
    let all = notes.list(None).unwrap();
    assert_eq!(all.len(), 0);

    // Should appear in trash
    let trashed = notes.trashed().unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].title, "To Delete");
}

#[test]
fn test_pin_favorite_archive() {
    let db = test_db();
    let notes = Notes::new(&db);
    let note = make_note("Test");
    let id = note.base.id.clone();
    notes.add(&note).unwrap();

    notes.set_pinned(&id, true).unwrap();
    notes.set_favorite(&id, true).unwrap();
    notes.set_archived(&id, true).unwrap();

    let fetched = notes.get(&id).unwrap().unwrap();
    assert_eq!(fetched.pinned, true);
    assert_eq!(fetched.favorite, true);
    assert_eq!(fetched.archived, Some(true));
}

#[test]
fn test_hard_delete() {
    let db = test_db();
    let notes = Notes::new(&db);
    let note = make_note("Gone");
    let id = note.base.id.clone();
    notes.add(&note).unwrap();

    notes.remove(&id).unwrap();
    assert!(notes.get(&id).unwrap().is_none());
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-core`
Expected: FAIL — `collections` module not found.

**Step 3: Write the Notes collection**

```rust
// wiredash/crates/wiredash-core/src/collections/mod.rs
pub mod notes;
```

```rust
// wiredash/crates/wiredash-core/src/collections/notes.rs
use crate::types::{Note, BaseItem, TrashMeta, Timestamp};
use wiredash_db::Database;

pub struct Notes<'a> {
    db: &'a Database,
}

impl<'a> Notes<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, note: &Note) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO notes (id, type, dateCreated, dateModified, synced, deleted,
             dateDeleted, itemType, deletedBy,
             title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
             dateEdited, isGeneratedTitle, archived, expiryDate)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            rusqlite::params![
                note.base.id,
                note.base.item_type,
                note.base.date_created,
                note.base.date_modified,
                note.base.synced,
                note.base.deleted,
                note.trash.date_deleted,
                note.trash.item_type,
                note.trash.deleted_by,
                note.title,
                note.headline,
                note.content_id,
                note.pinned,
                note.favorite,
                note.local_only,
                note.conflicted,
                note.readonly,
                note.date_edited,
                note.is_generated_title,
                note.archived,
                note.expiry_date.as_ref().map(|v| v.to_string()),
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Note>, anyhow::Error> {
        let mut stmt = self.db.conn().prepare(
            "SELECT id, type, dateCreated, dateModified, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                    dateEdited, isGeneratedTitle, archived, expiryDate
             FROM notes WHERE id = ?1"
        )?;

        let mut rows = stmt.query(rusqlite::params![id])?;
        match rows.next()? {
            Some(row) => Ok(Some(note_from_row(row)?)),
            None => Ok(None),
        }
    }

    /// List non-deleted, non-trashed notes.
    pub fn list(&self, limit: Option<u32>) -> Result<Vec<Note>, anyhow::Error> {
        let sql = if let Some(lim) = limit {
            format!(
                "SELECT id, type, dateCreated, dateModified, synced, deleted,
                        dateDeleted, itemType, deletedBy,
                        title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                        dateEdited, isGeneratedTitle, archived, expiryDate
                 FROM notes WHERE deleted = 0 AND (type = 'note' OR type IS NULL)
                 ORDER BY dateModified DESC LIMIT {}",
                lim
            )
        } else {
            "SELECT id, type, dateCreated, dateModified, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                    dateEdited, isGeneratedTitle, archived, expiryDate
             FROM notes WHERE deleted = 0 AND (type = 'note' OR type IS NULL)
             ORDER BY dateModified DESC".into()
        };

        let mut stmt = self.db.conn().prepare(&sql)?;
        let rows = stmt.query_map([], |row| note_from_row(row))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// List soft-deleted (trashed) notes.
    pub fn trashed(&self) -> Result<Vec<Note>, anyhow::Error> {
        let mut stmt = self.db.conn().prepare(
            "SELECT id, type, dateCreated, dateModified, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                    dateEdited, isGeneratedTitle, archived, expiryDate
             FROM notes WHERE deleted = 1 OR type = 'trash'
             ORDER BY dateDeleted DESC"
        )?;
        let rows = stmt.query_map([], |row| note_from_row(row))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET title = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            rusqlite::params![title, now, id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET pinned = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            rusqlite::params![pinned, now, id],
        )?;
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET favorite = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            rusqlite::params![favorite, now, id],
        )?;
        Ok(())
    }

    pub fn set_archived(&self, id: &str, archived: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET archived = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            rusqlite::params![archived, now, id],
        )?;
        Ok(())
    }

    pub fn move_to_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET deleted = 1, type = 'trash', dateDeleted = ?1, itemType = 'note', deletedBy = 'user', dateModified = ?1, synced = 0 WHERE id = ?2",
            rusqlite::params![now, id],
        )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }
}

fn note_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    let expiry_str: Option<String> = row.get(20)?;
    Ok(Note {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(2)?,
            date_modified: row.get(3)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        trash: TrashMeta {
            date_deleted: row.get(6)?,
            item_type: row.get(7)?,
            deleted_by: row.get(8)?,
        },
        title: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        headline: row.get(10)?,
        content_id: row.get(11)?,
        pinned: row.get(12)?,
        favorite: row.get(13)?,
        local_only: row.get(14)?,
        conflicted: row.get(15)?,
        readonly: row.get(16)?,
        date_edited: row.get(17)?,
        is_generated_title: row.get(18)?,
        archived: row.get(19)?,
        expiry_date: expiry_str.and_then(|s| serde_json::from_str(&s).ok()),
    })
}
```

**Step 4: Update core lib.rs**

```rust
// wiredash/crates/wiredash-core/src/lib.rs
pub mod types;
pub mod collections;

pub use types::*;
```

**Step 5: Run tests to verify they pass**

Run: `cd wiredash && cargo test -p wiredash-core`
Expected: 6 notes tests + 3 types tests = 9 PASS.

**Step 6: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "core: add Notes collection with CRUD, trash, pin/favorite/archive"
```

---

## Task 7: Core — Notebooks Collection (with Hierarchy)

**Files:**
- Create: `wiredash/crates/wiredash-core/src/collections/notebooks.rs`
- Modify: `wiredash/crates/wiredash-core/src/collections/mod.rs` — add `pub mod notebooks;`
- Test: `wiredash/crates/wiredash-core/tests/notebooks_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-core/tests/notebooks_test.rs
use wiredash_core::collections::notebooks::Notebooks;
use wiredash_core::collections::relations::Relations;
use wiredash_core::types::{BaseItem, Notebook, TrashMeta};
use wiredash_db::Database;

fn test_db() -> Database { Database::open_memory().unwrap() }

fn make_nb(title: &str) -> Notebook {
    Notebook {
        base: BaseItem::new("notebook"),
        trash: TrashMeta::default(),
        title: title.into(),
        description: None,
        date_edited: chrono::Utc::now().timestamp_millis(),
        pinned: false,
    }
}

#[test]
fn test_add_and_get_notebook() {
    let db = test_db();
    let nbs = Notebooks::new(&db);
    let nb = make_nb("Work");
    let id = nb.base.id.clone();
    nbs.add(&nb).unwrap();

    let fetched = nbs.get(&id).unwrap().unwrap();
    assert_eq!(fetched.title, "Work");
}

#[test]
fn test_list_notebooks() {
    let db = test_db();
    let nbs = Notebooks::new(&db);
    nbs.add(&make_nb("A")).unwrap();
    nbs.add(&make_nb("B")).unwrap();

    let all = nbs.list().unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn test_notebook_hierarchy_via_relations() {
    let db = test_db();
    let nbs = Notebooks::new(&db);
    let rels = Relations::new(&db);

    let parent = make_nb("Parent");
    let child = make_nb("Child");
    let parent_id = parent.base.id.clone();
    let child_id = child.base.id.clone();

    nbs.add(&parent).unwrap();
    nbs.add(&child).unwrap();

    // Link parent → child
    rels.add("notebook", &parent_id, "notebook", &child_id).unwrap();

    // Query children of parent
    let children = rels.from_ids("notebook", &parent_id, "notebook").unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0], child_id);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-core`
Expected: FAIL — `notebooks` module not found.

**Step 3: Write Notebooks collection**

Follow the same pattern as Notes — `add`, `get`, `list`, `move_to_trash`, `remove`, `set_pinned`, plus a `notebook_from_row` helper. The struct is simpler (no headline, contentId, etc.).

The key difference from Notes: hierarchy is handled via the `relations` table, not columns on notebooks. This is why Task 8 (Relations) is critical.

```rust
// wiredash/crates/wiredash-core/src/collections/notebooks.rs
use crate::types::{BaseItem, Notebook, TrashMeta};
use wiredash_db::Database;

pub struct Notebooks<'a> {
    db: &'a Database,
}

impl<'a> Notebooks<'a> {
    pub fn new(db: &'a Database) -> Self { Self { db } }

    pub fn add(&self, nb: &Notebook) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO notebooks (id, type, dateCreated, dateModified, synced, deleted,
             dateDeleted, itemType, deletedBy, title, description, dateEdited, pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                nb.base.id, nb.base.item_type, nb.base.date_created, nb.base.date_modified,
                nb.base.synced, nb.base.deleted,
                nb.trash.date_deleted, nb.trash.item_type, nb.trash.deleted_by,
                nb.title, nb.description, nb.date_edited, nb.pinned,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Notebook>, anyhow::Error> {
        let mut stmt = self.db.conn().prepare(
            "SELECT id, type, dateCreated, dateModified, synced, deleted,
                    dateDeleted, itemType, deletedBy, title, description, dateEdited, pinned
             FROM notebooks WHERE id = ?1"
        )?;
        let mut rows = stmt.query(rusqlite::params![id])?;
        match rows.next()? {
            Some(row) => Ok(Some(nb_from_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Notebook>, anyhow::Error> {
        let mut stmt = self.db.conn().prepare(
            "SELECT id, type, dateCreated, dateModified, synced, deleted,
                    dateDeleted, itemType, deletedBy, title, description, dateEdited, pinned
             FROM notebooks WHERE deleted = 0 AND (type = 'notebook' OR type IS NULL)
             ORDER BY dateModified DESC"
        )?;
        let rows = stmt.query_map([], |row| nb_from_row(row))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn move_to_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notebooks SET deleted = 1, type = 'trash', dateDeleted = ?1, itemType = 'notebook', deletedBy = 'user', dateModified = ?1, synced = 0 WHERE id = ?2",
            rusqlite::params![now, id],
        )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM notebooks WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notebooks SET pinned = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            rusqlite::params![pinned, now, id],
        )?;
        Ok(())
    }
}

fn nb_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Notebook> {
    Ok(Notebook {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(2)?,
            date_modified: row.get(3)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        trash: TrashMeta {
            date_deleted: row.get(6)?,
            item_type: row.get(7)?,
            deleted_by: row.get(8)?,
        },
        title: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        description: row.get(10)?,
        date_edited: row.get(11)?,
        pinned: row.get(12)?,
    })
}
```

**Step 4: Update mod.rs**

Add `pub mod notebooks;` to `wiredash/crates/wiredash-core/src/collections/mod.rs`.

**Step 5: Run tests to verify they pass**

Run: `cd wiredash && cargo test -p wiredash-core -- notebooks`
Expected: The first two tests PASS. The hierarchy test will FAIL because Relations doesn't exist yet — that's expected and will be fixed in Task 8.

**Step 6: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "core: add Notebooks collection with CRUD and trash"
```

---

## Task 8: Core — Relations Collection (Graph Edges)

**Files:**
- Create: `wiredash/crates/wiredash-core/src/collections/relations.rs`
- Modify: `wiredash/crates/wiredash-core/src/collections/mod.rs` — add `pub mod relations;`
- Test: `wiredash/crates/wiredash-core/tests/relations_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-core/tests/relations_test.rs
use wiredash_core::collections::relations::Relations;
use wiredash_db::Database;

fn test_db() -> Database { Database::open_memory().unwrap() }

#[test]
fn test_add_and_query_relation() {
    let db = test_db();
    let rels = Relations::new(&db);

    rels.add("notebook", "nb1", "note", "n1").unwrap();
    rels.add("notebook", "nb1", "note", "n2").unwrap();

    let note_ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert_eq!(note_ids.len(), 2);
    assert!(note_ids.contains(&"n1".to_string()));
    assert!(note_ids.contains(&"n2".to_string()));
}

#[test]
fn test_reverse_query() {
    let db = test_db();
    let rels = Relations::new(&db);

    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.add("note", "n2", "tag", "t1").unwrap();

    // Which notes have tag t1?
    let note_ids = rels.to_ids("note", "tag", "t1").unwrap();
    assert_eq!(note_ids.len(), 2);
}

#[test]
fn test_unlink() {
    let db = test_db();
    let rels = Relations::new(&db);

    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.unlink("note", "n1", "tag", "t1").unwrap();

    let ids = rels.from_ids("note", "n1", "tag").unwrap();
    assert_eq!(ids.len(), 0);
}

#[test]
fn test_unlink_all_from() {
    let db = test_db();
    let rels = Relations::new(&db);

    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.add("note", "n1", "tag", "t2").unwrap();
    rels.add("note", "n1", "color", "c1").unwrap();

    rels.unlink_all_from("note", "n1").unwrap();

    let tags = rels.from_ids("note", "n1", "tag").unwrap();
    let colors = rels.from_ids("note", "n1", "color").unwrap();
    assert_eq!(tags.len(), 0);
    assert_eq!(colors.len(), 0);
}

#[test]
fn test_deterministic_id() {
    let db = test_db();
    let rels = Relations::new(&db);

    // Adding the same relation twice should not create a duplicate
    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.add("note", "n1", "tag", "t1").unwrap();

    let ids = rels.from_ids("note", "n1", "tag").unwrap();
    assert_eq!(ids.len(), 1);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-core -- relations`
Expected: FAIL.

**Step 3: Write Relations collection**

```rust
// wiredash/crates/wiredash-core/src/collections/relations.rs
use wiredash_db::Database;

pub struct Relations<'a> {
    db: &'a Database,
}

impl<'a> Relations<'a> {
    pub fn new(db: &'a Database) -> Self { Self { db } }

    /// Generate a deterministic relation ID from (fromId, fromType, toId, toType).
    /// Matches Workstation's `generateId()`.
    fn generate_id(from_type: &str, from_id: &str, to_type: &str, to_id: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        format!("{}:{}:{}:{}", from_type, from_id, to_type, to_id).hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    /// Add a relation edge. Uses INSERT OR REPLACE with deterministic ID.
    pub fn add(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        let id = Self::generate_id(from_type, from_id, to_type, to_id);
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "INSERT OR REPLACE INTO relations (id, type, dateCreated, dateModified, synced, deleted, fromType, fromId, toType, toId)
             VALUES (?1, 'relation', ?2, ?2, 0, 0, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, now, from_type, from_id, to_type, to_id],
        )?;
        Ok(())
    }

    /// Get all target IDs from a source item to a target type.
    /// E.g., from_ids("notebook", "nb1", "note") → ["n1", "n2"]
    pub fn from_ids(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        let mut stmt = self.db.conn().prepare(
            "SELECT toId FROM relations WHERE fromType = ?1 AND fromId = ?2 AND toType = ?3 AND deleted = 0"
        )?;
        let rows = stmt.query_map(rusqlite::params![from_type, from_id, to_type], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Get all source IDs that point to a target item.
    /// E.g., to_ids("note", "tag", "t1") → ["n1", "n2"]
    pub fn to_ids(
        &self,
        from_type: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        let mut stmt = self.db.conn().prepare(
            "SELECT fromId FROM relations WHERE fromType = ?1 AND toType = ?2 AND toId = ?3 AND deleted = 0"
        )?;
        let rows = stmt.query_map(rusqlite::params![from_type, to_type, to_id], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Remove a specific relation edge.
    pub fn unlink(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        let id = Self::generate_id(from_type, from_id, to_type, to_id);
        self.db.execute("DELETE FROM relations WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    /// Remove ALL relations originating from a given item.
    pub fn unlink_all_from(&self, from_type: &str, from_id: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "DELETE FROM relations WHERE fromType = ?1 AND fromId = ?2",
            rusqlite::params![from_type, from_id],
        )?;
        Ok(())
    }

    /// Remove ALL relations pointing to a given item.
    pub fn unlink_all_to(&self, to_type: &str, to_id: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "DELETE FROM relations WHERE toType = ?1 AND toId = ?2",
            rusqlite::params![to_type, to_id],
        )?;
        Ok(())
    }
}
```

**Step 4: Update mod.rs**

Add `pub mod relations;` to `wiredash/crates/wiredash-core/src/collections/mod.rs`.

**Step 5: Run tests to verify they pass**

Run: `cd wiredash && cargo test -p wiredash-core`
Expected: All tests PASS including the notebooks hierarchy test from Task 7.

**Step 6: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "core: add Relations collection with bidirectional graph edges"
```

---

## Task 9: Core — Remaining Collections (Tags, Colors, Content, Attachments, Reminders, Vaults, Shortcuts, Monographs, Settings, NoteHistory, SessionContent)

Each collection follows the exact same pattern established in Tasks 6-8. For each:
1. Create `collections/<name>.rs` with struct wrapping `&Database`
2. Implement `add()`, `get()`, `list()`, `remove()` + entity-specific methods
3. Write `<name>_from_row()` helper
4. Add `pub mod <name>;` to `mod.rs`

**Files:**
- Create: `wiredash/crates/wiredash-core/src/collections/tags.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/colors.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/content.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/attachments.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/reminders.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/vaults.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/shortcuts.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/monographs.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/settings.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/note_history.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/session_content.rs`
- Create: `wiredash/crates/wiredash-core/src/collections/trash.rs`
- Modify: `wiredash/crates/wiredash-core/src/collections/mod.rs`
- Test: `wiredash/crates/wiredash-core/tests/collections_test.rs`

**Key differences per collection:**

| Collection | Entity-Specific Methods | Notes |
|------------|------------------------|-------|
| `tags` | `find_by_title(title)` | Case-sensitive BINARY search |
| `colors` | `find_by_code(code)`, `count_notes(id)` | 7 default colors, unique colorCode |
| `content` | `find_by_note_id(note_id)`, `update_data(id, data)` | Stores encrypted/plaintext HTML |
| `attachments` | `find_by_hash(hash)`, `of_note(note_id)` | unique hash, encryption key per file |
| `reminders` | `due()`, `overdue()` | Filter by date vs now |
| `vaults` | `default()` | Single-vault architecture |
| `shortcuts` | `items()` (resolve to actual items) | sortIndex ordering |
| `monographs` | `find_by_note_id(note_id)` via relations | Public shares |
| `settings` | `get_setting(key)`, `set_setting(key, value)` | KV pattern, in-memory cache possible |
| `note_history` | `for_note(note_id)` | Filtered by noteId index |
| `session_content` | (same as content pattern) | Compressed/locked flags |
| `trash` | `clean(interval_days)` | Delete items older than interval |

**Step 1: Write comprehensive test**

```rust
// wiredash/crates/wiredash-core/tests/collections_test.rs
use wiredash_core::collections::*;
use wiredash_core::types::*;
use wiredash_db::Database;

fn test_db() -> Database { Database::open_memory().unwrap() }

#[test]
fn test_tags_crud() {
    let db = test_db();
    let tags = tags::Tags::new(&db);
    let tag = Tag { base: BaseItem::new("tag"), title: "rust".into() };
    let id = tag.base.id.clone();
    tags.add(&tag).unwrap();

    let found = tags.find_by_title("rust").unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap().base.id, id);

    tags.remove(&id).unwrap();
    assert!(tags.get(&id).unwrap().is_none());
}

#[test]
fn test_colors_crud() {
    let db = test_db();
    let colors = colors::Colors::new(&db);
    let color = Color {
        base: BaseItem::new("color"),
        title: "Red".into(),
        color_code: "#ff0000".into(),
    };
    colors.add(&color).unwrap();

    let found = colors.find_by_code("#ff0000").unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap().title, "Red");
}

#[test]
fn test_content_by_note_id() {
    let db = test_db();
    let content = content::Content::new(&db);
    let item = ContentItem {
        base: BaseItem::new("content"),
        note_id: Some("n1".into()),
        data: Some("<p>Hello world</p>".into()),
        locked: false,
        local_only: false,
        conflicted: None,
        session_id: None,
        date_edited: chrono::Utc::now().timestamp_millis(),
        date_resolved: None,
    };
    content.add(&item).unwrap();

    let found = content.find_by_note_id("n1").unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap().data.unwrap(), "<p>Hello world</p>");
}

#[test]
fn test_settings_kv() {
    let db = test_db();
    let settings = settings::Settings::new(&db);

    settings.set("titleFormat", &serde_json::json!("Note $date$")).unwrap();
    let val = settings.get_setting("titleFormat").unwrap();
    assert!(val.is_some());
    assert_eq!(val.unwrap(), serde_json::json!("Note $date$"));
}

#[test]
fn test_trash_cleanup() {
    let db = test_db();
    let notes_col = notes::Notes::new(&db);
    let trash = trash::Trash::new(&db);

    // Add a note and trash it with an old dateDeleted
    let note = Note {
        base: BaseItem::new("note"),
        trash: TrashMeta::default(),
        title: "Old".into(),
        headline: None, content_id: None, pinned: false, favorite: false,
        local_only: false, conflicted: false, readonly: false,
        date_edited: 0, is_generated_title: None, archived: None, expiry_date: None,
    };
    let id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    // Manually set as trashed 30 days ago
    let thirty_days_ago = chrono::Utc::now().timestamp_millis() - (30 * 24 * 60 * 60 * 1000);
    db.execute(
        "UPDATE notes SET deleted = 1, type = 'trash', dateDeleted = ?1, itemType = 'note', deletedBy = 'user' WHERE id = ?2",
        rusqlite::params![thirty_days_ago, id],
    ).unwrap();

    // Clean trash older than 7 days
    let removed = trash.clean_notes(7).unwrap();
    assert_eq!(removed, 1);
    assert!(notes_col.get(&id).unwrap().is_none());
}
```

**Step 2: Implement all remaining collections**

Each follows the pattern from Tasks 6-8. The test above covers the critical paths. Implement each module with `add`, `get`, `list`, `remove`, plus entity-specific methods listed in the table above.

**Step 3: Run tests**

Run: `cd wiredash && cargo test -p wiredash-core`
Expected: All tests PASS.

**Step 4: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "core: add all remaining collections (tags, colors, content, attachments, reminders, vaults, shortcuts, monographs, settings, history, trash)"
```

---

## Task 10: Core — Full-Text Search

**Files:**
- Create: `wiredash/crates/wiredash-core/src/collections/search.rs`
- Modify: `wiredash/crates/wiredash-core/src/collections/mod.rs` — add `pub mod search;`
- Modify: `wiredash/crates/wiredash-core/src/collections/notes.rs` — add FTS trigger on add/update
- Test: `wiredash/crates/wiredash-core/tests/search_test.rs`

**Step 1: Write the failing test**

```rust
// wiredash/crates/wiredash-core/tests/search_test.rs
use wiredash_core::collections::{notes::Notes, content::Content, search::Search};
use wiredash_core::types::*;
use wiredash_db::Database;

fn test_db() -> Database { Database::open_memory().unwrap() }

#[test]
fn test_search_notes_by_title() {
    let db = test_db();
    let notes = Notes::new(&db);
    let search = Search::new(&db);

    let note = Note {
        base: BaseItem::new("note"),
        trash: TrashMeta::default(),
        title: "Rust Programming Guide".into(),
        headline: None, content_id: None, pinned: false, favorite: false,
        local_only: false, conflicted: false, readonly: false,
        date_edited: 0, is_generated_title: None, archived: None, expiry_date: None,
    };
    let id = note.base.id.clone();
    notes.add(&note).unwrap();
    search.index_note(&id, "Rust Programming Guide").unwrap();

    let results = search.search_notes("rust").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], id);
}

#[test]
fn test_search_content() {
    let db = test_db();
    let content_col = Content::new(&db);
    let search = Search::new(&db);

    let item = ContentItem {
        base: BaseItem::new("content"),
        note_id: Some("n1".into()),
        data: Some("The quick brown fox jumps over the lazy dog".into()),
        locked: false, local_only: false, conflicted: None,
        session_id: None, date_edited: 0, date_resolved: None,
    };
    let content_id = item.base.id.clone();
    content_col.add(&item).unwrap();
    search.index_content(&content_id, "n1", "The quick brown fox jumps over the lazy dog").unwrap();

    let results = search.search_content("brown fox").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], "n1");
}

#[test]
fn test_search_no_results() {
    let db = test_db();
    let search = Search::new(&db);
    let results = search.search_notes("nonexistent").unwrap();
    assert_eq!(results.len(), 0);
}
```

**Step 2: Run test to verify it fails**

Run: `cd wiredash && cargo test -p wiredash-core -- search`
Expected: FAIL.

**Step 3: Write Search module**

```rust
// wiredash/crates/wiredash-core/src/collections/search.rs
use wiredash_db::Database;

pub struct Search<'a> {
    db: &'a Database,
}

impl<'a> Search<'a> {
    pub fn new(db: &'a Database) -> Self { Self { db } }

    /// Index a note's title for FTS search.
    pub fn index_note(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO notes_fts (id, title) VALUES (?1, ?2)",
            rusqlite::params![id, title],
        )?;
        Ok(())
    }

    /// Index content for FTS search.
    pub fn index_content(&self, id: &str, note_id: &str, data: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO content_fts (id, noteId, data) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, note_id, data],
        )?;
        Ok(())
    }

    /// Search notes by title. Returns matching note IDs.
    pub fn search_notes(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let mut stmt = self.db.conn().prepare(
            "SELECT id FROM notes_fts WHERE notes_fts MATCH ?1 ORDER BY rank"
        )?;
        let rows = stmt.query_map(rusqlite::params![fts_query], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Search content body. Returns matching note IDs.
    pub fn search_content(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let mut stmt = self.db.conn().prepare(
            "SELECT noteId FROM content_fts WHERE content_fts MATCH ?1 ORDER BY rank"
        )?;
        let rows = stmt.query_map(rusqlite::params![fts_query], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Remove a note from the FTS index.
    pub fn remove_note(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT INTO notes_fts (notes_fts, id, title) VALUES ('delete', ?1, '')",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    /// Remove content from the FTS index.
    pub fn remove_content(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT INTO content_fts (content_fts, id, noteId, data) VALUES ('delete', ?1, '', '')",
            rusqlite::params![id],
        )?;
        Ok(())
    }
}
```

**Step 4: Run tests**

Run: `cd wiredash && cargo test -p wiredash-core -- search`
Expected: 3 tests PASS.

Note: If `trigram` tokenizer isn't available in bundled SQLite, the schema creation from Task 5 may need adjustment. Change `tokenize='porter trigram'` to `tokenize='porter'` in `schema.rs` if tests fail on table creation.

**Step 5: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "core: add FTS5 full-text search for notes and content"
```

---

## Task 11: Integration Test — End-to-End Note Lifecycle

**Files:**
- Create: `wiredash/tests/integration_test.rs`

This test validates the full lifecycle: create note → add content → tag it → put in notebook → search → trash → clean.

**Step 1: Write the integration test**

```rust
// wiredash/tests/integration_test.rs
use wiredash_core::collections::*;
use wiredash_core::types::*;
use wiredash_crypto::encryption::{Encryption, Decryption};
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

#[test]
fn test_full_note_lifecycle() {
    // 1. Open database
    let db = Database::open_memory().unwrap();

    // 2. Create a note
    let note_col = notes::Notes::new(&db);
    let note = Note {
        base: BaseItem::new("note"),
        trash: TrashMeta::default(),
        title: "Meeting Notes".into(),
        headline: Some("Q1 planning session".into()),
        content_id: None,
        pinned: false, favorite: false, local_only: false,
        conflicted: false, readonly: false,
        date_edited: chrono::Utc::now().timestamp_millis(),
        is_generated_title: Some(false),
        archived: Some(false),
        expiry_date: None,
    };
    let note_id = note.base.id.clone();
    note_col.add(&note).unwrap();

    // 3. Add content
    let content_col = content::Content::new(&db);
    let content_item = ContentItem {
        base: BaseItem::new("content"),
        note_id: Some(note_id.clone()),
        data: Some("<p>Discussed roadmap for Q1</p>".into()),
        locked: false, local_only: false, conflicted: None,
        session_id: None,
        date_edited: chrono::Utc::now().timestamp_millis(),
        date_resolved: None,
    };
    content_col.add(&content_item).unwrap();

    // 4. Tag the note
    let tags_col = tags::Tags::new(&db);
    let tag = Tag { base: BaseItem::new("tag"), title: "work".into() };
    let tag_id = tag.base.id.clone();
    tags_col.add(&tag).unwrap();

    let rels = relations::Relations::new(&db);
    rels.add("note", &note_id, "tag", &tag_id).unwrap();

    // 5. Put in notebook
    let nbs = notebooks::Notebooks::new(&db);
    let nb = Notebook {
        base: BaseItem::new("notebook"),
        trash: TrashMeta::default(),
        title: "Work".into(),
        description: None,
        date_edited: chrono::Utc::now().timestamp_millis(),
        pinned: false,
    };
    let nb_id = nb.base.id.clone();
    nbs.add(&nb).unwrap();
    rels.add("notebook", &nb_id, "note", &note_id).unwrap();

    // 6. Verify relations
    let note_tags = rels.from_ids("note", &note_id, "tag").unwrap();
    assert_eq!(note_tags, vec![tag_id.clone()]);

    let nb_notes = rels.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(nb_notes, vec![note_id.clone()]);

    // 7. Search
    let search_col = search::Search::new(&db);
    search_col.index_note(&note_id, "Meeting Notes").unwrap();
    let results = search_col.search_notes("meeting").unwrap();
    assert_eq!(results.len(), 1);

    // 8. Encrypt/decrypt content
    let key = SerializedKey {
        password: Some("vault-password".into()),
        key: None, salt: None,
    };
    let cipher = Encryption::encrypt(&key, "<p>Discussed roadmap for Q1</p>").unwrap();
    let decrypt_key = SerializedKey {
        password: Some("vault-password".into()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let decrypted = Decryption::decrypt(&cipher, &decrypt_key).unwrap();
    assert_eq!(decrypted, "<p>Discussed roadmap for Q1</p>");

    // 9. Trash the note
    note_col.move_to_trash(&note_id).unwrap();
    let active = note_col.list(None).unwrap();
    assert_eq!(active.len(), 0);
    let trashed = note_col.trashed().unwrap();
    assert_eq!(trashed.len(), 1);

    // 10. Hard delete
    note_col.remove(&note_id).unwrap();
    assert!(note_col.get(&note_id).unwrap().is_none());
}
```

**Step 2: Run the full test suite**

Run: `cd wiredash && cargo test`
Expected: ALL tests across all 3 crates PASS.

**Step 3: Commit**

```bash
cd wiredash && git add -A && git commit -s -m "core: add end-to-end integration test for note lifecycle"
```

---

## Summary

| Task | Crate | What | Tests |
|------|-------|------|-------|
| 1 | workspace | Scaffold 3 crates | `cargo check` |
| 2 | wiredash-core | 15 entity structs + serde | 3 |
| 3 | wiredash-crypto | Argon2i key derivation | 3 |
| 4 | wiredash-crypto | XChaCha20-Poly1305 encrypt/decrypt | 3 |
| 5 | wiredash-db | Schema creation (16 tables + 2 FTS) | 3 |
| 6 | wiredash-core | Notes collection CRUD | 6 |
| 7 | wiredash-core | Notebooks collection | 3 |
| 8 | wiredash-core | Relations (graph edges) | 5 |
| 9 | wiredash-core | 11 remaining collections | 5 |
| 10 | wiredash-core | FTS5 search | 3 |
| 11 | integration | Full lifecycle test | 1 |

**Total: 11 tasks, ~35 tests, 3 crates.**

After completing Phase 1, the next plan will cover **Phase 2: Sync + Auth** (sync engine, auth flow, JWT management, CLI tool).
