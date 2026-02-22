use wiredash_sync::token::TokenManager;
use wiredash_sync::types::Token;

#[tokio::test(flavor = "multi_thread")]
async fn test_token_manager_store_and_retrieve() {
    let db = wiredash_db::Database::open_memory().await.unwrap();
    let tm = TokenManager::new(&db);

    assert!(tm.get_token().unwrap().is_none());

    let token = Token {
        access_token: "test-access".into(),
        refresh_token: "test-refresh".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();

    let retrieved = tm.get_token().unwrap().expect("should exist");
    assert_eq!(retrieved.access_token, "test-access");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_token_manager_delete() {
    let db = wiredash_db::Database::open_memory().await.unwrap();
    let tm = TokenManager::new(&db);

    let token = Token {
        access_token: "test".into(),
        refresh_token: "ref".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();
    tm.delete_token().unwrap();
    assert!(tm.get_token().unwrap().is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_token_manager_access_token_from_fresh_token() {
    let db = wiredash_db::Database::open_memory().await.unwrap();
    let tm = TokenManager::new(&db);

    let token = Token {
        access_token: "fresh-token".into(),
        refresh_token: "ref".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();

    let access = tm.get_access_token_no_refresh().unwrap().unwrap();
    assert_eq!(access, "fresh-token");
}
