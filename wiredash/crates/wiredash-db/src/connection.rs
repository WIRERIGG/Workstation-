use rusqlite::Connection;

pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open (or create) a database file. If password is Some, uses SQLCipher encryption.
    pub fn open(path: &str, password: Option<&str>) -> Result<Self, anyhow::Error> {
        let conn = Connection::open(path)?;
        if let Some(pw) = password {
            conn.pragma_update(None, "key", pw)?;
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self { conn };
        crate::schema::create_all_tables(&db)?;
        Ok(db)
    }

    /// In-memory database for testing.
    pub fn open_memory() -> Result<Self, anyhow::Error> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        crate::schema::create_all_tables(&db)?;
        Ok(db)
    }

    pub fn execute(&self, sql: &str, params: impl rusqlite::Params) -> Result<usize, anyhow::Error> {
        Ok(self.conn.execute(sql, params)?)
    }

    pub fn query_one<T: rusqlite::types::FromSql>(&self, sql: &str) -> Result<T, anyhow::Error> {
        Ok(self.conn.query_row(sql, [], |row| row.get(0))?)
    }

    pub fn query_column<T: rusqlite::types::FromSql>(&self, sql: &str) -> Result<Vec<T>, anyhow::Error> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Query all unsynced (synced=0, deleted=0) rows from a table as JSON strings.
    /// Returns Vec<(id, json_string)>.
    pub fn query_unsynced(&self, table: &str) -> Result<Vec<(String, String)>, anyhow::Error> {
        // Get column names from pragma
        let mut cols_stmt = self.conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let col_names: Vec<String> = cols_stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        let cols_csv = col_names.join(", ");
        let sql = format!(
            "SELECT {} FROM {} WHERE synced = 0 AND deleted = 0 ORDER BY id",
            cols_csv, table
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let col_names_clone = col_names.clone();
        let rows = stmt.query_map([], move |row| {
            let mut map = serde_json::Map::new();
            for (i, col) in col_names_clone.iter().enumerate() {
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                    rusqlite::types::Value::Real(f) => serde_json::json!(f),
                    rusqlite::types::Value::Text(s) => {
                        serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))
                    }
                    rusqlite::types::Value::Blob(b) => {
                        use base64::Engine as _;
                        serde_json::Value::String(
                            base64::engine::general_purpose::STANDARD.encode(&b),
                        )
                    }
                };
                map.insert(col.clone(), json_val);
            }
            let id = map
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Ok((id, serde_json::Value::Object(map).to_string()))
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}
