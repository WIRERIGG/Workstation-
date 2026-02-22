use crate::merger::{MergeResult, Merger};
use crate::signalr::*;
use crate::token::TokenManager;
use crate::types::*;
use wiredash_crypto::encryption::Decryption;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

// ---------------------------------------------------------------------------
// Server message processing (testable without network)
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum ServerAction {
    SendPing,
    ProcessItems {
        invocation_id: String,
        chunk: SyncTransferItem,
    },
    VaultKey {
        invocation_id: String,
        key: serde_json::Value,
    },
    Monographs {
        invocation_id: String,
        monographs: serde_json::Value,
    },
    InboxItems {
        invocation_id: String,
        items: serde_json::Value,
    },
    Completion {
        invocation_id: String,
        result: serde_json::Value,
    },
    Close,
    Unknown(serde_json::Value),
}

pub struct SyncProcessor;

impl SyncProcessor {
    /// Process a single SignalR message from the server.
    pub fn process_server_message(msg: &serde_json::Value) -> ServerAction {
        let msg_type = msg.get("type").and_then(|v| v.as_i64()).unwrap_or(0);

        match SignalRMessageType::from_value(msg_type) {
            SignalRMessageType::Ping => ServerAction::SendPing,
            SignalRMessageType::Close => ServerAction::Close,
            SignalRMessageType::Completion => {
                let inv_id = msg
                    .get("invocationId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let result = msg
                    .get("result")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                ServerAction::Completion {
                    invocation_id: inv_id,
                    result,
                }
            }
            SignalRMessageType::Invocation => {
                let target = msg.get("target").and_then(|v| v.as_str()).unwrap_or("");
                let inv_id = msg
                    .get("invocationId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let args = msg
                    .get("arguments")
                    .cloned()
                    .unwrap_or(serde_json::json!([]));

                match target {
                    "SendItems" => {
                        let chunk: SyncTransferItem = serde_json::from_value(
                            args.as_array()
                                .and_then(|a| a.first())
                                .cloned()
                                .unwrap_or_default(),
                        )
                        .unwrap_or(SyncTransferItem {
                            items: vec![],
                            r#type: String::new(),
                            count: 0,
                        });
                        ServerAction::ProcessItems {
                            invocation_id: inv_id,
                            chunk,
                        }
                    }
                    "SendVaultKey" => {
                        let key = args
                            .as_array()
                            .and_then(|a| a.first())
                            .cloned()
                            .unwrap_or_default();
                        ServerAction::VaultKey {
                            invocation_id: inv_id,
                            key,
                        }
                    }
                    "SendMonographs" => {
                        let monographs = args
                            .as_array()
                            .and_then(|a| a.first())
                            .cloned()
                            .unwrap_or_default();
                        ServerAction::Monographs {
                            invocation_id: inv_id,
                            monographs,
                        }
                    }
                    "SendInboxItems" => {
                        let items = args
                            .as_array()
                            .and_then(|a| a.first())
                            .cloned()
                            .unwrap_or_default();
                        ServerAction::InboxItems {
                            invocation_id: inv_id,
                            items,
                        }
                    }
                    _ => ServerAction::Unknown(msg.clone()),
                }
            }
            _ => ServerAction::Unknown(msg.clone()),
        }
    }
}

/// Generate a unique device ID (24-char hex string).
pub fn generate_device_id() -> String {
    uuid::Uuid::new_v4()
        .to_string()
        .replace("-", "")[..24]
        .to_string()
}

// ---------------------------------------------------------------------------
// SyncEngine (the full orchestrator)
// ---------------------------------------------------------------------------

pub struct SyncEngine<'a> {
    db: &'a Database,
    #[allow(dead_code)]
    token_manager: &'a TokenManager<'a>,
    encryption_key: SerializedKey,
    #[allow(dead_code)]
    device_id: String,
}

impl<'a> SyncEngine<'a> {
    pub fn new(
        db: &'a Database,
        token_manager: &'a TokenManager<'a>,
        encryption_key: SerializedKey,
        device_id: String,
    ) -> Self {
        Self {
            db,
            token_manager,
            encryption_key,
            device_id,
        }
    }

    /// Process a fetched chunk: decrypt items, merge with local, write to DB.
    pub fn process_chunk(&self, chunk: &SyncTransferItem) -> Result<(usize, usize), SyncError> {
        let table = SYNC_COLLECTIONS
            .iter()
            .find(|(item_type, _)| *item_type == chunk.r#type)
            .map(|(_, table)| *table)
            .unwrap_or(&chunk.r#type);

        let mut pulled = 0;
        let mut conflicts = 0;

        for sync_item in &chunk.items {
            // Decrypt
            let plaintext = Decryption::decrypt(&sync_item.cipher, &self.encryption_key)
                .map_err(SyncError::Crypto)?;
            let mut remote: serde_json::Value = serde_json::from_str(&plaintext)?;

            // Mark as remote + synced
            if let Some(obj) = remote.as_object_mut() {
                obj.insert("synced".into(), serde_json::json!(true));
                obj.insert("remote".into(), serde_json::json!(true));
            }

            // Look up local item
            let local = self.get_local_item(table, &sync_item.id)?;

            // Merge
            let is_content = chunk.r#type == "content";
            if is_content {
                match Merger::merge_content(local.as_ref(), &remote, CONFLICT_THRESHOLD_MS) {
                    MergeResult::TakeRemote(item) => {
                        self.upsert_item(table, &item)?;
                        pulled += 1;
                    }
                    MergeResult::Conflict {
                        mut local,
                        remote,
                    } => {
                        // Store remote as conflicted copy in local
                        if let Some(obj) = local.as_object_mut() {
                            obj.insert("conflicted".into(), remote);
                        }
                        self.upsert_item(table, &local)?;
                        conflicts += 1;
                    }
                    MergeResult::Skip => {}
                }
            } else if let Some(merged) = Merger::merge_item(local.as_ref(), &remote) {
                self.upsert_item(table, &merged)?;
                pulled += 1;
            }
        }

        Ok((pulled, conflicts))
    }

    fn get_local_item(
        &self,
        table: &str,
        id: &str,
    ) -> Result<Option<serde_json::Value>, SyncError> {
        let conn = self.db.conn();
        let sql = format!("SELECT * FROM {} WHERE id = ?1", table);
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| SyncError::Database(e.into()))?;

        // Get column names
        let col_count = stmt.column_count();
        let col_names: Vec<String> = (0..col_count)
            .map(|i| stmt.column_name(i).unwrap_or("").to_string())
            .collect();

        let result = stmt.query_row(rusqlite::params![id], |row| {
            let mut map = serde_json::Map::new();
            for (i, col) in col_names.iter().enumerate() {
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                    rusqlite::types::Value::Real(f) => serde_json::json!(f),
                    rusqlite::types::Value::Text(s) => {
                        serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))
                    }
                    rusqlite::types::Value::Blob(_) => serde_json::Value::Null,
                };
                map.insert(col.clone(), json_val);
            }
            Ok(serde_json::Value::Object(map))
        });

        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(SyncError::Database(e.into())),
        }
    }

    fn upsert_item(&self, table: &str, item: &serde_json::Value) -> Result<(), SyncError> {
        let obj = item
            .as_object()
            .ok_or_else(|| SyncError::Database(anyhow::anyhow!("item is not an object")))?;

        // Get table columns
        let conn = self.db.conn();
        let mut cols_stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .map_err(|e| SyncError::Database(e.into()))?;
        let col_names: Vec<String> = cols_stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| SyncError::Database(e.into()))?
            .filter_map(|r| r.ok())
            .collect();

        // Build INSERT OR REPLACE
        let placeholders: Vec<String> = (1..=col_names.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
            table,
            col_names.join(", "),
            placeholders.join(", "),
        );

        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for col in &col_names {
            let val = obj.get(col).cloned().unwrap_or(serde_json::Value::Null);
            match val {
                serde_json::Value::Null => params.push(Box::new(rusqlite::types::Null)),
                serde_json::Value::Bool(b) => params.push(Box::new(b as i32)),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        params.push(Box::new(i));
                    } else if let Some(f) = n.as_f64() {
                        params.push(Box::new(f));
                    } else {
                        params.push(Box::new(n.to_string()));
                    }
                }
                serde_json::Value::String(s) => params.push(Box::new(s)),
                other => params.push(Box::new(other.to_string())),
            }
        }

        let refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, refs.as_slice())
            .map_err(|e| SyncError::Database(e.into()))?;

        Ok(())
    }
}
