//! Integration tests: tag ↔ note relations via the database layer.

use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::relations::Relations;
use wiredash_core::collections::tags::Tags;
use wiredash_core::types::{Note, Tag};
use wiredash_db::Database;

#[test]
fn test_tag_note_relations() {
    let db = Database::open_memory().unwrap();
    let tags = Tags::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    let tag = Tag::new("important");
    let n1 = Note::new("Note A");
    let tag_id = tag.base.id.clone();
    let n1_id = n1.base.id.clone();

    tags.add(&tag).unwrap();
    notes.add(&n1).unwrap();

    // Link note to tag: note → tag
    relations.add("note", &n1_id, "tag", &tag_id).unwrap();

    // Query: which notes have this tag?
    let note_ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(note_ids.len(), 1);
    assert_eq!(note_ids[0], n1_id);
}

#[test]
fn test_tag_update_title() {
    let db = Database::open_memory().unwrap();
    let tags = Tags::new(&db);

    let tag = Tag::new("old-name");
    let id = tag.base.id.clone();
    tags.add(&tag).unwrap();

    tags.update_title(&id, "new-name").unwrap();
    let loaded = tags.get(&id).unwrap().unwrap();
    assert_eq!(loaded.title, "new-name");
}

#[test]
fn test_tag_multiple_notes() {
    let db = Database::open_memory().unwrap();
    let tags = Tags::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    let tag = Tag::new("shared-tag");
    let n1 = Note::new("First");
    let n2 = Note::new("Second");
    let tag_id = tag.base.id.clone();
    let n1_id = n1.base.id.clone();
    let n2_id = n2.base.id.clone();

    tags.add(&tag).unwrap();
    notes.add(&n1).unwrap();
    notes.add(&n2).unwrap();

    relations.add("note", &n1_id, "tag", &tag_id).unwrap();
    relations.add("note", &n2_id, "tag", &tag_id).unwrap();

    let note_ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(note_ids.len(), 2);
    assert!(note_ids.contains(&n1_id));
    assert!(note_ids.contains(&n2_id));
}

#[test]
fn test_tag_unlink_removes_relation() {
    let db = Database::open_memory().unwrap();
    let tags = Tags::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    let tag = Tag::new("temp");
    let n1 = Note::new("Temporary");
    let tag_id = tag.base.id.clone();
    let n1_id = n1.base.id.clone();

    tags.add(&tag).unwrap();
    notes.add(&n1).unwrap();
    relations.add("note", &n1_id, "tag", &tag_id).unwrap();

    // Verify exists
    let ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(ids.len(), 1);

    // Unlink
    relations.unlink("note", &n1_id, "tag", &tag_id).unwrap();

    // Verify removed
    let ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(ids.len(), 0);
}
