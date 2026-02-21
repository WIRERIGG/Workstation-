use wiredash_db::Database;

pub struct Search<'a> {
    db: &'a Database,
}

impl<'a> Search<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Index a note's title for FTS search.
    ///
    /// The FTS5 tables use `content='notes'` (external content), so column
    /// values are read from the `notes` table on retrieval. This method
    /// ensures the note row exists in `notes` (INSERT OR IGNORE) and then
    /// populates the FTS inverted index.
    pub fn index_note(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        // Ensure a row exists in the backing content table so FTS5 can
        // read column values back on SELECT.
        self.db.execute(
            "INSERT OR IGNORE INTO notes (id, title) VALUES (?1, ?2)",
            rusqlite::params![id, title],
        )?;
        // Update title in case the row already existed with a different title.
        self.db.execute(
            "UPDATE notes SET title = ?1 WHERE id = ?2",
            rusqlite::params![title, id],
        )?;
        // Rebuild the FTS index from the notes table to keep it in sync.
        self.db.conn().execute_batch(
            "INSERT INTO notes_fts (notes_fts) VALUES ('rebuild')",
        )?;
        Ok(())
    }

    /// Index content for FTS search.
    ///
    /// The FTS5 tables use `content='content'` (external content), so column
    /// values are read from the `content` table on retrieval. This method
    /// ensures the content row exists and then rebuilds the FTS index.
    pub fn index_content(&self, id: &str, note_id: &str, data: &str) -> Result<(), anyhow::Error> {
        // Ensure a row exists in the backing content table.
        self.db.execute(
            "INSERT OR IGNORE INTO content (id, noteId, data) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, note_id, data],
        )?;
        // Update data in case the row already existed.
        self.db.execute(
            "UPDATE content SET noteId = ?1, data = ?2 WHERE id = ?3",
            rusqlite::params![note_id, data, id],
        )?;
        // Rebuild the FTS index from the content table.
        self.db.conn().execute_batch(
            "INSERT INTO content_fts (content_fts) VALUES ('rebuild')",
        )?;
        Ok(())
    }

    /// Search notes by title. Returns matching note IDs.
    pub fn search_notes(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let mut stmt = self.db.conn().prepare(
            "SELECT id FROM notes_fts WHERE notes_fts MATCH ?1 ORDER BY rank",
        )?;
        let rows = stmt.query_map(rusqlite::params![fts_query], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Search content body. Returns matching note IDs.
    pub fn search_content(&self, query: &str) -> Result<Vec<String>, anyhow::Error> {
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let mut stmt = self.db.conn().prepare(
            "SELECT noteId FROM content_fts WHERE content_fts MATCH ?1 ORDER BY rank",
        )?;
        let rows = stmt.query_map(rusqlite::params![fts_query], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Remove a note from the FTS index.
    pub fn remove_note(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "DELETE FROM notes WHERE id = ?1",
            rusqlite::params![id],
        )?;
        self.db.conn().execute_batch(
            "INSERT INTO notes_fts (notes_fts) VALUES ('rebuild')",
        )?;
        Ok(())
    }

    /// Remove content from the FTS index.
    pub fn remove_content(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute(
            "DELETE FROM content WHERE id = ?1",
            rusqlite::params![id],
        )?;
        self.db.conn().execute_batch(
            "INSERT INTO content_fts (content_fts) VALUES ('rebuild')",
        )?;
        Ok(())
    }
}
