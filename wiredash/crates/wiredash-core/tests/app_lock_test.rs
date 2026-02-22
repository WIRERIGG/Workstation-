#[test]
fn test_app_lock_hash_verify() {
    use wiredash_crypto::key::KeyUtils;
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;

    let password = "my_secure_password";
    let (key, salt) = KeyUtils::derive_key(password, None).unwrap();
    let hash = engine.encode(&key);
    let _salt_b64 = engine.encode(&salt);

    // Re-derive with same salt should produce same key
    let (key2, _) = KeyUtils::derive_key(password, Some(&salt)).unwrap();
    let hash2 = engine.encode(&key2);
    assert_eq!(hash, hash2);

    // Wrong password should produce different hash
    let (key3, _) = KeyUtils::derive_key("wrong_password", Some(&salt)).unwrap();
    let hash3 = engine.encode(&key3);
    assert_ne!(hash, hash3);
}
