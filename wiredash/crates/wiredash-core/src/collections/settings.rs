use rusqlite::params;
use wiredash_db::Database;

pub struct Settings<'a> {
    db: &'a Database,
}

impl<'a> Settings<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT value FROM settings WHERE key = ?1 AND deleted = 0",
        )?;
        let mut rows = stmt.query_map(params![key], |row| {
            row.get::<_, Option<String>>(0)
        })?;
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

    /// Set a key-value setting. Uses INSERT OR REPLACE with a deterministic id
    /// derived from the key.
    pub fn set(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        let id = format!("setting_{}", key);
        let val_json = serde_json::to_string(value)?;

        self.db.execute(
            "INSERT OR REPLACE INTO settings (
                id, type, dateModified, dateCreated, synced, deleted, key, value
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                "settingitem",
                now,
                now,
                false,
                false,
                key,
                val_json,
            ],
        )?;
        Ok(())
    }

    /// Remove a setting by key.
    pub fn remove(&self, key: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}
