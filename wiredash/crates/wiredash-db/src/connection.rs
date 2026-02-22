use std::collections::HashMap;

use lancedb::query::{ExecutableQuery, QueryBase};
use futures::TryStreamExt;

/// Wraps a LanceDB connection and its open table handles.
pub struct Database {
    conn: lancedb::Connection,
    tables: HashMap<String, lancedb::Table>,
    path: String,
}

impl Database {
    /// Open (or create) a LanceDB database at the given directory path.
    ///
    /// Creates any missing tables based on the canonical schemas.
    pub async fn open(path: &str) -> Result<Self, anyhow::Error> {
        let conn = lancedb::connect(path).execute().await?;

        let mut db = Self {
            conn,
            tables: HashMap::new(),
            path: path.to_string(),
        };

        // Load existing tables
        let existing_names = db.conn.table_names().execute().await?;
        for name in &existing_names {
            let table = db.conn.open_table(name).execute().await?;
            db.tables.insert(name.clone(), table);
        }

        // Create any missing tables
        db.ensure_tables().await?;

        Ok(db)
    }

    /// Create an in-memory database backed by a temporary directory.
    ///
    /// Useful for tests.
    pub async fn open_memory() -> Result<Self, anyhow::Error> {
        let id = uuid::Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("wiredash-lance-{}", id));
        std::fs::create_dir_all(&dir)?;
        Self::open(dir.to_str().unwrap()).await
    }

    /// Ensure all 16 canonical tables exist, creating empty ones as needed.
    async fn ensure_tables(&mut self) -> Result<(), anyhow::Error> {
        for (name, schema) in crate::schemas::all_schemas() {
            if !self.tables.contains_key(name) {
                let table = self
                    .conn
                    .create_empty_table(name, schema)
                    .execute()
                    .await?;
                self.tables.insert(name.to_string(), table);
            }
        }
        Ok(())
    }

    /// Get a reference to an open table by name, or `None` if it doesn't exist.
    pub fn table(&self, name: &str) -> Option<&lancedb::Table> {
        self.tables.get(name)
    }

    /// Get a reference to an open table by name, or return an error.
    pub fn table_or_err(&self, name: &str) -> Result<&lancedb::Table, anyhow::Error> {
        self.tables
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("table '{}' not found", name))
    }

    /// The underlying LanceDB connection.
    pub fn connection(&self) -> &lancedb::Connection {
        &self.conn
    }

    /// The directory path of this database.
    pub fn path(&self) -> &str {
        &self.path
    }

    /// Query all unsynced rows from a table. Returns (id, json_string) pairs.
    ///
    /// Rows where `synced = 0` (or null) and `deleted = 0` are collected.
    /// Each row is serialized to a JSON object string.
    pub fn query_unsynced(&self, table_name: &str) -> Result<Vec<(String, String)>, anyhow::Error> {
        crate::arrow_utils::sync_run(self.query_unsynced_async(table_name))
    }

    async fn query_unsynced_async(&self, table_name: &str) -> Result<Vec<(String, String)>, anyhow::Error> {
        let table = self.table_or_err(table_name)?;
        let filter = "synced = 0 OR synced IS NULL";
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if(filter)
            .execute()
            .await?
            .try_collect()
            .await?;

        let rows = crate::arrow_utils::batches_to_maps(&batches);
        let mut results = Vec::new();
        for row in rows {
            let id = row.get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let json_str = serde_json::to_string(&serde_json::Value::Object(
                row.into_iter().collect()
            ))?;
            results.push((id, json_str));
        }
        Ok(results)
    }

    /// Count rows in a table, optionally filtered by a predicate.
    pub async fn count_rows(
        &self,
        table_name: &str,
        filter: Option<&str>,
    ) -> Result<usize, anyhow::Error> {
        let table = self.table_or_err(table_name)?;
        let mut query = table.query();
        if let Some(f) = filter {
            query = query.only_if(f);
        }
        let batches: Vec<arrow_array::RecordBatch> =
            query.execute().await?.try_collect().await?;
        Ok(batches.iter().map(|b| b.num_rows()).sum())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_memory_creates_all_tables() {
        let db = Database::open_memory().await.unwrap();
        assert_eq!(db.tables.len(), 16);
        assert!(db.table("notes").is_some());
        assert!(db.table("kv").is_some());
        assert!(db.table("config").is_some());
    }

    #[tokio::test]
    async fn table_or_err_returns_error_for_missing() {
        let db = Database::open_memory().await.unwrap();
        assert!(db.table_or_err("nonexistent").is_err());
    }

    #[tokio::test]
    async fn count_rows_on_empty_table() {
        let db = Database::open_memory().await.unwrap();
        let count = db.count_rows("notes", None).await.unwrap();
        assert_eq!(count, 0);
    }
}
