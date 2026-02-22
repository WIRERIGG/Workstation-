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

fn note_from_map(map: &HashMap<String, serde_json::Value>) -> Note {
    let expiry_date: Option<serde_json::Value> = map
        .get("expiryDate")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok());

    Note {
        base: base_from_map(map),
        trash: TrashMeta {
            date_deleted: map.get("dateDeleted").and_then(|v| v.as_i64()),
            item_type: map.get("itemType").and_then(|v| v.as_str()).map(|s| s.to_string()),
            deleted_by: map.get("deletedBy").and_then(|v| v.as_str()).map(|s| s.to_string()),
        },
        title: map.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        headline: map.get("headline").and_then(|v| v.as_str()).map(|s| s.to_string()),
        content_id: map.get("contentId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        pinned: map.get("pinned").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        favorite: map.get("favorite").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        local_only: map.get("localOnly").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        conflicted: map.get("conflicted").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        readonly: map.get("readonly").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        date_edited: map.get("dateEdited").and_then(|v| v.as_i64()).unwrap_or(0),
        is_generated_title: map.get("isGeneratedTitle").and_then(|v| v.as_i64()).map(|v| v != 0),
        archived: map.get("archived").and_then(|v| v.as_i64()).map(|v| v != 0),
        expiry_date,
    }
}

fn note_to_map(note: &Note) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&note.base);

    // Trash fields
    match note.trash.date_deleted {
        Some(v) => { map.insert("dateDeleted".to_string(), serde_json::json!(v)); }
        None => { map.insert("dateDeleted".to_string(), serde_json::Value::Null); }
    }
    match &note.trash.item_type {
        Some(s) => { map.insert("itemType".to_string(), serde_json::json!(s)); }
        None => { map.insert("itemType".to_string(), serde_json::Value::Null); }
    }
    match &note.trash.deleted_by {
        Some(s) => { map.insert("deletedBy".to_string(), serde_json::json!(s)); }
        None => { map.insert("deletedBy".to_string(), serde_json::Value::Null); }
    }

    // Note-specific fields
    map.insert("title".to_string(), serde_json::json!(&note.title));
    match &note.headline {
        Some(s) => { map.insert("headline".to_string(), serde_json::json!(s)); }
        None => { map.insert("headline".to_string(), serde_json::Value::Null); }
    }
    match &note.content_id {
        Some(s) => { map.insert("contentId".to_string(), serde_json::json!(s)); }
        None => { map.insert("contentId".to_string(), serde_json::Value::Null); }
    }
    map.insert("pinned".to_string(), serde_json::json!(note.pinned));
    map.insert("favorite".to_string(), serde_json::json!(note.favorite));
    map.insert("localOnly".to_string(), serde_json::json!(note.local_only));
    map.insert("conflicted".to_string(), serde_json::json!(note.conflicted));
    map.insert("readonly".to_string(), serde_json::json!(note.readonly));
    map.insert("dateEdited".to_string(), serde_json::json!(note.date_edited));
    match note.is_generated_title {
        Some(b) => { map.insert("isGeneratedTitle".to_string(), serde_json::json!(b)); }
        None => { map.insert("isGeneratedTitle".to_string(), serde_json::Value::Null); }
    }
    match note.archived {
        Some(b) => { map.insert("archived".to_string(), serde_json::json!(b)); }
        None => { map.insert("archived".to_string(), serde_json::Value::Null); }
    }
    match &note.expiry_date {
        Some(v) => {
            let s = serde_json::to_string(v).unwrap_or_default();
            map.insert("expiryDate".to_string(), serde_json::json!(s));
        }
        None => { map.insert("expiryDate".to_string(), serde_json::Value::Null); }
    }

    map
}

// ---------------------------------------------------------------------------
// Notes collection
// ---------------------------------------------------------------------------

pub struct Notes<'a> {
    db: &'a Database,
}

impl<'a> Notes<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    // -- async implementations ------------------------------------------------

    async fn add_async(&self, note: &Note) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let row = note_to_map(note);
        let schema = wiredash_db::schemas::notes_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());

        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None)
            .when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<Note>, anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(note_from_map))
    }

    async fn list_async(&self, limit: Option<u32>) -> Result<Vec<Note>, anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let filter = "deleted = 0 AND (type = 'note' OR type IS NULL)";
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut notes: Vec<Note> = rows.iter().map(note_from_map).collect();
        notes.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        if let Some(n) = limit {
            notes.truncate(n as usize);
        }
        Ok(notes)
    }

    async fn trashed_async(&self) -> Result<Vec<Note>, anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let filter = "deleted = 1 OR type = 'trash'";
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.iter().map(note_from_map).collect())
    }

    async fn update_title_async(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("title", &escape_str(title))
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn set_pinned_async(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("pinned", &(pinned as i32).to_string())
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn set_favorite_async(&self, id: &str, favorite: bool) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("favorite", &(favorite as i32).to_string())
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn set_archived_async(&self, id: &str, archived: bool) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("archived", &(archived as i32).to_string())
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn move_to_trash_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("deleted", "1")
            .column("type", "'trash'")
            .column("dateDeleted", &now.to_string())
            .column("itemType", "'note'")
            .column("deletedBy", "'user'")
            .column("synced", "0")
            .column("dateModified", &now.to_string())
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    async fn list_filtered_async(
        &self,
        favorites_only: bool,
        archived_only: bool,
        sort_by: SortBy,
        sort_dir: SortDirection,
        limit: Option<u32>,
    ) -> Result<Vec<Note>, anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let mut conditions = vec![
            "deleted = 0".to_string(),
            "(type = 'note' OR type IS NULL)".to_string(),
        ];
        if favorites_only {
            conditions.push("favorite = 1".to_string());
            conditions.push("(archived IS NULL OR archived = 0)".to_string());
        }
        if archived_only {
            conditions.push("archived = 1".to_string());
        }
        let filter = conditions.join(" AND ");
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut notes: Vec<Note> = rows.iter().map(note_from_map).collect();

        notes.sort_by(|a, b| {
            // pinned first
            let pin_cmp = b.pinned.cmp(&a.pinned);
            if pin_cmp != std::cmp::Ordering::Equal {
                return pin_cmp;
            }
            let ord = match sort_by {
                SortBy::DateModified => a.base.date_modified.cmp(&b.base.date_modified),
                SortBy::DateCreated => a.base.date_created.cmp(&b.base.date_created),
                SortBy::Title => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
            };
            match sort_dir {
                SortDirection::Asc => ord,
                SortDirection::Desc => ord.reverse(),
            }
        });

        if let Some(n) = limit {
            notes.truncate(n as usize);
        }
        Ok(notes)
    }

    async fn list_by_ids_async(&self, ids: &[String]) -> Result<Vec<Note>, anyhow::Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let table = self.db.table_or_err("notes")?;
        let or_clauses: Vec<String> = ids.iter().map(|id| format!("id = {}", escape_str(id))).collect();
        let filter = or_clauses.join(" OR ");
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut notes: Vec<Note> = rows.iter().map(note_from_map).collect();
        notes.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(notes)
    }

    async fn restore_from_trash_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("deleted", "0")
            .column("type", "'note'")
            .column("dateDeleted", "NULL")
            .column("itemType", "NULL")
            .column("deletedBy", "NULL")
            .column("synced", "0")
            .column("dateModified", &now.to_string())
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, note: &Note) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(note))
    }

    pub fn get(&self, id: &str) -> Result<Option<Note>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self, limit: Option<u32>) -> Result<Vec<Note>, anyhow::Error> {
        sync_run(self.list_async(limit))
    }

    pub fn trashed(&self) -> Result<Vec<Note>, anyhow::Error> {
        sync_run(self.trashed_async())
    }

    pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        sync_run(self.update_title_async(id, title))
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        sync_run(self.set_pinned_async(id, pinned))
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), anyhow::Error> {
        sync_run(self.set_favorite_async(id, favorite))
    }

    pub fn set_archived(&self, id: &str, archived: bool) -> Result<(), anyhow::Error> {
        sync_run(self.set_archived_async(id, archived))
    }

    pub fn move_to_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.move_to_trash_async(id))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }

    pub fn list_filtered(
        &self,
        favorites_only: bool,
        archived_only: bool,
        sort_by: SortBy,
        sort_dir: SortDirection,
        limit: Option<u32>,
    ) -> Result<Vec<Note>, anyhow::Error> {
        sync_run(self.list_filtered_async(favorites_only, archived_only, sort_by, sort_dir, limit))
    }

    pub fn list_by_ids(&self, ids: &[String]) -> Result<Vec<Note>, anyhow::Error> {
        sync_run(self.list_by_ids_async(ids))
    }

    pub fn restore_from_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.restore_from_trash_async(id))
    }
}
