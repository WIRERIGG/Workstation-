use wiredash_db::Database;

#[tokio::test]
async fn test_create_database_and_all_tables() {
    let db = Database::open_memory().await.unwrap();

    // LanceDB doesn't have sqlite_master; verify via our table() accessor
    let expected = vec![
        "attachments",
        "colors",
        "config",
        "content",
        "kv",
        "monographs",
        "notebooks",
        "notehistory",
        "notes",
        "relations",
        "reminders",
        "sessioncontent",
        "settings",
        "shortcuts",
        "tags",
        "vaults",
    ];

    for name in &expected {
        assert!(
            db.table(name).is_some(),
            "Missing table: {}",
            name
        );
    }
}

#[tokio::test]
async fn test_count_rows_on_empty_table() {
    let db = Database::open_memory().await.unwrap();
    let count = db.count_rows("notes", None).await.unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_open_persistent_path() {
    let dir = tempfile::tempdir().unwrap();
    let path_str = dir.path().to_str().unwrap();

    // Open creates all tables
    {
        let db = Database::open(path_str).await.unwrap();
        assert!(db.table("notes").is_some());
    }

    // Re-open finds existing tables
    {
        let db = Database::open(path_str).await.unwrap();
        assert!(db.table("notes").is_some());
    }
}
