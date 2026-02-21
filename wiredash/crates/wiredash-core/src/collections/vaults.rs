use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Vaults<'a> {
    db: &'a Database,
}

fn vault_from_row(row: &rusqlite::Row) -> rusqlite::Result<Vault> {
    Ok(Vault {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        title: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        key: row.get(7)?,
    })
}

impl<'a> Vaults<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, vault: &Vault) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO vaults (
                id, type, dateModified, dateCreated, synced, deleted, title, key
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                vault.base.id,
                vault.base.item_type,
                vault.base.date_modified,
                vault.base.date_created,
                vault.base.synced,
                vault.base.deleted,
                vault.title,
                vault.key,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Vault>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title, key
             FROM vaults WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], vault_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Vault>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title, key
             FROM vaults WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], vault_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    /// Return the first non-deleted vault (the "default" vault).
    pub fn default(&self) -> Result<Option<Vault>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted, title, key
             FROM vaults WHERE deleted = 0 LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], vault_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM vaults WHERE id = ?1", params![id])?;
        Ok(())
    }
}
