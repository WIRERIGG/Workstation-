use wiredash_sync::types::*;

#[test]
fn test_token_is_expired() {
    let mut token = Token {
        access_token: "abc".into(),
        refresh_token: "def".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };

    assert!(!token.is_expired());

    token.t = chrono::Utc::now().timestamp_millis() - 7_200_000;
    assert!(token.is_expired());
}

#[test]
fn test_token_is_refreshable() {
    let token = Token {
        access_token: "abc".into(),
        refresh_token: "def".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    assert!(token.is_refreshable());

    let no_offline = Token {
        scope: "workstation.sync".into(),
        refresh_token: String::new(),
        ..token
    };
    assert!(!no_offline.is_refreshable());
}

#[test]
fn test_sync_transfer_item_serialization() {
    let item = SyncTransferItem {
        items: vec![],
        r#type: "note".into(),
        count: 0,
    };
    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("\"type\":\"note\""));
    assert!(json.contains("\"count\":0"));
}

#[test]
fn test_user_deserialize() {
    let json = r#"{
        "id": "user123",
        "email": "test@example.com",
        "salt": "somesalt",
        "attachmentsKey": {"iv": "a", "salt": "b", "cipher": "c", "length": 10, "alg": "xcha-argon2i13-7", "format": "base64"},
        "mfa": {"isEnabled": false, "primaryMethod": "email"}
    }"#;
    let user: User = serde_json::from_str(json).unwrap();
    assert_eq!(user.email, "test@example.com");
    assert_eq!(user.salt, "somesalt");
}
