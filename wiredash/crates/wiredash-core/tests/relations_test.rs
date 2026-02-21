use wiredash_core::collections::relations::Relations;
use wiredash_db::Database;

fn setup_db() -> Database {
    Database::open_memory().expect("open in-memory database")
}

#[test]
fn test_add_and_query_relation() {
    let db = setup_db();
    let rels = Relations::new(&db);

    // Add 2 relations: notebook "nb1" -> note "n1" and note "n2"
    rels.add("notebook", "nb1", "note", "n1").unwrap();
    rels.add("notebook", "nb1", "note", "n2").unwrap();

    // Query from_ids: notebook nb1 -> notes
    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&"n1".to_string()));
    assert!(ids.contains(&"n2".to_string()));
}

#[test]
fn test_reverse_query() {
    let db = setup_db();
    let rels = Relations::new(&db);

    // Add 2 note -> tag relations pointing to same tag "t1"
    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.add("note", "n2", "tag", "t1").unwrap();

    // Query to_ids: which notes point to tag t1?
    let ids = rels.to_ids("note", "tag", "t1").unwrap();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&"n1".to_string()));
    assert!(ids.contains(&"n2".to_string()));
}

#[test]
fn test_unlink() {
    let db = setup_db();
    let rels = Relations::new(&db);

    // Add a relation and then unlink it
    rels.add("notebook", "nb1", "note", "n1").unwrap();
    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert_eq!(ids.len(), 1);

    rels.unlink("notebook", "nb1", "note", "n1").unwrap();
    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert!(ids.is_empty());
}

#[test]
fn test_unlink_all_from() {
    let db = setup_db();
    let rels = Relations::new(&db);

    // Add 3 relations from the same source: note "n1" -> tag "t1", tag "t2", color "c1"
    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.add("note", "n1", "tag", "t2").unwrap();
    rels.add("note", "n1", "color", "c1").unwrap();

    // Verify all 3 exist
    let tag_ids = rels.from_ids("note", "n1", "tag").unwrap();
    assert_eq!(tag_ids.len(), 2);
    let color_ids = rels.from_ids("note", "n1", "color").unwrap();
    assert_eq!(color_ids.len(), 1);

    // Unlink all from note "n1"
    rels.unlink_all_from("note", "n1").unwrap();

    // Verify all are gone
    let tag_ids = rels.from_ids("note", "n1", "tag").unwrap();
    assert!(tag_ids.is_empty());
    let color_ids = rels.from_ids("note", "n1", "color").unwrap();
    assert!(color_ids.is_empty());
}

#[test]
fn test_deterministic_id() {
    let db = setup_db();
    let rels = Relations::new(&db);

    // Add the same relation twice
    rels.add("notebook", "nb1", "note", "n1").unwrap();
    rels.add("notebook", "nb1", "note", "n1").unwrap();

    // Should only have 1 result (deterministic ID means INSERT OR REPLACE, no duplicate)
    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0], "n1");
}
