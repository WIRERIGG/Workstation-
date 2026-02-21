use crate::key::KeyUtils;
use crate::types::{Cipher, CryptoError, SerializedKey, ALGORITHM};
use base64::Engine;
use sodiumoxide::crypto::aead::xchacha20poly1305_ietf as aead;

fn engine() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

pub struct Encryption;

impl Encryption {
    /// Encrypt `plaintext` using XChaCha20-Poly1305 AEAD.
    ///
    /// The key is derived (or decoded) from `SerializedKey`.
    /// Returns a `Cipher` envelope with base64-URL-NO-PAD encoded fields.
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
    /// Decrypt a `Cipher` envelope back to plaintext.
    ///
    /// If the `SerializedKey` has no salt, the salt from the cipher envelope is used
    /// (so a password-only key can decrypt data it didn't originally encrypt, as long
    /// as the salt is embedded in the Cipher).
    pub fn decrypt(cipher: &Cipher, key: &SerializedKey) -> Result<String, CryptoError> {
        sodiumoxide::init().map_err(|_| CryptoError::InitFailed)?;

        // If the key has no salt but the cipher does, use the cipher's salt
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

        let plaintext = aead::open(&ciphertext, None, &nonce, &aead_key)
            .map_err(|_| CryptoError::DecryptionFailed)?;

        String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptionFailed)
    }
}
