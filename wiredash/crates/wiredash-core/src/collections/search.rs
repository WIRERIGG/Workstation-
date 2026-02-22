use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use wiredash_db::{Database, batches_to_maps, sync_run};

// ---------------------------------------------------------------------------
// Search collection — in-memory string matching (LanceDB FTS can be added later)
// ---------------------------------------------------------------------------

pub struct Search<'a> {
    db: &'a Database,
}

impl<'a> Search<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    // -- async implementations ------------------------------------------------

    async fn search_notes_async(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if("deleted = 0")
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let query_lower = query.to_lowercase();
        let mut ids = Vec::new();
        for row in &rows {
            if let Some(title) = row.get("title").and_then(|v| v.as_str()) {
                if title.to_lowercase().contains(&query_lower) {
                    if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
                        ids.push(id.to_string());
                    }
                }
            }
        }
        Ok(ids)
    }

    async fn search_content_async(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        let table = self.db.table_or_err("content")?;
        let batches: Vec<arrow_array::RecordBatch> = table
            .query()
            .only_if("deleted = 0")
            .execute()
            .await?
            .try_collect()
            .await?;
        let rows = batches_to_maps(&batches);
        let query_lower = query.to_lowercase();
        let mut ids = Vec::new();
        for row in &rows {
            if let Some(data) = row.get("data").and_then(|v| v.as_str()) {
                if data.to_lowercase().contains(&query_lower) {
                    if let Some(note_id) = row.get("noteId").and_then(|v| v.as_str()) {
                        ids.push(note_id.to_string());
                    }
                }
            }
        }
        Ok(ids)
    }

    // -- sync wrappers --------------------------------------------------------

    /// Index a note's title for FTS search. No-op for LanceDB (data goes in via Notes::add).
    pub fn index_note(&self, _id: &str, _title: &str) -> Result<(), anyhow::Error> {
        Ok(())
    }

    /// Index content for FTS search. No-op for LanceDB (data goes in via Content::add).
    pub fn index_content(&self, _id: &str, _note_id: &str, _data: &str) -> Result<(), anyhow::Error> {
        Ok(())
    }

    /// Search notes by title. Returns matching note IDs.
    pub fn search_notes(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        sync_run(self.search_notes_async(query))
    }

    /// Search content body. Returns matching note IDs.
    pub fn search_content(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        sync_run(self.search_content_async(query))
    }

    /// Remove a note from the FTS index. No-op for LanceDB.
    pub fn remove_note(&self, _id: &str) -> Result<(), anyhow::Error> {
        Ok(())
    }

    /// Remove content from the FTS index. No-op for LanceDB.
    pub fn remove_content(&self, _id: &str) -> Result<(), anyhow::Error> {
        Ok(())
    }
}
