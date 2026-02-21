use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;
use wiredash_sync::collector::Collector;
use wiredash_sync::types::*;

#[test]
fn test_collect_unsynced_notes() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 0, 'Test Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["note-1", now],
    )
    .unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector
        .collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE)
        .unwrap();

    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].r#type, "note");
    assert_eq!(batches[0].count, 1);
    assert_eq!(batches[0].items.len(), 1);
    assert_eq!(batches[0].items[0].id, "note-1");
    assert_eq!(batches[0].items[0].v, CURRENT_DATABASE_VERSION);
    assert!(!batches[0].items[0].cipher.cipher.is_empty());
}

#[test]
fn test_collect_skips_synced_items() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 1, 0, 'Synced Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["synced-note", now],
    )
    .unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector
        .collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE)
        .unwrap();

    assert!(batches.is_empty());
}

#[test]
fn test_collect_local_only_becomes_tombstone() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 0, 'Local Note', 0, 0, 1, 0, 0, ?2)",
        rusqlite::params!["local-note", now],
    )
    .unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector
        .collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE)
        .unwrap();

    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].items.len(), 1);

    // Decrypt and verify it's a tombstone
    use wiredash_crypto::encryption::Decryption;
    let decrypted =
        Decryption::decrypt(&batches[0].items[0].cipher, &key).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
    assert_eq!(parsed["deleted"], true);
    assert_eq!(parsed["id"], "local-note");
}

#[test]
fn test_collect_skips_deleted_items() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 1, 'Deleted Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["deleted-note", now],
    )
    .unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector
        .collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE)
        .unwrap();

    assert!(batches.is_empty());
}

#[test]
fn test_collect_batches_correctly() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    // Insert 5 notes, use batch_size=2 → expect 3 batches (2+2+1)
    for i in 0..5u32 {
        db.execute(
            "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
             VALUES (?1, 'note', ?2, ?2, 0, 0, ?3, 0, 0, 0, 0, 0, ?2)",
            rusqlite::params![format!("note-{i}"), now, format!("Note {i}")],
        )
        .unwrap();
    }

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector
        .collect_for_type("note", "notes", &key, 2)
        .unwrap();

    assert_eq!(batches.len(), 3);
    assert_eq!(batches[0].count, 2);
    assert_eq!(batches[1].count, 2);
    assert_eq!(batches[2].count, 1);
    // All should have type "note"
    for batch in &batches {
        assert_eq!(batch.r#type, "note");
    }
}

#[test]
fn test_collect_encrypted_payload_excludes_synced_field() {
    let db = Database::open_memory().unwrap();
    let now = chrono::Utc::now().timestamp_millis();

    db.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 0, 'My Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["check-note", now],
    )
    .unwrap();

    let key = SerializedKey {
        password: Some("test-password".into()),
        key: None,
        salt: None,
    };

    let collector = Collector::new(&db);
    let batches = collector
        .collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE)
        .unwrap();

    use wiredash_crypto::encryption::Decryption;
    let decrypted = Decryption::decrypt(&batches[0].items[0].cipher, &key).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&decrypted).unwrap();

    // `synced` field must be stripped before encryption
    assert!(parsed.get("synced").is_none(), "synced field should be stripped");
    // But other fields should remain
    assert_eq!(parsed["id"], "check-note");
    assert_eq!(parsed["title"], "My Note");
}
