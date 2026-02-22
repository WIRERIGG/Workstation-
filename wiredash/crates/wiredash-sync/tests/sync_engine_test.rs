use wiredash_sync::sync_engine::*;
use serde_json::json;

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
        ServerAction::ProcessItems { invocation_id, chunk } => {
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
        ServerAction::Completion { invocation_id, result } => {
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
