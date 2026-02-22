use wiredash_crypto::encryption::{Decryption, Encryption};
use wiredash_crypto::types::{SerializedKey, ALGORITHM};

fn make_password_key(password: &str) -> SerializedKey {
    SerializedKey {
        password: Some(password.into()),
        key: None,
        salt: None,
    }
}

#[test]
fn test_encrypt_decrypt_roundtrip() {
    let plaintext = "Hello, WIREDASH!";
    let key = make_password_key("roundtrip-password");

    let cipher = Encryption::encrypt(&key, plaintext).expect("encryption must succeed");

    // Verify envelope fields
    assert_eq!(cipher.format, "base64");
    assert_eq!(cipher.alg, ALGORITHM);
    assert_eq!(cipher.length, plaintext.len());
    assert!(!cipher.cipher.is_empty(), "ciphertext must not be empty");
    assert!(!cipher.iv.is_empty(), "iv must not be empty");
    assert!(!cipher.salt.is_empty(), "salt must not be empty");

    // Decrypt — key has no salt, so decrypt should pick it up from the cipher envelope
    let decrypted = Decryption::decrypt(&cipher, &key).expect("decryption must succeed");
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_wrong_password_fails() {
    let plaintext = "secret data";
    let key = make_password_key("correct-password");
    let cipher = Encryption::encrypt(&key, plaintext).expect("encryption must succeed");

    let wrong_key = make_password_key("wrong-password");
    let result = Decryption::decrypt(&cipher, &wrong_key);
    assert!(result.is_err(), "decryption with wrong password must fail");
}

#[test]
fn test_encrypt_produces_different_ciphertexts() {
    let plaintext = "same input each time";
    let key = make_password_key("nonce-test-password");

    let cipher1 = Encryption::encrypt(&key, plaintext).expect("encrypt #1");
    let cipher2 = Encryption::encrypt(&key, plaintext).expect("encrypt #2");

    // Different random nonces must produce different ciphertext and iv
    assert_ne!(
        cipher1.cipher, cipher2.cipher,
        "ciphertexts must differ (different nonces)"
    );
    assert_ne!(cipher1.iv, cipher2.iv, "IVs must differ (different nonces)");
}
