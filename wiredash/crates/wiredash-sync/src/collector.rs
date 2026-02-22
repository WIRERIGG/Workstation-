use wiredash_crypto::encryption::Encryption;
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;
use crate::types::*;

pub struct Collector<'a> {
    db: &'a Database,
}

impl<'a> Collector<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Collect unsynced items for one item type, encrypt them, and return
    /// batches of `SyncTransferItem` (each up to `batch_size` items).
    pub fn collect_for_type(
        &self,
        item_type: &str,
        table: &str,
        key: &SerializedKey,
        batch_size: usize,
    ) -> Result<Vec<SyncTransferItem>, SyncError> {
        let unsynced = self
            .db
            .query_unsynced(table)
            .map_err(|e: anyhow::Error| SyncError::Database(e))?;

        if unsynced.is_empty() {
            return Ok(vec![]);
        }

        let mut all_items = Vec::new();
        for (id, json_str) in &unsynced {
            let plaintext =
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                    let is_local_only = parsed
                        .get("localOnly")
                        .and_then(|v| v.as_i64())
                        .map(|v| v != 0)
                        .unwrap_or(false);

                    if is_local_only {
                        // Emit a tombstone so the server side knows to ignore this item
                        let tombstone = serde_json::json!({
                            "id": id,
                            "deleted": true,
                            "dateModified": parsed
                                .get("dateModified")
                                .cloned()
                                .unwrap_or_else(|| {
                                    serde_json::json!(chrono::Utc::now().timestamp_millis())
                                }),
                        });
                        tombstone.to_string()
                    } else {
                        // Strip the internal `synced` flag before sending
                        let mut obj = parsed;
                        if let Some(map) = obj.as_object_mut() {
                            map.remove("synced");
                        }
                        obj.to_string()
                    }
                } else {
                    json_str.to_string()
                };

            let cipher = Encryption::encrypt(key, &plaintext).map_err(SyncError::Crypto)?;

            all_items.push(SyncItem {
                id: id.to_string(),
                v: CURRENT_DATABASE_VERSION,
                cipher,
            });
        }

        let batches: Vec<SyncTransferItem> = all_items
            .chunks(batch_size)
            .map(|chunk| SyncTransferItem {
                items: chunk.to_vec(),
                r#type: item_type.to_string(),
                count: chunk.len(),
            })
            .collect();

        Ok(batches)
    }

    /// Collect all unsynced items across all syncable collections.
    pub fn collect_all(
        &self,
        key: &SerializedKey,
        batch_size: usize,
    ) -> Result<Vec<SyncTransferItem>, SyncError> {
        let mut all_batches = Vec::new();
        for &(item_type, table) in SYNC_COLLECTIONS {
            let batches = self.collect_for_type(item_type, table, key, batch_size)?;
            all_batches.extend(batches);
        }
        Ok(all_batches)
    }
}
