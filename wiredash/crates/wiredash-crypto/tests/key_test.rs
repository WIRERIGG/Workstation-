use wiredash_crypto::key::KeyUtils;

#[test]
fn test_derive_key_produces_32_bytes() {
    let (key, salt) = KeyUtils::derive_key("test-password", None).unwrap();
    assert_eq!(key.len(), 32, "derived key must be 32 bytes");
    assert_eq!(salt.len(), 16, "salt must be 16 bytes (SALTBYTES)");
}

#[test]
fn test_derive_key_deterministic_with_same_salt() {
    let (key1, salt) = KeyUtils::derive_key("deterministic-test", None).unwrap();
    let (key2, _) = KeyUtils::derive_key("deterministic-test", Some(&salt)).unwrap();
    assert_eq!(key1, key2, "same password + same salt must produce same key");
}

#[test]
fn test_derive_key_different_passwords_different_keys() {
    // Use a fixed salt so the only variable is the password
    let (_, salt) = KeyUtils::derive_key("password-a", None).unwrap();
    let (key_a, _) = KeyUtils::derive_key("password-a", Some(&salt)).unwrap();
    let (key_b, _) = KeyUtils::derive_key("password-b", Some(&salt)).unwrap();
    assert_ne!(key_a, key_b, "different passwords must produce different keys");
}
