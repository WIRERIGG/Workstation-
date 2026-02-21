use wiredash_core::collections::search::Search;
use wiredash_db::Database;

fn test_db() -> Database {
    Database::open_memory().unwrap()
}

#[test]
fn test_search_notes_by_title() {
    let db = test_db();
    let search = Search::new(&db);

    search.index_note("n1", "Rust Programming Guide").unwrap();

    let results = search.search_notes("rust").unwrap();
    assert!(
        results.contains(&"n1".to_string()),
        "Expected results to contain 'n1', got: {:?}",
        results
    );
}

#[test]
fn test_search_content() {
    let db = test_db();
    let search = Search::new(&db);

    search
        .index_content("c1", "n1", "The quick brown fox jumps over the lazy dog")
        .unwrap();

    let results = search.search_content("brown fox").unwrap();
    assert!(
        results.contains(&"n1".to_string()),
        "Expected results to contain 'n1', got: {:?}",
        results
    );
}

#[test]
fn test_search_no_results() {
    let db = test_db();
    let search = Search::new(&db);

    let results = search.search_notes("nonexistent").unwrap();
    assert!(
        results.is_empty(),
        "Expected empty results, got: {:?}",
        results
    );
}
