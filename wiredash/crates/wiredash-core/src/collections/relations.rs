use rusqlite::params;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use wiredash_db::Database;

pub struct Relations<'a> {
    db: &'a Database,
}

impl<'a> Relations<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Generate deterministic relation ID from (fromType, fromId, toType, toId).
    /// Hashes the composite key with DefaultHasher and formats as hex.
    fn generate_id(from_type: &str, from_id: &str, to_type: &str, to_id: &str) -> String {
        let composite = format!("{}:{}:{}:{}", from_type, from_id, to_type, to_id);
        let mut hasher = DefaultHasher::new();
        composite.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }

    /// Add a relation edge. Uses INSERT OR REPLACE with deterministic ID (no duplicates).
    pub fn add(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        let id = Self::generate_id(from_type, from_id, to_type, to_id);
        let now = chrono::Utc::now().timestamp_millis();

        self.db.execute(
            "INSERT OR REPLACE INTO relations (
                id, type, dateModified, dateCreated, synced, deleted,
                fromType, fromId, toType, toId
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                "relation",
                now,
                now,
                false, // synced = 0
                false, // deleted = 0
                from_type,
                from_id,
                to_type,
                to_id,
            ],
        )?;
        Ok(())
    }

    /// Get all target IDs from a source.
    /// E.g., from_ids("notebook", "nb1", "note") returns ["n1", "n2"]
    pub fn from_ids(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT toId FROM relations
             WHERE fromType = ?1 AND fromId = ?2 AND toType = ?3 AND deleted = 0",
        )?;
        let rows = stmt.query_map(params![from_type, from_id, to_type], |row| {
            row.get::<_, String>(0)
        })?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        Ok(ids)
    }

    /// Get all source IDs pointing to a target.
    /// E.g., to_ids("note", "tag", "t1") returns ["n1", "n2"]
    pub fn to_ids(
        &self,
        from_type: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<Vec<String>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT fromId FROM relations
             WHERE fromType = ?1 AND toType = ?2 AND toId = ?3 AND deleted = 0",
        )?;
        let rows = stmt.query_map(params![from_type, to_type, to_id], |row| {
            row.get::<_, String>(0)
        })?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        Ok(ids)
    }

    /// Remove a specific relation edge.
    pub fn unlink(
        &self,
        from_type: &str,
        from_id: &str,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        let id = Self::generate_id(from_type, from_id, to_type, to_id);
        self.db
            .execute("DELETE FROM relations WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Remove ALL relations from a given item.
    pub fn unlink_all_from(
        &self,
        from_type: &str,
        from_id: &str,
    ) -> Result<(), anyhow::Error> {
        self.db.execute(
            "DELETE FROM relations WHERE fromType = ?1 AND fromId = ?2",
            params![from_type, from_id],
        )?;
        Ok(())
    }

    /// Remove ALL relations pointing to a given item.
    pub fn unlink_all_to(
        &self,
        to_type: &str,
        to_id: &str,
    ) -> Result<(), anyhow::Error> {
        self.db.execute(
            "DELETE FROM relations WHERE toType = ?1 AND toId = ?2",
            params![to_type, to_id],
        )?;
        Ok(())
    }
}
