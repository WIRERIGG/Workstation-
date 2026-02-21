use crate::types::*;
use rusqlite::params;
use wiredash_db::Database;

pub struct Reminders<'a> {
    db: &'a Database,
}

fn reminder_from_row(row: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    let days_str: Option<String> = row.get(12)?;
    let selected_days: Option<Vec<i32>> = days_str
        .and_then(|s| serde_json::from_str(&s).ok());

    Ok(Reminder {
        base: BaseItem {
            id: row.get(0)?,
            item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            date_created: row.get(3)?,
            date_modified: row.get(2)?,
            synced: row.get(4)?,
            deleted: row.get(5)?,
        },
        title: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        description: row.get(7)?,
        priority: row.get::<_, Option<String>>(8)?.unwrap_or("silent".to_string()),
        date: row.get(9)?,
        mode: row.get::<_, Option<String>>(10)?.unwrap_or("once".to_string()),
        recurring_mode: row.get(11)?,
        selected_days,
        local_only: row.get(13)?,
        disabled: row.get(14)?,
        snooze_until: row.get(15)?,
    })
}

impl<'a> Reminders<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn add(&self, rem: &Reminder) -> Result<(), anyhow::Error> {
        let days_json: Option<String> = rem
            .selected_days
            .as_ref()
            .map(|v| serde_json::to_string(v))
            .transpose()?;

        self.db.execute(
            "INSERT OR REPLACE INTO reminders (
                id, type, dateModified, dateCreated, synced, deleted,
                title, description, priority, date, mode,
                recurringMode, selectedDays, localOnly, disabled, snoozeUntil
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15, ?16
            )",
            params![
                rem.base.id,
                rem.base.item_type,
                rem.base.date_modified,
                rem.base.date_created,
                rem.base.synced,
                rem.base.deleted,
                rem.title,
                rem.description,
                rem.priority,
                rem.date,
                rem.mode,
                rem.recurring_mode,
                days_json,
                rem.local_only,
                rem.disabled,
                rem.snooze_until,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Reminder>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    title, description, priority, date, mode,
                    recurringMode, selectedDays, localOnly, disabled, snoozeUntil
             FROM reminders WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], reminder_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Reminder>, anyhow::Error> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, type, dateModified, dateCreated, synced, deleted,
                    title, description, priority, date, mode,
                    recurringMode, selectedDays, localOnly, disabled, snoozeUntil
             FROM reminders WHERE deleted = 0
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map([], reminder_from_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        self.db.execute("DELETE FROM reminders WHERE id = ?1", params![id])?;
        Ok(())
    }
}
