use serde::{Deserialize, Serialize};

/// Algorithm identifier matching Workstation: XChaCha20 + Argon2i 1.3 + base64 URLSAFE_NO_PADDING (variant 7)
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
