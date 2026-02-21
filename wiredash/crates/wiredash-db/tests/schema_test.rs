use wiredash_db::Database;

#[test]
fn test_create_database_and_all_tables() {
    let db = Database::open_memory().unwrap();

    let tables: Vec<String> = db
        .query_column(
            "SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .unwrap();

    let expected = vec![
        "attachments",
        "colors",
        "config",
        "content",
        "content_fts",
        "kv",
        "monographs",
        "notebooks",
        "notehistory",
        "notes",
        "notes_fts",
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
            tables.contains(&name.to_string()),
            "Missing table: {}. Found tables: {:?}",
            name,
            tables
        );
    }
}

#[test]
fn test_insert_and_read_note() {
    let db = Database::open_memory().unwrap();

    db.execute(
        "INSERT INTO notes (id, title) VALUES (?1, ?2)",
        rusqlite::params!["note-1", "Hello World"],
    )
    .unwrap();

    let title: String = db
        .query_one("SELECT title FROM notes WHERE id = 'note-1'")
        .unwrap();

    assert_eq!(title, "Hello World");
}

#[test]
fn test_encrypted_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("encrypted.db");
    let path_str = path.to_str().unwrap();

    // Create an encrypted database
    {
        let db = Database::open(path_str, Some("secret-password")).unwrap();
        db.execute(
            "INSERT INTO notes (id, title) VALUES (?1, ?2)",
            rusqlite::params!["note-enc", "Encrypted Note"],
        )
        .unwrap();
        // db is dropped here, closing the connection
    }

    // Try to open without password — should fail when querying
    {
        let result = Database::open(path_str, None);
        assert!(
            result.is_err(),
            "Opening encrypted DB without password should fail"
        );
    }
}
