use std::collections::HashMap;

use arrow_array::RecordBatchIterator;
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};

use crate::merger::{MergeResult, Merger};
use crate::signalr::*;
use crate::token::TokenManager;
use crate::types::*;
use wiredash_crypto::encryption::Decryption;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::{Database, batches_to_maps, maps_to_batch, escape_str, sync_run};

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
        table_name: &str,
        id: &str,
    ) -> Result<Option<serde_json::Value>, SyncError> {
        let table = self.db.table_or_err(table_name)
            .map_err(SyncError::Database)?;
        let filter = format!("id = {}", escape_str(id));

        let batches: Vec<arrow_array::RecordBatch> = sync_run(async {
            let result: Result<Vec<arrow_array::RecordBatch>, lancedb::Error> =
                table.query().only_if(&filter).execute().await?.try_collect().await;
            result
        }).map_err(|e: lancedb::Error| SyncError::Database(e.into()))?;

        let rows = batches_to_maps(&batches);
        match rows.into_iter().next() {
            Some(map) => {
                let json_map: serde_json::Map<String, serde_json::Value> =
                    map.into_iter().collect::<serde_json::Map<String, serde_json::Value>>();
                Ok(Some(serde_json::Value::Object(json_map)))
            }
            None => Ok(None),
        }
    }

    fn upsert_item(&self, table_name: &str, item: &serde_json::Value) -> Result<(), SyncError> {
        let obj = item
            .as_object()
            .ok_or_else(|| SyncError::Database(anyhow::anyhow!("item is not an object")))?;

        let table = self.db.table_or_err(table_name)
            .map_err(SyncError::Database)?;
        let schema_arc = sync_run(table.schema())
            .map_err(|e: lancedb::Error| SyncError::Database(e.into()))?;

        // Build a map with only columns that exist in the schema
        let mut row: HashMap<String, serde_json::Value> = HashMap::new();
        for field in schema_arc.fields().iter() {
            let name: &String = field.name();
            if let Some(val) = obj.get(name.as_str()) {
                row.insert(name.clone(), val.clone());
            } else {
                row.insert(name.clone(), serde_json::Value::Null);
            }
        }

        let batch = maps_to_batch(&schema_arc, &[row])
            .map_err(SyncError::Database)?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema_arc);

        sync_run(async {
            let mut op = table.merge_insert(&["id"]);
            op.when_matched_update_all(None)
                .when_not_matched_insert_all();
            op.execute(Box::new(reader)).await
        }).map_err(|e: lancedb::Error| SyncError::Database(e.into()))?;

        Ok(())
    }
}
