//! Integration tests: note + content CRUD roundtrip via the database layer.

use wiredash_core::collections::content::Content;
use wiredash_core::collections::notes::Notes;
use wiredash_core::types::{ContentItem, Note};
use wiredash_db::Database;

// ---------------------------------------------------------------------------
// 1. Create note + content, list, find by note_id, update, verify
// ---------------------------------------------------------------------------

#[test]
fn test_create_and_load_note_with_content() {
    let db = Database::open_memory().expect("Failed to open in-memory database");

    // --- Create a note ---
    let note = Note::new("Test Note");
    let note_id = note.base.id.clone();

    let notes = Notes::new(&db);
    notes.add(&note).expect("Failed to add note");

    // --- List notes and verify it appears ---
    let all_notes = notes.list(None).expect("Failed to list notes");
    assert_eq!(all_notes.len(), 1, "Should have exactly one note");
    assert_eq!(all_notes[0].title, "Test Note");
    assert_eq!(all_notes[0].base.id, note_id);

    // --- Create content linked to the note ---
    let mut content_item = ContentItem::new();
    content_item.note_id = Some(note_id.clone());
    content_item.data = Some("# Hello World\n\nTest content.".into());

    let content = Content::new(&db);
    content.add(&content_item).expect("Failed to add content");

    // --- Find content by note_id ---
    let found = content
        .find_by_note_id(&note_id)
        .expect("Failed to find content by note_id");
    assert!(found.is_some(), "Content should be found by note_id");
    let found = found.unwrap();
    assert_eq!(found.note_id.as_deref(), Some(note_id.as_str()));
    assert_eq!(
        found.data.as_deref(),
        Some("# Hello World\n\nTest content.")
    );

    // --- Update content ---
    let content_id = found.base.id.clone();
    content
        .update_data(&content_id, "# Updated\n\nNew content.")
        .expect("Failed to update content data");

    // --- Verify update ---
    let updated = content
        .get(&content_id)
        .expect("Failed to get content by id")
        .expect("Updated content should exist");
    assert_eq!(updated.data.as_deref(), Some("# Updated\n\nNew content."));
}

// ---------------------------------------------------------------------------
// 2. Update note title and verify
// ---------------------------------------------------------------------------

#[test]
fn test_update_title_from_content() {
    let db = Database::open_memory().expect("Failed to open in-memory database");

    // --- Create a note ---
    let note = Note::new("Original Title");
    let note_id = note.base.id.clone();

    let notes = Notes::new(&db);
    notes.add(&note).expect("Failed to add note");

    // --- Verify original title ---
    let loaded = notes
        .get(&note_id)
        .expect("Failed to get note")
        .expect("Note should exist");
    assert_eq!(loaded.title, "Original Title");

    // --- Update title ---
    notes
        .update_title(&note_id, "Updated Title")
        .expect("Failed to update title");

    // --- Verify updated title ---
    let reloaded = notes
        .get(&note_id)
        .expect("Failed to get note after update")
        .expect("Note should still exist");
    assert_eq!(reloaded.title, "Updated Title");

    // The note should be marked as unsynced after update
    assert!(!reloaded.base.synced, "Updated note should be unsynced");
}
