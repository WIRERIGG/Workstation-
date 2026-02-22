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

fn notebook_from_map(map: &HashMap<String, serde_json::Value>) -> Notebook {
    Notebook {
        base: base_from_map(map),
        trash: TrashMeta {
            date_deleted: map.get("dateDeleted").and_then(|v| v.as_i64()),
            item_type: map.get("itemType").and_then(|v| v.as_str()).map(|s| s.to_string()),
            deleted_by: map.get("deletedBy").and_then(|v| v.as_str()).map(|s| s.to_string()),
        },
        title: map.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        description: map.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
        date_edited: map.get("dateEdited").and_then(|v| v.as_i64()).unwrap_or(0),
        pinned: map.get("pinned").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
    }
}

fn notebook_to_map(nb: &Notebook) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&nb.base);

    match nb.trash.date_deleted {
        Some(v) => { map.insert("dateDeleted".to_string(), serde_json::json!(v)); }
        None => { map.insert("dateDeleted".to_string(), serde_json::Value::Null); }
    }
    match &nb.trash.item_type {
        Some(s) => { map.insert("itemType".to_string(), serde_json::json!(s)); }
        None => { map.insert("itemType".to_string(), serde_json::Value::Null); }
    }
    match &nb.trash.deleted_by {
        Some(s) => { map.insert("deletedBy".to_string(), serde_json::json!(s)); }
        None => { map.insert("deletedBy".to_string(), serde_json::Value::Null); }
    }

    map.insert("title".to_string(), serde_json::json!(&nb.title));
    match &nb.description {
        Some(s) => { map.insert("description".to_string(), serde_json::json!(s)); }
        None => { map.insert("description".to_string(), serde_json::Value::Null); }
    }
    map.insert("dateEdited".to_string(), serde_json::json!(nb.date_edited));
    map.insert("pinned".to_string(), serde_json::json!(nb.pinned));

    map
}

// ---------------------------------------------------------------------------
// Notebooks collection
// ---------------------------------------------------------------------------

pub struct Notebooks<'a> {
    db: &'a Database,
}

impl<'a> Notebooks<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, nb: &Notebook) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notebooks")?;
        let row = notebook_to_map(nb);
        let schema = wiredash_db::schemas::notebooks_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<Notebook>, anyhow::Error> {
        let table = self.db.table_or_err("notebooks")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(notebook_from_map))
    }

    async fn list_async(&self) -> Result<Vec<Notebook>, anyhow::Error> {
        let table = self.db.table_or_err("notebooks")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut notebooks: Vec<Notebook> = rows.iter().map(notebook_from_map).collect();
        notebooks.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(notebooks)
    }

    async fn move_to_trash_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notebooks")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table.update()
            .column("deleted", "1")
            .column("type", "'trash'")
            .column("dateDeleted", &now.to_string())
            .column("itemType", "'notebook'")
            .column("deletedBy", "'user'")
            .column("synced", "0")
            .column("dateModified", &now.to_string())
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notebooks")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    async fn set_pinned_async(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notebooks")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table.update()
            .column("pinned", &(pinned as i32).to_string())
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn update_title_async(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notebooks")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table.update()
            .column("title", &escape_str(title))
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, nb: &Notebook) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(nb))
    }

    pub fn get(&self, id: &str) -> Result<Option<Notebook>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self) -> Result<Vec<Notebook>, anyhow::Error> {
        sync_run(self.list_async())
    }

    pub fn move_to_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.move_to_trash_async(id))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        sync_run(self.set_pinned_async(id, pinned))
    }

    pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        sync_run(self.update_title_async(id, title))
    }
}
