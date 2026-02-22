use serde_json::json;

const RS: char = '\x1e'; // Record separator

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalRMessageType {
    Invocation,       // 1
    StreamItem,       // 2
    Completion,       // 3
    StreamInvocation, // 4
    CancelInvocation, // 5
    Ping,             // 6
    Close,            // 7
    Unknown,
}

impl SignalRMessageType {
    pub fn from_value(v: i64) -> Self {
        match v {
            1 => Self::Invocation,
            2 => Self::StreamItem,
            3 => Self::Completion,
            4 => Self::StreamInvocation,
            5 => Self::CancelInvocation,
            6 => Self::Ping,
            7 => Self::Close,
            _ => Self::Unknown,
        }
    }
}

pub struct SignalRCodec;

impl SignalRCodec {
    /// Encode the initial handshake message.
    pub fn encode_handshake() -> String {
        format!("{{\"protocol\":\"json\",\"version\":1}}{RS}")
    }

    /// Encode a fire-and-forget invocation (no invocation ID).
    pub fn encode_invocation(target: &str, str_args: &[&str]) -> String {
        let args: Vec<serde_json::Value> = str_args.iter()
            .map(|s| json!(s))
            .collect();
        let msg = json!({
            "type": 1,
            "target": target,
            "arguments": args,
        });
        format!("{}{RS}", serde_json::to_string(&msg).unwrap())
    }

    /// Encode an invocation with an invocation ID (expects a Completion response).
    pub fn encode_invocation_with_id(
        target: &str,
        args: &[serde_json::Value],
        invocation_id: &str,
    ) -> String {
        let msg = json!({
            "type": 1,
            "invocationId": invocation_id,
            "target": target,
            "arguments": args,
        });
        format!("{}{RS}", serde_json::to_string(&msg).unwrap())
    }

    /// Encode a Completion (return value) message.
    pub fn encode_completion(invocation_id: &str, result: &serde_json::Value) -> String {
        let msg = json!({
            "type": 3,
            "invocationId": invocation_id,
            "result": result,
        });
        format!("{}{RS}", serde_json::to_string(&msg).unwrap())
    }

    /// Encode a Ping message.
    pub fn encode_ping() -> String {
        format!("{{\"type\":6}}{RS}")
    }

    /// Decode a raw WebSocket text frame into individual JSON messages.
    pub fn decode_messages(raw: &str) -> Vec<serde_json::Value> {
        raw.split(RS)
            .filter(|s| !s.trim().is_empty())
            .filter_map(|s| serde_json::from_str(s).ok())
            .collect()
    }
}
