use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Colors<'a> {
    db: &'a Database,
}

fn color_from_row(row: &rusqlite::Row) -> rusqlite::Result<Color> {
    Ok(Color {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        title: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        color_code: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
    })
}

impl<'a> Colors<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, color: &Color) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO colors (
                id, type, dateModified, dateCreated, synced, deleted, title, colorCode
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                color.base.id,
                color.base.item_type,
                color.base.date_modified,
                color.base.date_created,
                color.base.synced,
                color.base.deleted,
                color.title,
                color.color_code,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Color>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title, colorCode
             FROM colors WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], color_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Color>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title, colorCode
             FROM colors WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], color_from_row)?;
        let mut colors = Vec::new();
        for row in rows {
            colors.push(row?);
        }
        Ok(colors)
    }

    pub fn find_by_code(&self, code: &str) -> Result<Option<Color>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title, colorCode
             FROM colors WHERE colorCode = ?1 AND deleted = 0",
        )?;
        let mut rows = stmt.query_map(params![code], color_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM colors WHERE id = ?1", params![id])?;
        Ok(())
    }
}
