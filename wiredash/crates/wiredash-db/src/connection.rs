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
}
