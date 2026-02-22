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

fn reminder_from_map(map: &HashMap<String, serde_json::Value>) -> Reminder {
    let selected_days: Option<Vec<i32>> = map
        .get("selectedDays")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok());

    Reminder {
        base: base_from_map(map),
        title: map.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        description: map.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
        priority: map.get("priority").and_then(|v| v.as_str()).unwrap_or("silent").to_string(),
        date: map.get("date").and_then(|v| v.as_i64()).unwrap_or(0),
        mode: map.get("mode").and_then(|v| v.as_str()).unwrap_or("once").to_string(),
        recurring_mode: map.get("recurringMode").and_then(|v| v.as_str()).map(|s| s.to_string()),
        selected_days,
        local_only: map.get("localOnly").and_then(|v| v.as_i64()).map(|v| v != 0),
        disabled: map.get("disabled").and_then(|v| v.as_i64()).map(|v| v != 0),
        snooze_until: map.get("snoozeUntil").and_then(|v| v.as_i64()),
    }
}

fn reminder_to_map(rem: &Reminder) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&rem.base);
    map.insert("title".to_string(), serde_json::json!(&rem.title));
    match &rem.description {
        Some(s) => { map.insert("description".to_string(), serde_json::json!(s)); }
        None => { map.insert("description".to_string(), serde_json::Value::Null); }
    }
    map.insert("priority".to_string(), serde_json::json!(&rem.priority));
    map.insert("date".to_string(), serde_json::json!(rem.date));
    map.insert("mode".to_string(), serde_json::json!(&rem.mode));
    match &rem.recurring_mode {
        Some(s) => { map.insert("recurringMode".to_string(), serde_json::json!(s)); }
        None => { map.insert("recurringMode".to_string(), serde_json::Value::Null); }
    }
    match &rem.selected_days {
        Some(days) => {
            let s = serde_json::to_string(days).unwrap_or_default();
            map.insert("selectedDays".to_string(), serde_json::json!(s));
        }
        None => { map.insert("selectedDays".to_string(), serde_json::Value::Null); }
    }
    match rem.local_only {
        Some(b) => { map.insert("localOnly".to_string(), serde_json::json!(b)); }
        None => { map.insert("localOnly".to_string(), serde_json::Value::Null); }
    }
    match rem.disabled {
        Some(b) => { map.insert("disabled".to_string(), serde_json::json!(b)); }
        None => { map.insert("disabled".to_string(), serde_json::Value::Null); }
    }
    match rem.snooze_until {
        Some(v) => { map.insert("snoozeUntil".to_string(), serde_json::json!(v)); }
        None => { map.insert("snoozeUntil".to_string(), serde_json::Value::Null); }
    }
    map
}

// ---------------------------------------------------------------------------
// Reminders collection
// ---------------------------------------------------------------------------

pub struct Reminders<'a> {
    db: &'a Database,
}

impl<'a> Reminders<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, rem: &Reminder) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("reminders")?;
        let row = reminder_to_map(rem);
        let schema = wiredash_db::schemas::reminders_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<Reminder>, anyhow::Error> {
        let table = self.db.table_or_err("reminders")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(reminder_from_map))
    }

    async fn list_async(&self) -> Result<Vec<Reminder>, anyhow::Error> {
        let table = self.db.table_or_err("reminders")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut items: Vec<Reminder> = rows.iter().map(reminder_from_map).collect();
        items.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(items)
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("reminders")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    async fn update_async(&self, rem: &Reminder) -> Result<(), anyhow::Error> {
        // Re-add with the same id (merge_insert will upsert)
        let now = chrono::Utc::now().timestamp_millis();
        let mut row = reminder_to_map(rem);
        row.insert("dateModified".to_string(), serde_json::json!(now));
        row.insert("synced".to_string(), serde_json::json!(false));

        let table = self.db.table_or_err("reminders")?;
        let schema = wiredash_db::schemas::reminders_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, rem: &Reminder) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(rem))
    }

    pub fn get(&self, id: &str) -> Result<Option<Reminder>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self) -> Result<Vec<Reminder>, anyhow::Error> {
        sync_run(self.list_async())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }

    /// Update an existing reminder's fields.
    pub fn update(&self, rem: &Reminder) -> Result<(), anyhow::Error> {
        sync_run(self.update_async(rem))
    }
}
