use std::collections::HashMap;

use arrow_array::RecordBatchIterator;
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use wiredash_db::{Database, batches_to_maps, maps_to_batch, escape_str, sync_run};

// ---------------------------------------------------------------------------
// Settings collection
// ---------------------------------------------------------------------------

pub struct Settings<'a> {
    db: &'a Database,
}

impl<'a> Settings<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    // -- async implementations ------------------------------------------------

    async fn get_setting_async(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        let table = self.db.table_or_err("settings")?;
        let filter = format!("key = {} AND deleted = 0", escape_str(key));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        match rows.first() {
            Some(row) => match row.get("value") {
                Some(serde_json::Value::String(s)) => Ok(serde_json::from_str(s).ok()),
                _ => Ok(None),
            },
            None => Ok(None),
        }
    }

    async fn set_async(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("settings")?;
        let now = chrono::Utc::now().timestamp_millis();
        let id = format!("setting_{}", key);
        let val_json = serde_json::to_string(value)?;

        let row = HashMap::from([
            ("id".to_string(), serde_json::json!(&id)),
            ("type".to_string(), serde_json::json!("settingitem")),
            ("dateModified".to_string(), serde_json::json!(now)),
            ("dateCreated".to_string(), serde_json::json!(now)),
            ("synced".to_string(), serde_json::json!(false)),
            ("deleted".to_string(), serde_json::json!(false)),
            ("key".to_string(), serde_json::json!(key)),
            ("value".to_string(), serde_json::json!(val_json)),
        ]);

        let schema = wiredash_db::schemas::settings_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn remove_async(&self, key: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("settings")?;
        let filter = format!("key = {}", escape_str(key));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        sync_run(self.get_setting_async(key))
    }

    /// Set a key-value setting. Uses merge_insert with a deterministic id
    /// derived from the key.
    pub fn set(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        sync_run(self.set_async(key, value))
    }

    /// Remove a setting by key.
    pub fn remove(&self, key: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(key))
    }
}
