use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct NoteHistory<'a> {
    db: &'a Database,
}

fn history_from_row(row: &rusqlite::Row) -> rusqlite::Result<HistorySession> {
    Ok(HistorySession {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        note_id: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        session_content_id: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        local_only: row.get(8)?,
        locked: row.get(9)?,
    })
}

impl<'a> NoteHistory<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, hs: &HistorySession) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO notehistory (
                id, type, dateModified, dateCreated, synced, deleted,
                noteId, sessionContentId, localOnly, locked
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                hs.base.id,
                hs.base.item_type,
                hs.base.date_modified,
                hs.base.date_created,
                hs.base.synced,
                hs.base.deleted,
                hs.note_id,
                hs.session_content_id,
                hs.local_only,
                hs.locked,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<HistorySession>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    noteId, sessionContentId, localOnly, locked
             FROM notehistory WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], history_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<HistorySession>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    noteId, sessionContentId, localOnly, locked
             FROM notehistory WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], history_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    /// Get all history sessions for a given note.
    pub fn for_note(&self, note_id: &str) -> Result<Vec<HistorySession>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    noteId, sessionContentId, localOnly, locked
             FROM notehistory WHERE noteId = ?1 AND deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map(params![note_id], history_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM notehistory WHERE id = ?1", params![id])?;
        Ok(())
    }
}
