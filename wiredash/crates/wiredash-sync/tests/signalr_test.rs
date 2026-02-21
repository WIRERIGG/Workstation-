use wiredash_sync::signalr::*;

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
    assert_eq!(SignalRMessageType::from_value(1), SignalRMessageType::Invocation);
    assert_eq!(SignalRMessageType::from_value(3), SignalRMessageType::Completion);
    assert_eq!(SignalRMessageType::from_value(6), SignalRMessageType::Ping);
    assert_eq!(SignalRMessageType::from_value(7), SignalRMessageType::Close);
    assert_eq!(SignalRMessageType::from_value(99), SignalRMessageType::Unknown);
}
