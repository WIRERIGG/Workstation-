use wiredash_db::Database;
use wiredash_db::kv::KvStore;

#[tokio::test]
async fn test_kv_roundtrip() {
    let db = Database::open_memory().await.unwrap();
    let kv = KvStore::new(&db);

    assert!(kv.read_async("token").await.unwrap().is_none());

    let token_json = serde_json::json!({
        "access_token": "abc123",
        "refresh_token": "def456",
        "expires_in": 3600,
        "t": 1700000000000_i64,
        "scope": "workstation.sync offline_access"
    });
    kv.write_async("token", &token_json).await.unwrap();

    let stored = kv.read_async("token").await.unwrap().expect("should exist");
    assert_eq!(stored["access_token"], "abc123");
    assert_eq!(stored["expires_in"], 3600);

    let updated = serde_json::json!({"access_token": "new_token"});
    kv.write_async("token", &updated).await.unwrap();
    let re_read = kv.read_async("token").await.unwrap().unwrap();
    assert_eq!(re_read["access_token"], "new_token");

    kv.delete_async("token").await.unwrap();
    assert!(kv.read_async("token").await.unwrap().is_none());
}

#[tokio::test]
async fn test_kv_read_typed() {
    let db = Database::open_memory().await.unwrap();
    let kv = KvStore::new(&db);

    kv.write_async("deviceId", &serde_json::json!("abc123def")).await.unwrap();

    let device_id: Option<String> = kv.read_as_async("deviceId").await.unwrap();
    assert_eq!(device_id, Some("abc123def".to_string()));
}
