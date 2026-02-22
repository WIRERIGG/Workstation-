use wiredash_crypto::encryption::{Decryption, Encryption};
use wiredash_crypto::types::SerializedKey;

#[test]
fn test_encrypt_decrypt_roundtrip() {
    let password = "test_vault_password";
    let plaintext = "This is a secret note about my plans.";
    let key = SerializedKey {
        password: Some(password.to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, plaintext).unwrap();
    assert_eq!(cipher.format, "base64");
    assert!(!cipher.cipher.is_empty());

    let decrypted = Decryption::decrypt(&cipher, &key).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_wrong_password_fails() {
    let key = SerializedKey {
        password: Some("correct_password".to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, "secret").unwrap();

    let wrong_key = SerializedKey {
        password: Some("wrong_password".to_string()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let result = Decryption::decrypt(&cipher, &wrong_key);
    assert!(result.is_err());
}

#[test]
fn test_cipher_serialization() {
    let key = SerializedKey {
        password: Some("password123".to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, "test data").unwrap();
    let json = serde_json::to_string(&cipher).unwrap();
    let deserialized: wiredash_crypto::types::Cipher = serde_json::from_str(&json).unwrap();
    assert_eq!(cipher, deserialized);

    let decrypted = Decryption::decrypt(&deserialized, &key).unwrap();
    assert_eq!(decrypted, "test data");
}
