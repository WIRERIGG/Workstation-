use rusqlite::params;
use wiredash_db::Database;

pub struct Trash<'a> {
    db: &'a Database,
}

impl<'a> Trash<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Delete trashed notes older than `days` days. Returns count deleted.
    pub fn clean_notes(&self, days: i64) -> Result<usize, anyhow::Error> {
        let cutoff = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);
        let count = self.db.execute(
            "DELETE FROM notes WHERE deleted = 1 AND dateDeleted < ?1",
            params![cutoff],
        )?;
        Ok(count)
    }

    /// Delete trashed notebooks older than `days` days. Returns count deleted.
    pub fn clean_notebooks(&self, days: i64) -> Result<usize, anyhow::Error> {
        let cutoff = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);
        let count = self.db.execute(
            "DELETE FROM notebooks WHERE deleted = 1 AND dateDeleted < ?1",
            params![cutoff],
        )?;
        Ok(count)
    }
}
