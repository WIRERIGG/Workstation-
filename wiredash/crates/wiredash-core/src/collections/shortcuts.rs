use std::collections::HashMap;

use arrow_array::RecordBatchIterator;
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use wiredash_db::{Database, batches_to_maps, maps_to_batch, escape_str, sync_run};

use crate::types::*;

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

fn base_from_map(map: &HashMap<String, serde_json::Value>) -> BaseItem {
    BaseItem {
        id: map.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        item_type: map.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        date_created: map.get("dateCreated").and_then(|v| v.as_i64()).unwrap_or(0),
        date_modified: map.get("dateModified").and_then(|v| v.as_i64()).unwrap_or(0),
        synced: map.get("synced").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        deleted: map.get("deleted").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
    }
}

fn base_to_map(base: &BaseItem) -> HashMap<String, serde_json::Value> {
    HashMap::from([
        ("id".to_string(), serde_json::json!(&base.id)),
        ("type".to_string(), serde_json::json!(&base.item_type)),
        ("dateModified".to_string(), serde_json::json!(base.date_modified)),
        ("dateCreated".to_string(), serde_json::json!(base.date_created)),
        ("synced".to_string(), serde_json::json!(base.synced)),
        ("deleted".to_string(), serde_json::json!(base.deleted)),
    ])
}

fn shortcut_from_map(map: &HashMap<String, serde_json::Value>) -> Shortcut {
    Shortcut {
        base: base_from_map(map),
        sort_index: map.get("sortIndex").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        item_id: map.get("itemId").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        item_type: map.get("itemType").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
    }
}

fn shortcut_to_map(sc: &Shortcut) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&sc.base);
    map.insert("sortIndex".to_string(), serde_json::json!(sc.sort_index as i64));
    map.insert("itemId".to_string(), serde_json::json!(&sc.item_id));
    map.insert("itemType".to_string(), serde_json::json!(&sc.item_type));
    map
}

// ---------------------------------------------------------------------------
// Shortcuts collection
// ---------------------------------------------------------------------------

pub struct Shortcuts<'a> {
    db: &'a Database,
}

impl<'a> Shortcuts<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, sc: &Shortcut) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("shortcuts")?;
        let row = shortcut_to_map(sc);
        let schema = wiredash_db::schemas::shortcuts_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<Shortcut>, anyhow::Error> {
        let table = self.db.table_or_err("shortcuts")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(shortcut_from_map))
    }

    async fn list_async(&self) -> Result<Vec<Shortcut>, anyhow::Error> {
        let table = self.db.table_or_err("shortcuts")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut items: Vec<Shortcut> = rows.iter().map(shortcut_from_map).collect();
        items.sort_by(|a, b| a.sort_index.cmp(&b.sort_index));
        Ok(items)
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("shortcuts")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, sc: &Shortcut) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(sc))
    }

    pub fn get(&self, id: &str) -> Result<Option<Shortcut>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self) -> Result<Vec<Shortcut>, anyhow::Error> {
        sync_run(self.list_async())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }
}
