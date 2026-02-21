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

        // Salt = BLAKE2b hash of email, output size = pwhash::SALTBYTES (16)
        let email_digest = generichash::hash(
            email.as_bytes(),
            Some(pwhash::SALTBYTES),
            None,
        )
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

        let mut salt_buf = [0u8; pwhash::SALTBYTES];
        salt_buf.copy_from_slice(&email_digest[..pwhash::SALTBYTES]);
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
