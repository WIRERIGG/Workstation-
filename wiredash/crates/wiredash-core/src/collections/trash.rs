use wiredash_db::{Database, sync_run};

// ---------------------------------------------------------------------------
// Trash collection — permanent deletion of trashed items
// ---------------------------------------------------------------------------

pub struct Trash<'a> {
    db: &'a Database,
}

impl<'a> Trash<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    // -- async implementations ------------------------------------------------

    async fn clean_notes_async(&self, days: i64) -> Result<usize, anyhow::Error> {
        let cutoff = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);
        let filter = format!("deleted = 1 AND dateDeleted < {}", cutoff);
        let count = self.db.count_rows("notes", Some(&filter)).await?;
        if count > 0 {
            let table = self.db.table_or_err("notes")?;
            table.delete(&filter).await?;
        }
        Ok(count)
    }

    async fn clean_notebooks_async(&self, days: i64) -> Result<usize, anyhow::Error> {
        let cutoff = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);
        let filter = format!("deleted = 1 AND dateDeleted < {}", cutoff);
        let count = self.db.count_rows("notebooks", Some(&filter)).await?;
        if count > 0 {
            let table = self.db.table_or_err("notebooks")?;
            table.delete(&filter).await?;
        }
        Ok(count)
    }

    // -- sync wrappers --------------------------------------------------------

    /// Delete trashed notes older than `days` days. Returns count deleted.
    pub fn clean_notes(&self, days: i64) -> Result<usize, anyhow::Error> {
        sync_run(self.clean_notes_async(days))
    }

    /// Delete trashed notebooks older than `days` days. Returns count deleted.
    pub fn clean_notebooks(&self, days: i64) -> Result<usize, anyhow::Error> {
        sync_run(self.clean_notebooks_async(days))
    }
}
