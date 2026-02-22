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

fn content_from_map(map: &HashMap<String, serde_json::Value>) -> ContentItem {
    ContentItem {
        base: base_from_map(map),
        note_id: map.get("noteId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        data: map.get("data").and_then(|v| v.as_str()).map(|s| s.to_string()),
        locked: map.get("locked").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        local_only: map.get("localOnly").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        conflicted: map.get("conflicted").and_then(|v| v.as_str()).map(|s| s.to_string()),
        session_id: map.get("sessionId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        date_edited: map.get("dateEdited").and_then(|v| v.as_i64()).unwrap_or(0),
        date_resolved: map.get("dateResolved").and_then(|v| v.as_i64()),
    }
}

fn content_to_map(item: &ContentItem) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&item.base);

    match &item.note_id {
        Some(s) => { map.insert("noteId".to_string(), serde_json::json!(s)); }
        None => { map.insert("noteId".to_string(), serde_json::Value::Null); }
    }
    match &item.data {
        Some(s) => { map.insert("data".to_string(), serde_json::json!(s)); }
        None => { map.insert("data".to_string(), serde_json::Value::Null); }
    }
    map.insert("locked".to_string(), serde_json::json!(item.locked));
    map.insert("localOnly".to_string(), serde_json::json!(item.local_only));
    match &item.conflicted {
        Some(s) => { map.insert("conflicted".to_string(), serde_json::json!(s)); }
        None => { map.insert("conflicted".to_string(), serde_json::Value::Null); }
    }
    match &item.session_id {
        Some(s) => { map.insert("sessionId".to_string(), serde_json::json!(s)); }
        None => { map.insert("sessionId".to_string(), serde_json::Value::Null); }
    }
    map.insert("dateEdited".to_string(), serde_json::json!(item.date_edited));
    match item.date_resolved {
        Some(v) => { map.insert("dateResolved".to_string(), serde_json::json!(v)); }
        None => { map.insert("dateResolved".to_string(), serde_json::Value::Null); }
    }

    map
}

// ---------------------------------------------------------------------------
// Content collection
// ---------------------------------------------------------------------------

pub struct Content<'a> {
    db: &'a Database,
}

impl<'a> Content<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, item: &ContentItem) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let row = content_to_map(item);
        let schema = wiredash_db::schemas::content_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<ContentItem>, anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(content_from_map))
    }

    async fn list_async(&self) -> Result<Vec<ContentItem>, anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut items: Vec<ContentItem> = rows.iter().map(content_from_map).collect();
        items.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(items)
    }

    async fn find_by_note_id_async(&self, note_id: &str) -> Result<Option<ContentItem>, anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let filter = format!("noteId = {} AND deleted = 0", escape_str(note_id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(content_from_map))
    }

    async fn update_data_async(&self, id: &str, data: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table.update()
            .column("data", &escape_str(data))
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    async fn set_locked_async(&self, id: &str, locked: bool) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table.update()
            .column("locked", &(locked as i32).to_string())
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn list_locked_async(&self) -> Result<Vec<ContentItem>, anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("locked = 1 AND deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.iter().map(content_from_map).collect())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, item: &ContentItem) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(item))
    }

    pub fn get(&self, id: &str) -> Result<Option<ContentItem>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self) -> Result<Vec<ContentItem>, anyhow::Error> {
        sync_run(self.list_async())
    }

    pub fn find_by_note_id(&self, note_id: &str) -> Result<Option<ContentItem>, anyhow::Error> {
        sync_run(self.find_by_note_id_async(note_id))
    }

    pub fn update_data(&self, id: &str, data: &str) -> Result<(), anyhow::Error> {
        sync_run(self.update_data_async(id, data))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }

    pub fn set_locked(&self, id: &str, locked: bool) -> Result<(), anyhow::Error> {
        sync_run(self.set_locked_async(id, locked))
    }

    pub fn list_locked(&self) -> Result<Vec<ContentItem>, anyhow::Error> {
        sync_run(self.list_locked_async())
    }
}
