use wiredash_core::collections::colors::Colors;
use wiredash_core::collections::content::Content;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::settings::Settings;
use wiredash_core::collections::tags::Tags;
use wiredash_core::collections::trash::Trash;
use wiredash_core::types::*;
use wiredash_db::Database;

fn test_db() -> Database {
    Database::open_memory().unwrap()
}

#[test]
fn test_tags_crud() {
    let db = test_db();
    let tags = Tags::new(&db);

    let tag = Tag::new("rust");
    tags.add(&tag).unwrap();

    // find_by_title returns Some
    let found = tags.find_by_title("rust").unwrap();
    assert!(found.is_some());
    let found = found.unwrap();
    assert_eq!(found.title, "rust");
    assert_eq!(found.base.id, tag.base.id);

    // remove + get returns None
    tags.remove(&tag.base.id).unwrap();
    let gone = tags.get(&tag.base.id).unwrap();
    assert!(gone.is_none());
}

#[test]
fn test_colors_crud() {
    let db = test_db();
    let colors = Colors::new(&db);

    let color = Color::new("Red", "#ff0000");
    colors.add(&color).unwrap();

    // find_by_code returns Some with correct title
    let found = colors.find_by_code("#ff0000").unwrap();
    assert!(found.is_some());
    let found = found.unwrap();
    assert_eq!(found.title, "Red");
    assert_eq!(found.color_code, "#ff0000");
}

#[test]
fn test_content_by_note_id() {
    let db = test_db();
    let content = Content::new(&db);

    let mut item = ContentItem::new();
    item.note_id = Some("n1".to_string());
    item.data = Some("<p>Hello</p>".to_string());
    content.add(&item).unwrap();

    // find_by_note_id returns Some with matching data
    let found = content.find_by_note_id("n1").unwrap();
    assert!(found.is_some());
    let found = found.unwrap();
    assert_eq!(found.data, Some("<p>Hello</p>".to_string()));
    assert_eq!(found.note_id, Some("n1".to_string()));
}

#[test]
fn test_settings_kv() {
    let db = test_db();
    let settings = Settings::new(&db);

    let value = serde_json::json!("Note $date$");
    settings.set("titleFormat", &value).unwrap();

    let fetched = settings.get_setting("titleFormat").unwrap();
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap(), serde_json::json!("Note $date$"));
}

#[test]
fn test_trash_cleanup() {
    let db = test_db();
    let notes = Notes::new(&db);
    let trash = Trash::new(&db);

    // Add a note
    let note = Note::new("Trash Me");
    notes.add(&note).unwrap();

    // Manually set deleted=1 and dateDeleted to 30 days ago
    let thirty_days_ago = chrono::Utc::now().timestamp_millis() - (30 * 24 * 60 * 60 * 1000);
    db.execute(
        "UPDATE notes SET deleted = 1, dateDeleted = ?1 WHERE id = ?2",
        rusqlite::params![thirty_days_ago, note.base.id],
    )
    .unwrap();

    // Verify note is trashed
    let fetched = notes.get(&note.base.id).unwrap();
    assert!(fetched.is_some());
    assert!(fetched.unwrap().base.deleted);

    // Clean notes older than 7 days
    let deleted_count = trash.clean_notes(7).unwrap();
    assert_eq!(deleted_count, 1);

    // Verify note is permanently gone
    let gone = notes.get(&note.base.id).unwrap();
    assert!(gone.is_none());
}
