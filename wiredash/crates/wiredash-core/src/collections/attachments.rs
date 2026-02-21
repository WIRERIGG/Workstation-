use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Attachments<'a> {
    db: &'a Database,
}

fn attachment_from_row(row: &rusqlite::Row) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        iv: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        salt: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        size: row.get(8)?,
        alg: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        key: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
        chunk_size: row.get(11)?,
        hash: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        hash_type: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
        mime_type: row.get::<_, Option<String>>(14)?.unwrap_or_default(),
        filename: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
        date_deleted: row.get(16)?,
        date_uploaded: row.get(17)?,
        failed: row.get(18)?,
    })
}

impl<'a> Attachments<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, att: &Attachment) -> Result<(), anyhow::Error> {
        self.db.execute(
            "INSERT OR REPLACE INTO attachments (
                id, type, dateModified, dateCreated, synced, deleted,
                iv, salt, size, alg, key, chunkSize,
                hash, hashType, mimeType, filename,
                dateDeleted, dateUploaded, failed
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16,
                ?17, ?18, ?19
            )",
            params![
                att.base.id,
                att.base.item_type,
                att.base.date_modified,
                att.base.date_created,
                att.base.synced,
                att.base.deleted,
                att.iv,
                att.salt,
                att.size,
                att.alg,
                att.key,
                att.chunk_size,
                att.hash,
                att.hash_type,
                att.mime_type,
                att.filename,
                att.date_deleted,
                att.date_uploaded,
                att.failed,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Attachment>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    iv, salt, size, alg, key, chunkSize,
                    hash, hashType, mimeType, filename,
                    dateDeleted, dateUploaded, failed
             FROM attachments WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], attachment_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Attachment>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    iv, salt, size, alg, key, chunkSize,
                    hash, hashType, mimeType, filename,
                    dateDeleted, dateUploaded, failed
             FROM attachments WHERE deleted = 0
             ORDER BY dateModified DESC",
        )?;
        let rows = stmt.query_map([], attachment_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn find_by_hash(&self, hash: &str) -> Result<Option<Attachment>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    iv, salt, size, alg, key, chunkSize,
                    hash, hashType, mimeType, filename,
                    dateDeleted, dateUploaded, failed
             FROM attachments WHERE hash = ?1 AND deleted = 0",
        )?;
        let mut rows = stmt.query_map(params![hash], attachment_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
        Ok(())
    }
}
