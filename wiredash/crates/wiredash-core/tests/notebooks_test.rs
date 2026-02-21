use wiredash_core::collections::notebooks::Notebooks;
use wiredash_core::types::*;
use wiredash_db::Database;

fn test_db() -> Database {
    Database::open_memory().unwrap()
}

fn make_nb(title: &str) -> Notebook {
    Notebook {
        base: BaseItem::new("notebook"),
        trash: TrashMeta::default(),
        title: title.into(),
        description: None,
        date_edited: chrono::Utc::now().timestamp_millis(),
        pinned: false,
    }
}

#[test]
fn test_add_and_get_notebook() {
    let db = test_db();
    let notebooks = Notebooks::new(&db);

    let nb = make_nb("My First Notebook");
    notebooks.add(&nb).unwrap();

    let fetched = notebooks.get(&nb.base.id).unwrap();
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.title, "My First Notebook");
    assert_eq!(fetched.base.id, nb.base.id);
}

#[test]
fn test_list_notebooks() {
    let db = test_db();
    let notebooks = Notebooks::new(&db);

    notebooks.add(&make_nb("Notebook A")).unwrap();
    notebooks.add(&make_nb("Notebook B")).unwrap();

    let all = notebooks.list().unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn test_trash_notebook() {
    let db = test_db();
    let notebooks = Notebooks::new(&db);

    let nb = make_nb("To Be Trashed");
    notebooks.add(&nb).unwrap();

    notebooks.move_to_trash(&nb.base.id).unwrap();

    let active = notebooks.list().unwrap();
    assert_eq!(active.len(), 0);
}
