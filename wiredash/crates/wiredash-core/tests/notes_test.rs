use wiredash_core::collections::notes::Notes;
use wiredash_core::types::*;
use wiredash_db::Database;

fn test_db() -> Database {
    Database::open_memory().unwrap()
}

fn make_note(title: &str) -> Note {
    Note {
        base: BaseItem::new("note"),
        trash: TrashMeta::default(),
        title: title.into(),
        headline: None,
        content_id: None,
        pinned: false,
        favorite: false,
        local_only: false,
        conflicted: false,
        readonly: false,
        date_edited: chrono::Utc::now().timestamp_millis(),
        is_generated_title: Some(false),
        archived: Some(false),
        expiry_date: None,
    }
}

#[test]
fn test_add_and_get_note() {
    let db = test_db();
    let notes = Notes::new(&db);

    let note = make_note("My First Note");
    notes.add(&note).unwrap();

    let fetched = notes.get(&note.base.id).unwrap();
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.title, "My First Note");
    assert_eq!(fetched.base.id, note.base.id);
}

#[test]
fn test_list_notes() {
    let db = test_db();
    let notes = Notes::new(&db);

    notes.add(&make_note("Note A")).unwrap();
    notes.add(&make_note("Note B")).unwrap();
    notes.add(&make_note("Note C")).unwrap();

    let all = notes.list(None).unwrap();
    assert_eq!(all.len(), 3);
}

#[test]
fn test_update_note() {
    let db = test_db();
    let notes = Notes::new(&db);

    let note = make_note("Original Title");
    notes.add(&note).unwrap();

    notes.update_title(&note.base.id, "Updated Title").unwrap();

    let fetched = notes.get(&note.base.id).unwrap().unwrap();
    assert_eq!(fetched.title, "Updated Title");
}

#[test]
fn test_soft_delete_note() {
    let db = test_db();
    let notes = Notes::new(&db);

    let note = make_note("To Be Trashed");
    notes.add(&note).unwrap();

    notes.move_to_trash(&note.base.id).unwrap();

    let active = notes.list(None).unwrap();
    assert_eq!(active.len(), 0);

    let trashed = notes.trashed().unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].title, "To Be Trashed");
}

#[test]
fn test_pin_favorite_archive() {
    let db = test_db();
    let notes = Notes::new(&db);

    let note = make_note("Flagged Note");
    notes.add(&note).unwrap();

    notes.set_pinned(&note.base.id, true).unwrap();
    notes.set_favorite(&note.base.id, true).unwrap();
    notes.set_archived(&note.base.id, true).unwrap();

    let fetched = notes.get(&note.base.id).unwrap().unwrap();
    assert!(fetched.pinned);
    assert!(fetched.favorite);
    assert_eq!(fetched.archived, Some(true));
}

#[test]
fn test_hard_delete() {
    let db = test_db();
    let notes = Notes::new(&db);

    let note = make_note("To Be Deleted");
    notes.add(&note).unwrap();

    notes.remove(&note.base.id).unwrap();

    let fetched = notes.get(&note.base.id).unwrap();
    assert!(fetched.is_none());
}
