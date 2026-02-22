//! Integration tests: FTS5 full-text search indexing and querying.

use wiredash_core::collections::content::Content;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::search::Search;
use wiredash_core::types::{ContentItem, Note};
use wiredash_db::Database;

#[test]
fn test_search_after_indexing() {
    let db = Database::open_memory().unwrap();
    let notes_col = Notes::new(&db);
    let content_col = Content::new(&db);
    let search = Search::new(&db);

    // Create note + content
    let note = Note::new("Rust Programming");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    let mut ci = ContentItem::new();
    ci.note_id = Some(note_id.clone());
    ci.data = Some("Learn Rust and build fast programs.".into());
    let ci_id = ci.base.id.clone();
    content_col.add(&ci).unwrap();

    // Index
    search.index_note(&note_id, "Rust Programming").unwrap();
    search.index_content(&ci_id, &note_id, "Learn Rust and build fast programs.").unwrap();

    // Search by title
    let results = search.search_notes("Rust").unwrap();
    assert!(results.contains(&note_id));

    // Search by content
    let results = search.search_content("fast programs").unwrap();
    assert!(results.contains(&note_id));
}

#[test]
fn test_search_no_results() {
    let db = Database::open_memory().unwrap();
    let search = Search::new(&db);

    let results = search.search_notes("nonexistent").unwrap();
    assert!(results.is_empty());

    let results = search.search_content("nonexistent").unwrap();
    assert!(results.is_empty());
}

#[test]
fn test_search_update_reindex() {
    let db = Database::open_memory().unwrap();
    let notes_col = Notes::new(&db);
    let search = Search::new(&db);

    let note = Note::new("Original Title");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    // Index with original title
    search.index_note(&note_id, "Original Title").unwrap();
    let results = search.search_notes("Original").unwrap();
    assert!(results.contains(&note_id));

    // Re-index with new title
    search.index_note(&note_id, "Updated Title").unwrap();
    let results = search.search_notes("Updated").unwrap();
    assert!(results.contains(&note_id));
}

#[test]
fn test_search_remove_note() {
    let db = Database::open_memory().unwrap();
    let notes_col = Notes::new(&db);
    let search = Search::new(&db);

    let note = Note::new("Deletable");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    search.index_note(&note_id, "Deletable").unwrap();

    // Verify findable
    let results = search.search_notes("Deletable").unwrap();
    assert!(results.contains(&note_id));

    // Remove from index
    search.remove_note(&note_id).unwrap();

    // Verify not findable
    let results = search.search_notes("Deletable").unwrap();
    assert!(!results.contains(&note_id));
}
