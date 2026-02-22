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

fn history_from_map(map: &HashMap<String, serde_json::Value>) -> HistorySession {
    HistorySession {
        base: base_from_map(map),
        note_id: map.get("noteId").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        session_content_id: map.get("sessionContentId").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        local_only: map.get("localOnly").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        locked: map.get("locked").and_then(|v| v.as_i64()).map(|v| v != 0),
    }
}

fn history_to_map(hs: &HistorySession) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&hs.base);
    map.insert("noteId".to_string(), serde_json::json!(&hs.note_id));
    map.insert("sessionContentId".to_string(), serde_json::json!(&hs.session_content_id));
    map.insert("localOnly".to_string(), serde_json::json!(hs.local_only));
    match hs.locked {
        Some(b) => { map.insert("locked".to_string(), serde_json::json!(b)); }
        None => { map.insert("locked".to_string(), serde_json::Value::Null); }
    }
    map
}

// ---------------------------------------------------------------------------
// NoteHistory collection
// ---------------------------------------------------------------------------

pub struct NoteHistory<'a> {
    db: &'a Database,
}

impl<'a> NoteHistory<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, hs: &HistorySession) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notehistory")?;
        let row = history_to_map(hs);
        let schema = wiredash_db::schemas::notehistory_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<HistorySession>, anyhow::Error> {
        let table = self.db.table_or_err("notehistory")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(history_from_map))
    }

    async fn list_async(&self) -> Result<Vec<HistorySession>, anyhow::Error> {
        let table = self.db.table_or_err("notehistory")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut items: Vec<HistorySession> = rows.iter().map(history_from_map).collect();
        items.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(items)
    }

    async fn for_note_async(&self, note_id: &str) -> Result<Vec<HistorySession>, anyhow::Error> {
        let table = self.db.table_or_err("notehistory")?;
        let filter = format!("noteId = {} AND deleted = 0", escape_str(note_id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut items: Vec<HistorySession> = rows.iter().map(history_from_map).collect();
        items.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(items)
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notehistory")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, hs: &HistorySession) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(hs))
    }

    pub fn get(&self, id: &str) -> Result<Option<HistorySession>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self) -> Result<Vec<HistorySession>, anyhow::Error> {
        sync_run(self.list_async())
    }

    /// Get all history sessions for a given note.
    pub fn for_note(&self, note_id: &str) -> Result<Vec<HistorySession>, anyhow::Error> {
        sync_run(self.for_note_async(note_id))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }
}
