use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Notebooks<'a> {
    db: &'a Database,
}

fn nb_from_row(row: &rusqlite::Row) -> rusqlite::Result<Notebook> {
    Ok(Notebook {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        trash: TrashMeta {
            date_deleted: row.get(6)?,
            item_type: row.get(7)?,
            deleted_by: row.get(8)?,
        },
        title: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        description: row.get(10)?,
        date_edited: row.get(11)?,
        pinned: row.get(12)?,
    })
}

impl<'a> Notebooks<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, nb: &Notebook) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO notebooks (
                id, type, dateModified, dateCreated, synced, deleted,
                dateDeleted, itemType, deletedBy,
                title, description, dateEdited, pinned
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9,
                ?10, ?11, ?12, ?13
            )",
            params![
                nb.base.id,
                nb.base.item_type,
                nb.base.date_modified,
                nb.base.date_created,
                nb.base.synced,
                nb.base.deleted,
                nb.trash.date_deleted,
                nb.trash.item_type,
                nb.trash.deleted_by,
                nb.title,
                nb.description,
                nb.date_edited,
                nb.pinned,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Notebook>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, description, dateEdited, pinned
             FROM notebooks WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map(params![id], nb_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Notebook>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, description, dateEdited, pinned
             FROM notebooks
             WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], nb_from_row)?;
        let mut notebooks = Vec::new();
        for row in rows {
            notebooks.push(row?);
        }
        Ok(notebooks)
    }

    pub fn move_to_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notebooks SET deleted = 1, type = 'trash', dateDeleted = ?1, itemType = 'notebook', deletedBy = 'user', synced = 0, dateModified = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM notebooks WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notebooks SET pinned = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            params![pinned, now, id],
        )?;
        Ok(())
    }
}
