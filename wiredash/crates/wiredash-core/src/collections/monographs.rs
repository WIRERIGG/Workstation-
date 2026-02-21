use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Monographs<'a> {
    db: &'a Database,
}

fn monograph_from_row(row: &rusqlite::Row) -> rusqlite::Result<Monograph> {
    Ok(Monograph {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        date_published: row.get(6)?,
        title: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        self_destruct: row.get(8)?,
        password: row.get(9)?,
    })
}

impl<'a> Monographs<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, mg: &Monograph) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO monographs (
                id, type, dateModified, dateCreated, synced, deleted,
                datePublished, title, selfDestruct, password
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                mg.base.id,
                mg.base.item_type,
                mg.base.date_modified,
                mg.base.date_created,
                mg.base.synced,
                mg.base.deleted,
                mg.date_published,
                mg.title,
                mg.self_destruct,
                mg.password,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Monograph>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    datePublished, title, selfDestruct, password
             FROM monographs WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], monograph_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Monograph>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    datePublished, title, selfDestruct, password
             FROM monographs WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], monograph_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM monographs WHERE id = ?1", params![id])?;
        Ok(())
    }
}
