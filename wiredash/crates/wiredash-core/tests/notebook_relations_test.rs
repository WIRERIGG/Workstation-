//! Integration tests: notebook ↔ note relations via the database layer.

use wiredash_core::collections::notebooks::Notebooks;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::relations::Relations;
use wiredash_core::types::{Note, Notebook};
use wiredash_db::Database;

#[test]
fn test_notebook_note_relations() {
    let db = Database::open_memory().unwrap();
    let notebooks = Notebooks::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    // Create notebook + 2 notes
    let nb = Notebook::new("My Notebook");
    let n1 = Note::new("Note 1");
    let n2 = Note::new("Note 2");
    let nb_id = nb.base.id.clone();
    let n1_id = n1.base.id.clone();
    let n2_id = n2.base.id.clone();

    notebooks.add(&nb).unwrap();
    notes.add(&n1).unwrap();
    notes.add(&n2).unwrap();

    // Link notes to notebook
    relations.add("notebook", &nb_id, "note", &n1_id).unwrap();
    relations.add("notebook", &nb_id, "note", &n2_id).unwrap();

    // Query notes in notebook
    let note_ids = relations.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(note_ids.len(), 2);

    let found = notes.list_by_ids(&note_ids).unwrap();
    assert_eq!(found.len(), 2);
}

#[test]
fn test_notebook_update_title() {
    let db = Database::open_memory().unwrap();
    let notebooks = Notebooks::new(&db);

    let nb = Notebook::new("Original");
    let id = nb.base.id.clone();
    notebooks.add(&nb).unwrap();

    notebooks.update_title(&id, "Renamed").unwrap();
    let loaded = notebooks.get(&id).unwrap().unwrap();
    assert_eq!(loaded.title, "Renamed");
}

#[test]
fn test_notebook_unlink_all_deletes_relations() {
    let db = Database::open_memory().unwrap();
    let notebooks = Notebooks::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    let nb = Notebook::new("Cleanup Test");
    let n1 = Note::new("Note X");
    let nb_id = nb.base.id.clone();
    let n1_id = n1.base.id.clone();

    notebooks.add(&nb).unwrap();
    notes.add(&n1).unwrap();
    relations.add("notebook", &nb_id, "note", &n1_id).unwrap();

    // Verify relation exists
    let ids = relations.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(ids.len(), 1);

    // Unlink all
    relations.unlink_all_from("notebook", &nb_id).unwrap();

    // Verify relation removed
    let ids = relations.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(ids.len(), 0);
}
