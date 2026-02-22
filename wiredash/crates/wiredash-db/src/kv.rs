use std::collections::HashMap;

use arrow_array::RecordBatchIterator;
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};

use crate::arrow_utils::{batches_to_maps, escape_str, maps_to_batch};
use crate::connection::Database;
use crate::schemas::kv_schema;

/// Key-value store backed by the LanceDB `kv` table.
pub struct KvStore<'a> {
    db: &'a Database,
}

impl<'a> KvStore<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    // -----------------------------------------------------------------------
    // Async implementations
    // -----------------------------------------------------------------------

    /// Read a JSON value from the KV table (async).
    pub async fn read_async(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        let table = self.db.table_or_err("kv")?;
        let filter = format!("key = {}", escape_str(key));
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;

        let rows = batches_to_maps(&batches);
        match rows.first() {
            Some(row) => match row.get("value") {
                Some(serde_json::Value::String(s)) => {
                    Ok(serde_json::from_str(s).ok())
                }
                _ => Ok(None),
            },
            None => Ok(None),
        }
    }

    /// Read and deserialize a KV value into a concrete type (async).
    pub async fn read_as_async<T: serde::de::DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, anyhow::Error> {
        match self.read_async(key).await? {
            Some(v) => Ok(Some(serde_json::from_value(v)?)),
            None => Ok(None),
        }
    }

    /// Write (upsert) a JSON value to the KV table (async).
    pub async fn write_async(
        &self,
        key: &str,
        value: &serde_json::Value,
    ) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("kv")?;
        let now = chrono::Utc::now().timestamp_millis();
        let val_json = serde_json::to_string(value)?;

        let row = HashMap::from([
            ("key".to_string(), serde_json::json!(key)),
            ("value".to_string(), serde_json::json!(val_json)),
            ("dateModified".to_string(), serde_json::json!(now)),
        ]);

        let schema = kv_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());

        let mut op = table.merge_insert(&["key"]);
        op.when_matched_update_all(None)
            .when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;

        Ok(())
    }

    /// Delete a KV entry (async).
    pub async fn delete_async(&self, key: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("kv")?;
        let filter = format!("key = {}", escape_str(key));
        table.delete(&filter).await?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Sync wrappers (require a running tokio runtime)
    // -----------------------------------------------------------------------

    /// Read a JSON value from the KV table (sync).
    pub fn read(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        crate::arrow_utils::sync_run(self.read_async(key))
    }

    /// Read and deserialize a KV value into a concrete type (sync).
    pub fn read_as<T: serde::de::DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, anyhow::Error> {
        crate::arrow_utils::sync_run(self.read_as_async(key))
    }

    /// Write (upsert) a JSON value to the KV table (sync).
    pub fn write(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        crate::arrow_utils::sync_run(self.write_async(key, value))
    }

    /// Delete a KV entry (sync).
    pub fn delete(&self, key: &str) -> Result<(), anyhow::Error> {
        crate::arrow_utils::sync_run(self.delete_async(key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn write_and_read_back() {
        let db = Database::open_memory().await.unwrap();
        let kv = KvStore::new(&db);

        kv.write_async("greeting", &serde_json::json!("hello"))
            .await
            .unwrap();

        let val = kv.read_async("greeting").await.unwrap();
        assert_eq!(val, Some(serde_json::json!("hello")));
    }

    #[tokio::test]
    async fn read_missing_key_returns_none() {
        let db = Database::open_memory().await.unwrap();
        let kv = KvStore::new(&db);

        let val = kv.read_async("nonexistent").await.unwrap();
        assert!(val.is_none());
    }

    #[tokio::test]
    async fn overwrite_existing_key() {
        let db = Database::open_memory().await.unwrap();
        let kv = KvStore::new(&db);

        kv.write_async("counter", &serde_json::json!(1))
            .await
            .unwrap();
        kv.write_async("counter", &serde_json::json!(2))
            .await
            .unwrap();

        let val = kv.read_async("counter").await.unwrap();
        assert_eq!(val, Some(serde_json::json!(2)));
    }

    #[tokio::test]
    async fn delete_removes_key() {
        let db = Database::open_memory().await.unwrap();
        let kv = KvStore::new(&db);

        kv.write_async("temp", &serde_json::json!("data"))
            .await
            .unwrap();
        kv.delete_async("temp").await.unwrap();

        let val = kv.read_async("temp").await.unwrap();
        assert!(val.is_none());
    }

    #[tokio::test]
    async fn read_as_deserializes() {
        let db = Database::open_memory().await.unwrap();
        let kv = KvStore::new(&db);

        kv.write_async("count", &serde_json::json!(42))
            .await
            .unwrap();

        let val: Option<i64> = kv.read_as_async("count").await.unwrap();
        assert_eq!(val, Some(42));
    }
}
