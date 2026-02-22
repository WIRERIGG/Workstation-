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

fn agent_from_map(map: &HashMap<String, serde_json::Value>) -> Agent {
    let capabilities: Option<Vec<String>> = map
        .get("capabilities")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok());

    Agent {
        base: base_from_map(map),
        name: map.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        role: map.get("role").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        status: map.get("status").and_then(|v| v.as_str()).unwrap_or("idle").to_string(),
        model: map.get("model").and_then(|v| v.as_str()).map(|s| s.to_string()),
        system_prompt: map.get("systemPrompt").and_then(|v| v.as_str()).map(|s| s.to_string()),
        capabilities,
        last_active: map.get("lastActive").and_then(|v| v.as_i64()),
    }
}

fn agent_to_map(agent: &Agent) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&agent.base);

    map.insert("name".to_string(), serde_json::json!(&agent.name));
    map.insert("role".to_string(), serde_json::json!(&agent.role));
    map.insert("status".to_string(), serde_json::json!(&agent.status));
    match &agent.model {
        Some(s) => { map.insert("model".to_string(), serde_json::json!(s)); }
        None => { map.insert("model".to_string(), serde_json::Value::Null); }
    }
    match &agent.system_prompt {
        Some(s) => { map.insert("systemPrompt".to_string(), serde_json::json!(s)); }
        None => { map.insert("systemPrompt".to_string(), serde_json::Value::Null); }
    }
    match &agent.capabilities {
        Some(v) => {
            let s = serde_json::to_string(v).unwrap_or_default();
            map.insert("capabilities".to_string(), serde_json::json!(s));
        }
        None => { map.insert("capabilities".to_string(), serde_json::Value::Null); }
    }
    match agent.last_active {
        Some(v) => { map.insert("lastActive".to_string(), serde_json::json!(v)); }
        None => { map.insert("lastActive".to_string(), serde_json::Value::Null); }
    }

    map
}

// ---------------------------------------------------------------------------
// Agents collection
// ---------------------------------------------------------------------------

pub struct Agents<'a> {
    db: &'a Database,
}

impl<'a> Agents<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, agent: &Agent) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("agents")?;
        let row = agent_to_map(agent);
        let schema = wiredash_db::schemas::agents_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());

        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None)
            .when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<Agent>, anyhow::Error> {
        let table = self.db.table_or_err("agents")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(&filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(agent_from_map))
    }

    async fn list_async(&self, limit: Option<u32>) -> Result<Vec<Agent>, anyhow::Error> {
        let table = self.db.table_or_err("agents")?;
        let filter = "deleted = 0";
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(filter)
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let mut agents: Vec<Agent> = rows.iter().map(agent_from_map).collect();
        agents.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        if let Some(n) = limit {
            agents.truncate(n as usize);
        }
        Ok(agents)
    }

    async fn update_status_async(&self, id: &str, status: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("agents")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table
            .update()
            .column("status", &escape_str(status))
            .column("lastActive", &now.to_string())
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("agents")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, agent: &Agent) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(agent))
    }

    pub fn get(&self, id: &str) -> Result<Option<Agent>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self, limit: Option<u32>) -> Result<Vec<Agent>, anyhow::Error> {
        sync_run(self.list_async(limit))
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<(), anyhow::Error> {
        sync_run(self.update_status_async(id, status))
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }
}
