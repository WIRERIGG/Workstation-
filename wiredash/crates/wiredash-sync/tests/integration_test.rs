use wiredash_sync::collector::Collector;
use wiredash_sync::merger::{Merger, MergeResult};
use wiredash_sync::sync_engine::{SyncEngine, SyncProcessor, ServerAction, generate_device_id};
use wiredash_sync::signalr::SignalRCodec;
use wiredash_sync::token::TokenManager;
use wiredash_sync::types::*;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

#[test]
fn test_full_offline_sync_roundtrip() {
    // 1. Set up two "devices" (two in-memory databases + shared encryption key)
    let db_a = Database::open_memory().unwrap();
    let db_b = Database::open_memory().unwrap();

    let key = SerializedKey {
        password: Some("shared-password".into()),
        key: None,
        salt: None,
    };

    // 2. Device A creates a note
    let now = chrono::Utc::now().timestamp_millis();
    db_a.execute(
        "INSERT INTO notes (id, type, dateModified, dateCreated, synced, deleted, title, pinned, favorite, localOnly, conflicted, readonly, dateEdited)
         VALUES (?1, 'note', ?2, ?2, 0, 0, 'Device A Note', 0, 0, 0, 0, 0, ?2)",
        rusqlite::params!["note-shared", now],
    ).unwrap();

    // 3. Device A collects unsynced items (simulates push)
    let collector_a = Collector::new(&db_a);
    let batches = collector_a.collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE).unwrap();
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].items.len(), 1);

    // 4. Device B processes the batch (simulates fetch + merge)
    let tm_b = TokenManager::new(&db_b);
    let device_id = generate_device_id();
    let engine_b = SyncEngine::new(&db_b, &tm_b, key.clone(), device_id);
    let (pulled, conflicts) = engine_b.process_chunk(&batches[0]).unwrap();
    assert_eq!(pulled, 1);
    assert_eq!(conflicts, 0);

    // Verify the note landed in Device B's database
    let row: String = db_b.conn()
        .query_row("SELECT title FROM notes WHERE id = 'note-shared'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(row, "Device A Note");

    // 5. Device B edits the note
    let later = now + 5000;
    db_b.execute(
        "UPDATE notes SET title = 'Device B Edit', dateModified = ?1, synced = 0 WHERE id = 'note-shared'",
        rusqlite::params![later],
    ).unwrap();

    // 6. Device B collects and sends back
    let collector_b = Collector::new(&db_b);
    let batches_b = collector_b.collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE).unwrap();
    assert_eq!(batches_b.len(), 1);

    // 7. Device A receives Device B's edit
    let tm_a = TokenManager::new(&db_a);
    let device_id_a = generate_device_id();
    let engine_a = SyncEngine::new(&db_a, &tm_a, key.clone(), device_id_a);
    let (pulled_a, conflicts_a) = engine_a.process_chunk(&batches_b[0]).unwrap();
    assert_eq!(pulled_a, 1);
    assert_eq!(conflicts_a, 0);

    // Verify Device A now has the updated title
    let updated: String = db_a.conn()
        .query_row("SELECT title FROM notes WHERE id = 'note-shared'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(updated, "Device B Edit");
}

#[test]
fn test_signalr_message_routing() {
    // Verify the full SignalR codec + processor pipeline
    let handshake = SignalRCodec::encode_handshake();
    assert!(handshake.contains("json"));

    let invoke = SignalRCodec::encode_invocation_with_id(
        "RequestFetchV3",
        &[serde_json::json!("dev-1")],
        "fetch-1",
    );
    // Decode what we encoded
    let msgs = SignalRCodec::decode_messages(&invoke);
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["target"], "RequestFetchV3");

    // Process a ping
    let action = SyncProcessor::process_server_message(&serde_json::json!({"type": 6}));
    assert_eq!(action, ServerAction::SendPing);
}

#[test]
fn test_token_kv_roundtrip() {
    let db = Database::open_memory().unwrap();
    let tm = TokenManager::new(&db);

    // No token initially
    assert!(tm.get_token().unwrap().is_none());

    // Save a token
    let token = Token {
        access_token: "abc".into(),
        refresh_token: "def".into(),
        expires_in: 3600,
        t: chrono::Utc::now().timestamp_millis(),
        scope: "workstation.sync offline_access".into(),
    };
    tm.save_token(&token).unwrap();

    // Read back
    let stored = tm.get_token().unwrap().unwrap();
    assert_eq!(stored.access_token, "abc");
    assert!(!stored.is_expired());
    assert!(stored.is_refreshable());

    // Delete
    tm.delete_token().unwrap();
    assert!(tm.get_token().unwrap().is_none());
}

#[test]
fn test_content_conflict_detection() {
    let now = chrono::Utc::now().timestamp_millis();

    // Two devices edit the same content >60s apart with different data -> conflict
    let local = serde_json::json!({
        "id": "c-1", "type": "content", "data": "<p>local text</p>",
        "dateModified": now, "dateEdited": now,
        "synced": false, "deleted": false, "localOnly": false,
    });
    let remote = serde_json::json!({
        "id": "c-1", "type": "content", "data": "<p>remote text</p>",
        "dateModified": now + 120_000, "dateEdited": now + 120_000,
        "synced": false, "deleted": false,
    });

    let result = Merger::merge_content(Some(&local), &remote, CONFLICT_THRESHOLD_MS);
    assert!(matches!(result, MergeResult::Conflict { .. }));

    // Same content -> no conflict even if >60s apart
    let remote_same = serde_json::json!({
        "id": "c-1", "type": "content", "data": "<p>local text</p>",
        "dateModified": now + 120_000, "dateEdited": now + 120_000,
        "synced": false, "deleted": false,
    });
    let result2 = Merger::merge_content(Some(&local), &remote_same, CONFLICT_THRESHOLD_MS);
    assert!(matches!(result2, MergeResult::TakeRemote(_)));
}
