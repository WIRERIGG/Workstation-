//! Tests for filtered note queries, list_by_ids, restore_from_trash.

use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::notebooks::Notebooks;
use wiredash_core::collections::tags::Tags;
use wiredash_core::types::{Note, Notebook, Tag, SortBy, SortDirection};
use wiredash_db::Database;

#[test]
fn test_list_filtered_favorites_only() {
    let db = Database::open_memory().unwrap();
    let notes = Notes::new(&db);

    let n1 = Note::new("Alpha");
    let mut n2 = Note::new("Beta");
    n2.favorite = true;

    notes.add(&n1).unwrap();
    notes.add(&n2).unwrap();

    let fav = notes
        .list_filtered(true, false, SortBy::Title, SortDirection::Asc, None)
        .unwrap();
    assert_eq!(fav.len(), 1);
    assert_eq!(fav[0].title, "Beta");
}

#[test]
fn test_list_filtered_sort_by_title() {
    let db = Database::open_memory().unwrap();
    let notes = Notes::new(&db);

    notes.add(&Note::new("Charlie")).unwrap();
    notes.add(&Note::new("Alpha")).unwrap();
    notes.add(&Note::new("Bravo")).unwrap();

    let sorted = notes
        .list_filtered(false, false, SortBy::Title, SortDirection::Asc, None)
        .unwrap();
    assert_eq!(sorted[0].title, "Alpha");
    assert_eq!(sorted[1].title, "Bravo");
    assert_eq!(sorted[2].title, "Charlie");
}

#[test]
fn test_list_by_ids() {
    let db = Database::open_memory().unwrap();
    let notes = Notes::new(&db);

    let n1 = Note::new("First");
    let n2 = Note::new("Second");
    let n3 = Note::new("Third");
    let id1 = n1.base.id.clone();
    let id3 = n3.base.id.clone();

    notes.add(&n1).unwrap();
    notes.add(&n2).unwrap();
    notes.add(&n3).unwrap();

    let found = notes.list_by_ids(&[id1.clone(), id3.clone()]).unwrap();
    assert_eq!(found.len(), 2);
    let titles: Vec<&str> = found.iter().map(|n| n.title.as_str()).collect();
    assert!(titles.contains(&"First"));
    assert!(titles.contains(&"Third"));
}

#[test]
fn test_list_by_ids_empty() {
    let db = Database::open_memory().unwrap();
    let notes = Notes::new(&db);
    let found = notes.list_by_ids(&[]).unwrap();
    assert!(found.is_empty());
}

#[test]
fn test_restore_from_trash() {
    let db = Database::open_memory().unwrap();
    let notes = Notes::new(&db);

    let n = Note::new("Trashed Note");
    let id = n.base.id.clone();
    notes.add(&n).unwrap();
    notes.move_to_trash(&id).unwrap();

    let trashed = notes.trashed().unwrap();
    assert_eq!(trashed.len(), 1);

    notes.restore_from_trash(&id).unwrap();

    let trashed_after = notes.trashed().unwrap();
    assert_eq!(trashed_after.len(), 0);

    let active = notes.list(None).unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].title, "Trashed Note");
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
