use crate::types::CryptoError;
use sodiumoxide::crypto::pwhash::argon2i13 as pwhash;

const OPS_LIMIT: pwhash::OpsLimit = pwhash::OpsLimit(3);
const MEM_LIMIT: pwhash::MemLimit = pwhash::MemLimit(1024 * 1024 * 8);

pub struct KeyUtils;

impl KeyUtils {
    /// Derive a 32-byte key from a password using Argon2i 1.3.
    ///
    /// If `salt` is provided it must be exactly `pwhash::SALTBYTES` (16) bytes.
    /// If `None`, a random salt is generated.
    ///
    /// Returns `(key, salt)` both as `Vec<u8>`.
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

    /// Transform a `SerializedKey` into raw `(key, salt)` bytes.
    ///
    /// - If `password` is present, derives the key via Argon2i (optionally using the provided salt).
    /// - If only `key` is present, decodes it from base64-URL-NO-PAD directly.
    /// - Returns an error if neither `password` nor `key` is set.
    pub fn transform(
        serialized: &crate::types::SerializedKey,
    ) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
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
