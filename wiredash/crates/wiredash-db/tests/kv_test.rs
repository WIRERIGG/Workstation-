use wiredash_db::Database;
use wiredash_db::kv::KvStore;

#[test]
fn test_kv_roundtrip() {
    let db = Database::open_memory().unwrap();
    let kv = KvStore::new(&db);

    assert!(kv.read("token").unwrap().is_none());

    let token_json = serde_json::json!({
        "access_token": "abc123",
        "refresh_token": "def456",
        "expires_in": 3600,
        "t": 1700000000000i64,
        "scope": "workstation.sync offline_access"
    });
    kv.write("token", &token_json).unwrap();

    let stored = kv.read("token").unwrap().expect("should exist");
    assert_eq!(stored["access_token"], "abc123");
    assert_eq!(stored["expires_in"], 3600);

    let updated = serde_json::json!({"access_token": "new_token"});
    kv.write("token", &updated).unwrap();
    let re_read = kv.read("token").unwrap().unwrap();
    assert_eq!(re_read["access_token"], "new_token");

    kv.delete("token").unwrap();
    assert!(kv.read("token").unwrap().is_none());
}

#[test]
fn test_kv_read_typed() {
    let db = Database::open_memory().unwrap();
    let kv = KvStore::new(&db);

    kv.write("deviceId", &serde_json::json!("abc123def")).unwrap();

    let device_id: Option<String> = kv.read_as("deviceId").unwrap();
    assert_eq!(device_id, Some("abc123def".to_string()));
}
