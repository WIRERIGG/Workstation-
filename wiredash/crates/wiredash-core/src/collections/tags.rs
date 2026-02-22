use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Tags<'a> {
    db: &'a Database,
}

fn tag_from_row(row: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        title: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
    })
}

impl<'a> Tags<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, tag: &Tag) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO tags (
                id, type, dateModified, dateCreated, synced, deleted, title
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                tag.base.id,
                tag.base.item_type,
                tag.base.date_modified,
                tag.base.date_created,
                tag.base.synced,
                tag.base.deleted,
                tag.title,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Tag>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title
             FROM tags WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], tag_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Tag>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title
             FROM tags WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], tag_from_row)?;
        let mut tags = Vec::new();
        for row in rows {
            tags.push(row?);
        }
        Ok(tags)
    }

    pub fn find_by_title(&self, title: &str) -> Result<Option<Tag>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title
             FROM tags WHERE title = ?1 AND deleted = 0",
        )?;
        let mut rows = stmt.query_map(params![title], tag_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE tags SET title = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            params![title, now, id],
        )?;
        Ok(())
    }
}
