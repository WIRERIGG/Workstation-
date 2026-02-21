use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Shortcuts<'a> {
    db: &'a Database,
}

fn shortcut_from_row(row: &rusqlite::Row) -> rusqlite::Result<Shortcut> {
    Ok(Shortcut {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        sort_index: row.get(6)?,
        item_id: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        item_type: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
    })
}

impl<'a> Shortcuts<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, sc: &Shortcut) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO shortcuts (
                id, type, dateModified, dateCreated, synced, deleted,
                sortIndex, itemId, itemType
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                sc.base.id,
                sc.base.item_type,
                sc.base.date_modified,
                sc.base.date_created,
                sc.base.synced,
                sc.base.deleted,
                sc.sort_index,
                sc.item_id,
                sc.item_type,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Shortcut>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    sortIndex, itemId, itemType
             FROM shortcuts WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], shortcut_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Shortcut>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    sortIndex, itemId, itemType
             FROM shortcuts WHERE deleted = 0
             ORDER BY sortIndex ASC",
        )?;
        let rows = stmt.query_map([], shortcut_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM shortcuts WHERE id = ?1", params![id])?;
        Ok(())
    }
}
