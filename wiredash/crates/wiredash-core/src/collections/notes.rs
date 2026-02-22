use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Notes<'a> {
    db: &'a Database,
}

fn note_from_row(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let expiry_str: Option<String> = row.get(20)?;
    let expiry_date: Option<serde_json::Value> = expiry_str
        .and_then(|s| serde_json::from_str(&s).ok());

    Ok(Note {
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
        headline: row.get(10)?,
        content_id: row.get(11)?,
        pinned: row.get(12)?,
        favorite: row.get(13)?,
        local_only: row.get(14)?,
        conflicted: row.get(15)?,
        readonly: row.get(16)?,
        date_edited: row.get(17)?,
        is_generated_title: row.get(18)?,
        archived: row.get(19)?,
        expiry_date,
    })
}

impl<'a> Notes<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, note: &Note) -> Result<(), anyhow::Error> {
        let expiry_json: Option<String> = note
            .expiry_date
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        self.db.execute(
            "INSERT OR REPLACE INTO notes (
                id, type, dateModified, dateCreated, synced, deleted,
                dateDeleted, itemType, deletedBy,
                title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                dateEdited, isGeneratedTitle, archived, expiryDate
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                ?18, ?19, ?20, ?21
            )",
            params![
                note.base.id,
                note.base.item_type,
                note.base.date_modified,
                note.base.date_created,
                note.base.synced,
                note.base.deleted,
                note.trash.date_deleted,
                note.trash.item_type,
                note.trash.deleted_by,
                note.title,
                note.headline,
                note.content_id,
                note.pinned,
                note.favorite,
                note.local_only,
                note.conflicted,
                note.readonly,
                note.date_edited,
                note.is_generated_title,
                note.archived,
                expiry_json,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Note>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                    dateEdited, isGeneratedTitle, archived, expiryDate
             FROM notes WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map(params![id], note_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self, limit: Option<u32>) -> Result<Vec<Note>, anyhow::Error> {
        let conn = self.db.conn();
        let sql = match limit {
            Some(n) => format!(
                "SELECT id, type, dateModified, dateCreated, synced, deleted,
                        dateDeleted, itemType, deletedBy,
                        title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                        dateEdited, isGeneratedTitle, archived, expiryDate
                 FROM notes
                 WHERE deleted = 0 AND (type = 'note' OR type IS NULL)
                 ORDER BY dateModified DESC
                 LIMIT {}",
                n
            ),
            None => String::from(
                "SELECT id, type, dateModified, dateCreated, synced, deleted,
                        dateDeleted, itemType, deletedBy,
                        title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                        dateEdited, isGeneratedTitle, archived, expiryDate
                 FROM notes
                 WHERE deleted = 0 AND (type = 'note' OR type IS NULL)
                 ORDER BY dateModified DESC",
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], note_from_row)?;
        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }
        Ok(notes)
    }

    pub fn trashed(&self) -> Result<Vec<Note>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                    dateEdited, isGeneratedTitle, archived, expiryDate
             FROM notes
             WHERE deleted = 1 OR type = 'trash'",
        )?;
        let rows = stmt.query_map([], note_from_row)?;
        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }
        Ok(notes)
    }

    pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET title = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            params![title, now, id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET pinned = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            params![pinned, now, id],
        )?;
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET favorite = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            params![favorite, now, id],
        )?;
        Ok(())
    }

    pub fn set_archived(&self, id: &str, archived: bool) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET archived = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
            params![archived, now, id],
        )?;
        Ok(())
    }

    pub fn move_to_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET deleted = 1, type = 'trash', dateDeleted = ?1, itemType = 'note', deletedBy = 'user', synced = 0, dateModified = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// List notes matching filter criteria with sorting.
    /// Pinned notes always sort first.
    pub fn list_filtered(
        &self,
        favorites_only: bool,
        archived_only: bool,
        sort_by: SortBy,
        sort_dir: SortDirection,
        limit: Option<u32>,
    ) -> Result<Vec<Note>, anyhow::Error> {
        let mut conditions = vec!["deleted = 0", "(type = 'note' OR type IS NULL)"];
        if favorites_only {
            conditions.push("favorite = 1");
            // Exclude archived notes from favorites (matching Notesnook behavior)
            conditions.push("(archived IS NULL OR archived = 0)");
        }
        if archived_only {
            conditions.push("archived = 1");
        }
        let where_clause = conditions.join(" AND ");
        let limit_clause = limit.map(|n| format!("LIMIT {}", n)).unwrap_or_default();

        let sql = format!(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                    dateEdited, isGeneratedTitle, archived, expiryDate
             FROM notes
             WHERE {}
             ORDER BY pinned DESC, {} {}
             {}",
            where_clause,
            sort_by.column(),
            sort_dir.sql(),
            limit_clause,
        );

        let conn = self.db.conn();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], note_from_row)?;
        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }
        Ok(notes)
    }

    /// Load notes by a set of IDs. Order is by dateModified DESC.
    pub fn list_by_ids(&self, ids: &[String]) -> Result<Vec<Note>, anyhow::Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    dateDeleted, itemType, deletedBy,
                    title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                    dateEdited, isGeneratedTitle, archived, expiryDate
             FROM notes
             WHERE id IN ({})
             ORDER BY dateModified DESC",
            placeholders.join(", ")
        );

        let conn = self.db.conn();
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
        let rows = stmt.query_map(params.as_slice(), note_from_row)?;
        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }
        Ok(notes)
    }

    /// Restore a note from trash back to active.
    pub fn restore_from_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db.execute(
            "UPDATE notes SET deleted = 0, type = 'note', dateDeleted = NULL, itemType = NULL, deletedBy = NULL, synced = 0, dateModified = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }
}
