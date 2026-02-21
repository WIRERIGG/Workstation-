use wiredash_crypto::password::Password;

#[test]
fn test_password_hash_deterministic() {
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
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let decoded = engine.decode(&hash).expect("should be valid base64");
    assert_eq!(decoded.len(), 32, "hash should be 32 bytes");
}
