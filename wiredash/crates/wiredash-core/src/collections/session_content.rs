use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct SessionContent<'a> {
    db: &'a Database,
}

fn sc_from_row(row: &rusqlite::Row) -> rusqlite::Result<SessionContentItem> {
    Ok(SessionContentItem {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        data: row.get(6)?,
        content_type: row.get(7)?,
        locked: row.get(8)?,
        compressed: row.get(9)?,
        local_only: row.get(10)?,
        title: row.get(11)?,
    })
}

impl<'a> SessionContent<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, sc: &SessionContentItem) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO sessioncontent (
                id, type, dateModified, dateCreated, synced, deleted,
                data, contentType, locked, compressed, localOnly, title
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                sc.base.id,
                sc.base.item_type,
                sc.base.date_modified,
                sc.base.date_created,
                sc.base.synced,
                sc.base.deleted,
                sc.data,
                sc.content_type,
                sc.locked,
                sc.compressed,
                sc.local_only,
                sc.title,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<SessionContentItem>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    data, contentType, locked, compressed, localOnly, title
             FROM sessioncontent WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], sc_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<SessionContentItem>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    data, contentType, locked, compressed, localOnly, title
             FROM sessioncontent WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], sc_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM sessioncontent WHERE id = ?1", params![id])?;
        Ok(())
    }
}
