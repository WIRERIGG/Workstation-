use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use arrow_array::RecordBatchIterator;
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use wiredash_db::{Database, batches_to_maps, maps_to_batch, escape_str, sync_run};

// ---------------------------------------------------------------------------
// Relations collection
// ---------------------------------------------------------------------------

pub struct Relations<'a> {
    db: &'a Database,
}

impl<'a> Relations<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Generate deterministic relation ID from (fromType, fromId, toType, toId).
    /// Hashes the composite key with DefaultHasher and formats as hex.
    fn generate_id(from_type: &str, from_id: &str, to_type: &str, to_id: &str) -> String {
        let composite = format!("{}:{}:{}:{}", from_type, from_id, to_type, to_id);
        let mut hasher = DefaultHasher::new();
        composite.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }

    // -- async implementations ------------------------------------------------

    async fn add_async(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("relations")?;
        let id = Self::generate_id(from_type, from_id, to_type, to_id);
        let now = chrono::Utc::now().timestamp_millis();

        let row = HashMap::from([
            ("id".to_string(), serde_json::json!(&id)),
            ("type".to_string(), serde_json::json!("relation")),
            ("dateModified".to_string(), serde_json::json!(now)),
            ("dateCreated".to_string(), serde_json::json!(now)),
            ("synced".to_string(), serde_json::json!(false)),
            ("deleted".to_string(), serde_json::json!(false)),
            ("fromType".to_string(), serde_json::json!(from_type)),
            ("fromId".to_string(), serde_json::json!(from_id)),
            ("toType".to_string(), serde_json::json!(to_type)),
            ("toId".to_string(), serde_json::json!(to_id)),
        ]);

        let schema = wiredash_db::schemas::relations_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn from_ids_async(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        let table = self.db.table_or_err("relations")?;
        let filter = format!(
            "fromType = {} AND fromId = {} AND toType = {} AND deleted = 0",
            escape_str(from_type),
            escape_str(from_id),
            escape_str(to_type),
        );
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let ids: Vec<String> = rows
            .iter()
            .filter_map(|r| r.get("toId").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        Ok(ids)
    }

    async fn to_ids_async(
        &self,
        from_type: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        let table = self.db.table_or_err("relations")?;
        let filter = format!(
            "fromType = {} AND toType = {} AND toId = {} AND deleted = 0",
            escape_str(from_type),
            escape_str(to_type),
            escape_str(to_id),
        );
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let ids: Vec<String> = rows
            .iter()
            .filter_map(|r| r.get("fromId").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        Ok(ids)
    }

    async fn unlink_async(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("relations")?;
        let id = Self::generate_id(from_type, from_id, to_type, to_id);
        let filter = format!("id = {}", escape_str(&id));
        table.delete(&filter).await?;
        Ok(())
    }

    async fn unlink_all_from_async(
        &self,
        from_type: &str,
        from_id: &str,
    ) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("relations")?;
        let filter = format!("fromType = {} AND fromId = {}", escape_str(from_type), escape_str(from_id));
        table.delete(&filter).await?;
        Ok(())
    }

    async fn unlink_all_to_async(
        &self,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("relations")?;
        let filter = format!("toType = {} AND toId = {}", escape_str(to_type), escape_str(to_id));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    /// Add a relation edge. Uses merge_insert with deterministic ID (no duplicates).
    pub fn add(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(from_type, from_id, to_type, to_id))
    }

    /// Get all target IDs from a source.
    pub fn from_ids(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        sync_run(self.from_ids_async(from_type, from_id, to_type))
    }

    /// Get all source IDs pointing to a target.
    pub fn to_ids(
        &self,
        from_type: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        sync_run(self.to_ids_async(from_type, to_type, to_id))
    }

    /// Remove a specific relation edge.
    pub fn unlink(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        sync_run(self.unlink_async(from_type, from_id, to_type, to_id))
    }

    /// Remove ALL relations from a given item.
    pub fn unlink_all_from(
        &self,
        from_type: &str,
        from_id: &str,
    ) -> Result<(), anyhow::Error> {
        sync_run(self.unlink_all_from_async(from_type, from_id))
    }

    /// Remove ALL relations pointing to a given item.
    pub fn unlink_all_to(
        &self,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        sync_run(self.unlink_all_to_async(to_type, to_id))
    }
}
