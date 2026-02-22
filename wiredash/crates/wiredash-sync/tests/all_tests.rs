//! Consolidated sync test binary — avoids Windows PDB linker contention
//! with LanceDB's 100+ transitive dependencies.

use serde_json::json;
use wiredash_core::collections::notes::Notes;
use wiredash_core::types::Note;
use wiredash_crypto::encryption::Decryption;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;
use wiredash_sync::auth::AuthClient;
use wiredash_sync::collector::Collector;
use wiredash_sync::merger::{MergeResult, Merger};
use wiredash_sync::signalr::*;
use wiredash_sync::sync_engine::{generate_device_id, ServerAction, SyncEngine, SyncProcessor};
use wiredash_sync::token::TokenManager;
use wiredash_sync::types::*;

async fn test_db() -> Database {
    Database::open_memory().await.unwrap()
}

// =========================================================================
// types_test
// =========================================================================

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

// =========================================================================
// signalr_test
// =========================================================================

#[test]
fn test_encode_handshake() {
    let msg = SignalRCodec::encode_handshake();
    assert_eq!(msg, "{\"protocol\":\"json\",\"version\":1}\x1e");
}

#[test]
fn test_encode_invocation() {
    let msg = SignalRCodec::encode_invocation("PushCompletedV2", &["device123"]);
    assert!(msg.ends_with('\u{1e}'));
    let json_part = &msg[..msg.len() - 1];
    let parsed: serde_json::Value = serde_json::from_str(json_part).unwrap();
    assert_eq!(parsed["type"], 1);
    assert_eq!(parsed["target"], "PushCompletedV2");
    assert_eq!(parsed["arguments"][0], "device123");
}

#[test]
fn test_encode_invocation_with_id() {
    let msg = SignalRCodec::encode_invocation_with_id(
        "RequestFetchV3",
        &[serde_json::json!("dev123")],
        "inv-1",
    );
    let json_part = &msg[..msg.len() - 1];
    let parsed: serde_json::Value = serde_json::from_str(json_part).unwrap();
    assert_eq!(parsed["type"], 1);
    assert_eq!(parsed["invocationId"], "inv-1");
    assert_eq!(parsed["target"], "RequestFetchV3");
}

#[test]
fn test_decode_messages() {
    let raw = format!(
        "{}{}{}{}",
        r#"{"type":1,"target":"SendItems","arguments":[{"items":[],"type":"note","count":0}]}"#,
        "\x1e",
        r#"{"type":6}"#,
        "\x1e"
    );

    let msgs = SignalRCodec::decode_messages(&raw);
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["type"], 1);
    assert_eq!(msgs[0]["target"], "SendItems");
    assert_eq!(msgs[1]["type"], 6);
}

#[test]
fn test_decode_empty_and_whitespace() {
    let msgs = SignalRCodec::decode_messages("\x1e");
    assert_eq!(msgs.len(), 0);

    let msgs2 = SignalRCodec::decode_messages("");
    assert_eq!(msgs2.len(), 0);
}

#[test]
fn test_message_type_parsing() {
    assert_eq!(
        SignalRMessageType::from_value(1),
        SignalRMessageType::Invocation
    );
    assert_eq!(
        SignalRMessageType::from_value(3),
        SignalRMessageType::Completion
    );
    assert_eq!(
        SignalRMessageType::from_value(6),
        SignalRMessageType::Ping
    );
    assert_eq!(
        SignalRMessageType::from_value(7),
        SignalRMessageType::Close
    );
    assert_eq!(
        SignalRMessageType::from_value(99),
        SignalRMessageType::Unknown
    );
}

// =========================================================================
// auth_test
// =========================================================================

#[test]
fn test_build_email_params() {
    let params = AuthClient::email_params("user@test.com");
    assert_eq!(params.len(), 3);
    assert_eq!(params[0], ("email", "user@test.com".to_string()));
    assert_eq!(params[1], ("grant_type", "email".to_string()));
    assert_eq!(params[2], ("client_id", CLIENT_ID.to_string()));
}

#[test]
fn test_build_password_params() {
    let params = AuthClient::password_params("hashed_pw_base64");
    assert_eq!(params.len(), 4);
    assert_eq!(params[0], ("grant_type", "mfa_password".to_string()));
    assert_eq!(params[1], ("client_id", CLIENT_ID.to_string()));
    assert_eq!(
        params[2],
        (
            "scope",
            "workstation.sync offline_access IdentityServerApi".to_string()
        )
    );
    assert_eq!(params[3], ("password", "hashed_pw_base64".to_string()));
}

#[test]
fn test_build_mfa_params() {
    let params = AuthClient::mfa_params("123456", "app");
    assert_eq!(params.len(), 4);
    assert_eq!(params[0], ("grant_type", "mfa".to_string()));
    assert_eq!(params[1], ("client_id", CLIENT_ID.to_string()));
    assert_eq!(params[2], ("mfa:code", "123456".to_string()));
    assert_eq!(params[3], ("mfa:method", "app".to_string()));
}

#[test]
fn test_build_signup_params() {
    let params = AuthClient::signup_params("user@test.com", "hashed");
    assert_eq!(params.len(), 3);
    assert_eq!(params[0], ("email", "user@test.com".to_string()));
    assert_eq!(params[1], ("password", "hashed".to_string()));
    assert_eq!(params[2], ("client_id", CLIENT_ID.to_string()));
}

#[test]
fn test_parse_token_response() {
    let json = r#"{
        "access_token": "jwt-abc",
        "refresh_token": "ref-def",
        "expires_in": 3600,
        "scope": "workstation.sync offline_access IdentityServerApi"
    }"#;
    let resp: TokenResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.access_token, "jwt-abc");
    assert_eq!(resp.refresh_token.as_deref(), Some("ref-def"));
    assert_eq!(resp.expires_in, Some(3600));
}

#[test]
fn test_token_response_to_token() {
    let resp = TokenResponse {
        access_token: "a".into(),
        refresh_token: Some("r".into()),
        expires_in: Some(1800),
        scope: Some("workstation.sync".into()),
        additional_data: None,
    };
    let token = AuthClient::token_response_to_token(&resp);
    assert_eq!(token.access_token, "a");
    assert_eq!(token.refresh_token, "r");
    assert_eq!(token.expires_in, 1800);
    assert!(token.t > 0);
}

// =========================================================================
// merger_test
// =========================================================================

fn make_item(date_modified: i64, deleted: bool) -> serde_json::Value {
    json!({
        "id": "item-1",
        "type": "note",
        "dateModified": date_modified,
        "dateCreated": 1000,
        "synced": false,
        "deleted": deleted,
        "title": "Test"
    })
}

fn make_content(
    date_modified: i64,
    date_edited: i64,
    synced: bool,
    data: &str,
) -> serde_json::Value {
    json!({
        "id": "content-1",
        "type": "content",
        "dateModified": date_modified,
        "dateCreated": 1000,
        "synced": synced,
        "deleted": false,
        "data": data,
        "dateEdited": date_edited,
        "locked": false,
        "localOnly": false
    })
}

#[test]
fn test_merge_item_no_local_takes_remote() {
    let remote = make_item(2000, false);
    let result = Merger::merge_item(None, &remote);
    assert!(result.is_some());
}

#[test]
fn test_merge_item_remote_newer_takes_remote() {
    let local = make_item(1000, false);
    let remote = make_item(2000, false);
    let result = Merger::merge_item(Some(&local), &remote);
    assert!(result.is_some());
}

#[test]
fn test_merge_item_local_newer_keeps_local() {
    let local = make_item(3000, false);
    let remote = make_item(2000, false);
    let result = Merger::merge_item(Some(&local), &remote);
    assert!(result.is_none());
}

#[test]
fn test_merge_content_local_not_edited_takes_remote() {
    let local = make_content(1000, 1000, true, "<p>old</p>");
    let remote = make_content(2000, 2000, false, "<p>new</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert_eq!(result, MergeResult::TakeRemote(remote));
}

#[test]
fn test_merge_content_within_threshold_last_write_wins() {
    let now = chrono::Utc::now().timestamp_millis();
    let local = make_content(now, now, false, "<p>local edit</p>");
    let remote = make_content(now + 30_000, now + 30_000, false, "<p>remote edit</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert!(matches!(result, MergeResult::TakeRemote(_)));
}

#[test]
fn test_merge_content_outside_threshold_conflict() {
    let now = chrono::Utc::now().timestamp_millis();
    let local = make_content(now, now, false, "<p>local version</p>");
    let remote = make_content(now + 120_000, now + 120_000, false, "<p>remote version</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert!(matches!(result, MergeResult::Conflict { .. }));
}

#[test]
fn test_merge_content_same_html_no_conflict() {
    let now = chrono::Utc::now().timestamp_millis();
    let local = make_content(now, now, false, "<p>same text</p>");
    let remote = make_content(now + 120_000, now + 120_000, false, "<p>same text</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert!(matches!(result, MergeResult::TakeRemote(_)));
}

// =========================================================================
// sync_engine_test
// =========================================================================

#[test]
fn test_process_server_message_ping() {
    let msg = json!({"type": 6});
    let action = SyncProcessor::process_server_message(&msg);
    assert_eq!(action, ServerAction::SendPing);
}

#[test]
fn test_process_server_message_send_items() {
    let msg = json!({
        "type": 1,
        "invocationId": "inv-1",
        "target": "SendItems",
        "arguments": [{
            "items": [{"id": "n1", "v": 6.1, "format": "base64", "alg": "xcha-argon2i13-7", "cipher": "abc", "iv": "def", "salt": "ghi", "length": 10}],
            "type": "note",
            "count": 1
        }]
    });
    let action = SyncProcessor::process_server_message(&msg);
    match action {
        ServerAction::ProcessItems {
            invocation_id,
            chunk,
        } => {
            assert_eq!(invocation_id, "inv-1");
            assert_eq!(chunk.r#type, "note");
            assert_eq!(chunk.count, 1);
        }
        _ => panic!("expected ProcessItems"),
    }
}

#[test]
fn test_process_server_message_completion() {
    let msg = json!({"type": 3, "invocationId": "push-1", "result": 1});
    let action = SyncProcessor::process_server_message(&msg);
    match action {
        ServerAction::Completion {
            invocation_id,
            result,
        } => {
            assert_eq!(invocation_id, "push-1");
            assert_eq!(result, json!(1));
        }
        _ => panic!("expected Completion"),
    }
}

#[test]
fn test_process_server_message_close() {
    let msg = json!({"type": 7});
    let action = SyncProcessor::process_server_message(&msg);
    assert_eq!(action, ServerAction::Close);
}

#[test]
fn test_process_server_message_send_vault_key() {
    let msg = json!({
        "type": 1,
        "invocationId": "inv-2",
        "target": "SendVaultKey",
        "arguments": [{"cipher": "abc"}]
    });
    let action = SyncProcessor::process_server_message(&msg);
    match action {
        ServerAction::VaultKey { invocation_id, .. } => {
            assert_eq!(invocation_id, "inv-2");
        }
        _ => panic!("expected VaultKey"),
    }
}

#[test]
fn test_device_id_generation() {
    let id1 = generate_device_id();
    let id2 = generate_device_id();
    assert_ne!(id1, id2, "should generate unique device IDs");
    assert!(!id1.is_empty());
    assert_eq!(id1.len(), 24, "device ID should be 24 chars");
}

// =========================================================================
// collector_test
// =========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_unsynced_notes() {
    let db = test_db().await;
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
    let db = test_db().await;
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
    let db = test_db().await;
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
    let decrypted = Decryption::decrypt(&batches[0].items[0].cipher, &key).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
    assert_eq!(parsed["deleted"], true);
    assert_eq!(parsed["id"], "local-note");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_collect_skips_deleted_items() {
    let db = test_db().await;
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
    let db = test_db().await;
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
    let db = test_db().await;
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

    let decrypted = Decryption::decrypt(&batches[0].items[0].cipher, &key).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&decrypted).unwrap();

    // `synced` field must be stripped before encryption
    assert!(
        parsed.get("synced").is_none(),
        "synced field should be stripped"
    );
    // But other fields should remain
    assert_eq!(parsed["id"], "check-note");
    assert_eq!(parsed["title"], "My Note");
}

// =========================================================================
// token_test
// =========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_token_manager_store_and_retrieve() {
    let db = test_db().await;
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
    let db = test_db().await;
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
    let db = test_db().await;
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

// =========================================================================
// integration_test
// =========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_full_offline_sync_roundtrip() {
    // 1. Set up two "devices" (two in-memory databases + shared encryption key)
    let db_a = test_db().await;
    let db_b = test_db().await;

    let key = SerializedKey {
        password: Some("shared-password".into()),
        key: None,
        salt: None,
    };

    // 2. Device A creates a note
    let notes_a = Notes::new(&db_a);
    let mut note = Note::new("Device A Note");
    note.base.id = "note-shared".to_string();
    notes_a.add(&note).unwrap();

    // 3. Device A collects unsynced items (simulates push)
    let collector_a = Collector::new(&db_a);
    let batches = collector_a
        .collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE)
        .unwrap();
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
    let notes_b = Notes::new(&db_b);
    let received = notes_b
        .get("note-shared")
        .unwrap()
        .expect("note should exist in device B");
    assert_eq!(received.title, "Device A Note");

    // 5. Device B edits the note
    notes_b
        .update_title("note-shared", "Device B Edit")
        .unwrap();

    // 6. Device B collects and sends back
    let collector_b = Collector::new(&db_b);
    let batches_b = collector_b
        .collect_for_type("note", "notes", &key, SYNC_BATCH_SIZE)
        .unwrap();
    assert_eq!(batches_b.len(), 1);

    // 7. Device A receives Device B's edit
    let tm_a = TokenManager::new(&db_a);
    let device_id_a = generate_device_id();
    let engine_a = SyncEngine::new(&db_a, &tm_a, key.clone(), device_id_a);
    let (pulled_a, conflicts_a) = engine_a.process_chunk(&batches_b[0]).unwrap();
    assert_eq!(pulled_a, 1);
    assert_eq!(conflicts_a, 0);

    // Verify Device A now has the updated title
    let updated = notes_a
        .get("note-shared")
        .unwrap()
        .expect("note should exist in device A");
    assert_eq!(updated.title, "Device B Edit");
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

#[tokio::test(flavor = "multi_thread")]
async fn test_token_kv_roundtrip() {
    let db = test_db().await;
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
