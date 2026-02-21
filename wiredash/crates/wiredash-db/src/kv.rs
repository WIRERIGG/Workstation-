use rusqlite::params;
use crate::Database;

pub struct KvStore<'a> {
    db: &'a Database,
}

impl<'a> KvStore<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Read a JSON value from the KV table.
    pub fn read(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT value FROM kv WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, Option<String>>(0))?;
        match rows.next() {
            Some(row) => {
                let val_str = row?;
                match val_str {
                    Some(s) => Ok(serde_json::from_str(&s).ok()),
                    None => Ok(None),
                }
            }
            None => Ok(None),
        }
    }

    /// Read and deserialize a KV value into a concrete type.
    pub fn read_as<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>, anyhow::Error> {
        match self.read(key)? {
            Some(v) => Ok(Some(serde_json::from_value(v)?)),
            None => Ok(None),
        }
    }

    /// Write a JSON value to the KV table (INSERT OR REPLACE).
    pub fn write(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        let val_json = serde_json::to_string(value)?;
        self.db.execute(
            "INSERT OR REPLACE INTO kv (key, value, dateModified) VALUES (?1, ?2, ?3)",
            params![key, val_json, now],
        )?;
        Ok(())
    }

    /// Delete a KV entry.
    pub fn delete(&self, key: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM kv WHERE key = ?1", params![key])?;
        Ok(())
    }
}
