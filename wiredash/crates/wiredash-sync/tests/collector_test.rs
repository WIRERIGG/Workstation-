use wiredash_core::collections::notes::Notes;
use wiredash_core::types::Note;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;
use wiredash_sync::collector::Collector;
use wiredash_sync::types::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_unsynced_notes() {
    let db = Database::open_memory().await.unwrap();
    let notes = Notes::new(&db);

    let mut note = Note::new("Test Note");
    note.base.id = "note-1".to_string();
    notes.add(&note).unwrap();

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

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_skips_synced_items() {
    let db = Database::open_memory().await.unwrap();
    let notes = Notes::new(&db);

    let mut note = Note::new("Synced Note");
    note.base.id = "synced-note".to_string();
    note.base.synced = true;
    notes.add(&note).unwrap();

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

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_local_only_becomes_tombstone() {
    let db = Database::open_memory().await.unwrap();
    let notes = Notes::new(&db);

    let mut note = Note::new("Local Note");
    note.base.id = "local-note".to_string();
    note.local_only = true;
    notes.add(&note).unwrap();

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

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_skips_deleted_items() {
    let db = Database::open_memory().await.unwrap();
    let notes = Notes::new(&db);

    // A deleted item that has already been synced should not be re-collected.
    let mut note = Note::new("Deleted Note");
    note.base.id = "deleted-note".to_string();
    note.base.deleted = true;
    note.base.synced = true;
    notes.add(&note).unwrap();

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

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_batches_correctly() {
    let db = Database::open_memory().await.unwrap();
    let notes = Notes::new(&db);

    // Insert 5 notes, use batch_size=2 -> expect 3 batches (2+2+1)
    for i in 0..5u32 {
        let mut note = Note::new(&format!("Note {i}"));
        note.base.id = format!("note-{i}");
        notes.add(&note).unwrap();
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

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_encrypted_payload_excludes_synced_field() {
    let db = Database::open_memory().await.unwrap();
    let notes = Notes::new(&db);

    let mut note = Note::new("My Note");
    note.base.id = "check-note".to_string();
    notes.add(&note).unwrap();

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
