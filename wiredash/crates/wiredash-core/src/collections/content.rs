use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Content<'a> {
    db: &'a Database,
}

fn content_from_row(row: &rusqlite::Row) -> rusqlite::Result<ContentItem> {
    Ok(ContentItem {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        note_id: row.get(6)?,
        data: row.get(7)?,
        locked: row.get(8)?,
        local_only: row.get(9)?,
        conflicted: row.get(10)?,
        session_id: row.get(11)?,
        date_edited: row.get(12)?,
        date_resolved: row.get(13)?,
    })
}

impl<'a> Content<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, item: &ContentItem) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO content (
                id, type, dateModified, dateCreated, synced, deleted,
                noteId, data, locked, localOnly, conflicted, sessionId,
                dateEdited, dateResolved
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                item.base.id,
                item.base.item_type,
                item.base.date_modified,
                item.base.date_created,
                item.base.synced,
                item.base.deleted,
                item.note_id,
                item.data,
                item.locked,
                item.local_only,
                item.conflicted,
                item.session_id,
                item.date_edited,
                item.date_resolved,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<ContentItem>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    noteId, data, locked, localOnly, conflicted, sessionId,
                    dateEdited, dateResolved
             FROM content WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], content_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<ContentItem>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    noteId, data, locked, localOnly, conflicted, sessionId,
                    dateEdited, dateResolved
             FROM content WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], content_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn find_by_note_id(&self, note_id: &str) -> Result<Option<ContentItem>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    noteId, data, locked, localOnly, conflicted, sessionId,
                    dateEdited, dateResolved
             FROM content WHERE noteId = ?1 AND deleted = 0",
        )?;
        let mut rows = stmt.query_map(params![note_id], content_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn update_data(&self, id: &str, data: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE content SET data = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            params![data, now, id],
        )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM content WHERE id = ?1", params![id])?;
        Ok(())
    }
}
