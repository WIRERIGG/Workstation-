use std::collections::HashMap;

use arrow_array::RecordBatchIterator;
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use wiredash_db::{Database, batches_to_maps, maps_to_batch, escape_str, sync_run};

use crate::types::*;

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

fn event_from_map(map: &HashMap<String, serde_json::Value>) -> CalendarEvent {
    let recurrence: Option<serde_json::Value> = map
        .get("recurrence")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok());

    CalendarEvent {
        base: base_from_map(map),
        title: map.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        description: map.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
        start_date: map.get("startDate").and_then(|v| v.as_i64()).unwrap_or(0),
        end_date: map.get("endDate").and_then(|v| v.as_i64()).unwrap_or(0),
        all_day: map.get("allDay").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
        color: map.get("color").and_then(|v| v.as_str()).map(|s| s.to_string()),
        recurrence,
        source: map.get("source").and_then(|v| v.as_str()).map(|s| s.to_string()),
    }
}

fn event_to_map(event: &CalendarEvent) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&event.base);

    map.insert("title".to_string(), serde_json::json!(&event.title));
    match &event.description {
        Some(s) => { map.insert("description".to_string(), serde_json::json!(s)); }
        None => { map.insert("description".to_string(), serde_json::Value::Null); }
    }
    map.insert("startDate".to_string(), serde_json::json!(event.start_date));
    map.insert("endDate".to_string(), serde_json::json!(event.end_date));
    map.insert("allDay".to_string(), serde_json::json!(event.all_day));
    match &event.color {
        Some(s) => { map.insert("color".to_string(), serde_json::json!(s)); }
        None => { map.insert("color".to_string(), serde_json::Value::Null); }
    }
    match &event.recurrence {
        Some(v) => {
            let s = serde_json::to_string(v).unwrap_or_default();
            map.insert("recurrence".to_string(), serde_json::json!(s));
        }
        None => { map.insert("recurrence".to_string(), serde_json::Value::Null); }
    }
    match &event.source {
        Some(s) => { map.insert("source".to_string(), serde_json::json!(s)); }
        None => { map.insert("source".to_string(), serde_json::Value::Null); }
    }

    map
}

// ---------------------------------------------------------------------------
// CalendarEvents collection
// ---------------------------------------------------------------------------

pub struct CalendarEvents<'a> {
    db: &'a Database,
}

impl<'a> CalendarEvents<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, event: &CalendarEvent) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("calendar_events")?;
        let row = event_to_map(event);
        let schema = wiredash_db::schemas::calendar_events_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());

        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None)
            .when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<CalendarEvent>, anyhow::Error> {
        let table = self.db.table_or_err("calendar_events")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(event_from_map))
    }

    async fn list_async(&self, limit: Option<u32>) -> Result<Vec<CalendarEvent>, anyhow::Error> {
        let table = self.db.table_or_err("calendar_events")?;
        let filter = "deleted = 0";
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut events: Vec<CalendarEvent> = rows.iter().map(event_from_map).collect();
        events.sort_by(|a, b| a.start_date.cmp(&b.start_date));
        if let Some(n) = limit {
            events.truncate(n as usize);
        }
        Ok(events)
    }

    async fn list_in_range_async(&self, start: Timestamp, end: Timestamp) -> Result<Vec<CalendarEvent>, anyhow::Error> {
        let table = self.db.table_or_err("calendar_events")?;
        let filter = format!("deleted = 0 AND startDate < {} AND endDate > {}", end, start);
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut events: Vec<CalendarEvent> = rows.iter().map(event_from_map).collect();
        events.sort_by(|a, b| a.start_date.cmp(&b.start_date));
        Ok(events)
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("calendar_events")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, event: &CalendarEvent) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(event))
    }

    pub fn get(&self, id: &str) -> Result<Option<CalendarEvent>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self, limit: Option<u32>) -> Result<Vec<CalendarEvent>, anyhow::Error> {
        sync_run(self.list_async(limit))
    }

    pub fn list_in_range(&self, start: Timestamp, end: Timestamp) -> Result<Vec<CalendarEvent>, anyhow::Error> {
        sync_run(self.list_in_range_async(start, end))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }
}
