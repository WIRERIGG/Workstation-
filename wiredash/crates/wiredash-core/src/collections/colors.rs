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

fn color_from_map(map: &HashMap<String, serde_json::Value>) -> Color {
    Color {
        base: base_from_map(map),
        title: map.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        color_code: map.get("colorCode").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
    }
}

fn color_to_map(color: &Color) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&color.base);
    map.insert("title".to_string(), serde_json::json!(&color.title));
    map.insert("colorCode".to_string(), serde_json::json!(&color.color_code));
    map
}

// ---------------------------------------------------------------------------
// Colors collection
// ---------------------------------------------------------------------------

pub struct Colors<'a> {
    db: &'a Database,
}

impl<'a> Colors<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, color: &Color) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("colors")?;
        let row = color_to_map(color);
        let schema = wiredash_db::schemas::colors_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<Color>, anyhow::Error> {
        let table = self.db.table_or_err("colors")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(color_from_map))
    }

    async fn list_async(&self) -> Result<Vec<Color>, anyhow::Error> {
        let table = self.db.table_or_err("colors")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut colors: Vec<Color> = rows.iter().map(color_from_map).collect();
        colors.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(colors)
    }

    async fn find_by_code_async(&self, code: &str) -> Result<Option<Color>, anyhow::Error> {
        let table = self.db.table_or_err("colors")?;
        let filter = format!("colorCode = {} AND deleted = 0", escape_str(code));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(color_from_map))
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("colors")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, color: &Color) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(color))
    }

    pub fn get(&self, id: &str) -> Result<Option<Color>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self) -> Result<Vec<Color>, anyhow::Error> {
        sync_run(self.list_async())
    }

    pub fn find_by_code(&self, code: &str) -> Result<Option<Color>, anyhow::Error> {
        sync_run(self.find_by_code_async(code))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }
}
