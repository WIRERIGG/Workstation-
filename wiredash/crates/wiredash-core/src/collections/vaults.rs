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

fn vault_from_map(map: &HashMap<String, serde_json::Value>) -> Vault {
    Vault {
        base: base_from_map(map),
        title: map.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        key: map.get("key").and_then(|v| v.as_str()).map(|s| s.to_string()),
    }
}

fn vault_to_map(vault: &Vault) -> HashMap<String, serde_json::Value> {
    let mut map = base_to_map(&vault.base);
    map.insert("title".to_string(), serde_json::json!(&vault.title));
    match &vault.key {
        Some(s) => { map.insert("key".to_string(), serde_json::json!(s)); }
        None => { map.insert("key".to_string(), serde_json::Value::Null); }
    }
    map
}

// ---------------------------------------------------------------------------
// Vaults collection
// ---------------------------------------------------------------------------

pub struct Vaults<'a> {
    db: &'a Database,
}

impl<'a> Vaults<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    async fn add_async(&self, vault: &Vault) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("vaults")?;
        let row = vault_to_map(vault);
        let schema = wiredash_db::schemas::vaults_schema();
        let batch = maps_to_batch(&schema, &[row])?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
        let mut op = table.merge_insert(&["id"]);
        op.when_matched_update_all(None).when_not_matched_insert_all();
        op.execute(Box::new(reader)).await?;
        Ok(())
    }

    async fn get_async(&self, id: &str) -> Result<Option<Vault>, anyhow::Error> {
        let table = self.db.table_or_err("vaults")?;
        let filter = format!("id = {}", escape_str(id));
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if(&filter).execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(vault_from_map))
    }

    async fn list_async(&self) -> Result<Vec<Vault>, anyhow::Error> {
        let table = self.db.table_or_err("vaults")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        let mut items: Vec<Vault> = rows.iter().map(vault_from_map).collect();
        items.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(items)
    }

    async fn default_async(&self) -> Result<Option<Vault>, anyhow::Error> {
        let table = self.db.table_or_err("vaults")?;
        let batches: Vec<arrow_array::RecordBatch> = table.query().only_if("deleted = 0").execute().await?.try_collect().await?;
        let rows = batches_to_maps(&batches);
        Ok(rows.first().map(vault_from_map))
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("vaults")?;
        let filter = format!("id = {}", escape_str(id));
        table.delete(&filter).await?;
        Ok(())
    }

    async fn update_key_async(&self, id: &str, key: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("vaults")?;
        let now = chrono::Utc::now().timestamp_millis();
        let filter = format!("id = {}", escape_str(id));
        table.update()
            .column("key", &escape_str(key))
            .column("dateModified", &now.to_string())
            .column("synced", "0")
            .only_if(&filter)
            .execute()
            .await?;
        Ok(())
    }

    // -- sync wrappers --------------------------------------------------------

    pub fn add(&self, vault: &Vault) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(vault))
    }

    pub fn get(&self, id: &str) -> Result<Option<Vault>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    pub fn list(&self) -> Result<Vec<Vault>, anyhow::Error> {
        sync_run(self.list_async())
    }

    /// Return the first non-deleted vault (the "default" vault).
    pub fn default(&self) -> Result<Option<Vault>, anyhow::Error> {
        sync_run(self.default_async())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }

    /// Update the encryption key on an existing vault.
    pub fn update_key(&self, id: &str, key: &str) -> Result<(), anyhow::Error> {
        sync_run(self.update_key_async(id, key))
    }
}
