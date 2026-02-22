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

fn task_from_map(map: &HashMap<String, serde_json::Value>) -> TaskItem {
    let labels: Option<Vec<String>> = map
        .get("labels")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok());

    TaskItem {
        base: base_from_map(map),
        title: map.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        description: map.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
        status: map.get("status").and_then(|v| v.as_str()).unwrap_or("open").to_string(),
        priority: map.get("priority").and_then(|v| v.as_str()).unwrap_or("medium").to_string(),
        assignee: map.get("assignee").and_then(|v| v.as_str()).map(|s| s.to_string()),
        due_date: map.get("dueDate").and_then(|v| v.as_i64()),
        labels,
        parent_id: map.get("parentId").and_then(|v| v.as_str()).map(|s| s.to_string()),
    }
}

fn task_to_map(task: &TaskItem) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&task.base);

    map.insert("title".to_string(), serde_json::json!(&task.title));
    match &task.description {
        Some(s) => { map.insert("description".to_string(), serde_json::json!(s)); }
        None => { map.insert("description".to_string(), serde_json::Value::Null); }
    }
    map.insert("status".to_string(), serde_json::json!(&task.status));
    map.insert("priority".to_string(), serde_json::json!(&task.priority));
    match &task.assignee {
        Some(s) => { map.insert("assignee".to_string(), serde_json::json!(s)); }
        None => { map.insert("assignee".to_string(), serde_json::Value::Null); }
    }
    match task.due_date {
        Some(v) => { map.insert("dueDate".to_string(), serde_json::json!(v)); }
        None => { map.insert("dueDate".to_string(), serde_json::Value::Null); }
    }
    match &task.labels {
        Some(v) => {
            let s = serde_json::to_string(v).unwrap_or_default();
            map.insert("labels".to_string(), serde_json::json!(s));
        }
        None => { map.insert("labels".to_string(), serde_json::Value::Null); }
    }
    match &task.parent_id {
        Some(s) => { map.insert("parentId".to_string(), serde_json::json!(s)); }
        None => { map.insert("parentId".to_string(), serde_json::Value::Null); }
    }

    map
}

// ---------------------------------------------------------------------------
// Tasks collection
// ---------------------------------------------------------------------------

pub struct Tasks<'a> {
    db: &'a Database,
}

impl<'a> Tasks<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    // -- async implementations ------------------------------------------------

    async fn add_async(&self, task: &TaskItem) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("tasks")?;
        let row = task_to_map(task);
        let schema = wiredash_db::schemas::tasks_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());

        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None)
            .when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<TaskItem>, anyhow::Error> {
        let table = self.db.table_or_err("tasks")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(task_from_map))
    }

    async fn list_async(&self, limit: Option<u32>) -> Result<Vec<TaskItem>, anyhow::Error> {
        let table = self.db.table_or_err("tasks")?;
        let filter = "deleted = 0";
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut tasks: Vec<TaskItem> = rows.iter().map(task_from_map).collect();
        tasks.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        if let Some(n) = limit {
            tasks.truncate(n as usize);
        }
        Ok(tasks)
    }

    async fn list_by_status_async(&self, status: &str) -> Result<Vec<TaskItem>, anyhow::Error> {
        let table = self.db.table_or_err("tasks")?;
        let filter = format!("deleted = 0 AND status = {}", escape_str(status));
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut tasks: Vec<TaskItem> = rows.iter().map(task_from_map).collect();
        tasks.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(tasks)
    }

    async fn update_status_async(&self, id: &str, status: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("tasks")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("status", &escape_str(status))
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn update_priority_async(&self, id: &str, priority: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("tasks")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("priority", &escape_str(priority))
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("tasks")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, task: &TaskItem) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(task))
    }

    pub fn get(&self, id: &str) -> Result<Option<TaskItem>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self, limit: Option<u32>) -> Result<Vec<TaskItem>, anyhow::Error> {
        sync_run(self.list_async(limit))
    }

    pub fn list_by_status(&self, status: &str) -> Result<Vec<TaskItem>, anyhow::Error> {
        sync_run(self.list_by_status_async(status))
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<(), anyhow::Error> {
        sync_run(self.update_status_async(id, status))
    }

    pub fn update_priority(&self, id: &str, priority: &str) -> Result<(), anyhow::Error> {
        sync_run(self.update_priority_async(id, priority))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }
}
