use wiredash_core::collections::reminders::Reminders;
use wiredash_core::types::Reminder;
use wiredash_db::Database;

#[test]
fn test_update_reminder() {
    let db = Database::open_memory().unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Original Title", now);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    rem.title = "Updated Title".to_string();
    rem.priority = "loud".to_string();
    rem.mode = "recurring".to_string();
    rem.recurring_mode = Some("daily".to_string());
    rem.disabled = Some(false);
    reminders.update(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.title, "Updated Title");
    assert_eq!(loaded.priority, "loud");
    assert_eq!(loaded.mode, "recurring");
    assert_eq!(loaded.recurring_mode, Some("daily".to_string()));
}

#[test]
fn test_update_reminder_snooze() {
    let db = Database::open_memory().unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Snooze Test", now);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    let snooze_time = now + 30 * 60 * 1000;
    rem.snooze_until = Some(snooze_time);
    reminders.update(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.snooze_until, Some(snooze_time));
}

#[test]
fn test_update_reminder_selected_days() {
    let db = Database::open_memory().unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Weekly Standup", now);
    rem.mode = "recurring".to_string();
    rem.recurring_mode = Some("weekly".to_string());
    rem.selected_days = Some(vec![1, 3, 5]);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.selected_days, Some(vec![1, 3, 5]));
}
