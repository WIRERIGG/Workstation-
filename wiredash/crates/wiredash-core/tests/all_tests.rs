//! Consolidated integration tests for wiredash-core.
//!
//! All tests are in a single binary to avoid the Windows linker PDB
//! contention issue that occurs when linking many large test binaries
//! (LanceDB pulls hundreds of transitive dependencies).

use wiredash_core::collections::colors::Colors;
use wiredash_core::collections::content::Content;
use wiredash_core::collections::notebooks::Notebooks;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::relations::Relations;
use wiredash_core::collections::reminders::Reminders;
use wiredash_core::collections::search::Search;
use wiredash_core::collections::settings::Settings;
use wiredash_core::collections::tags::Tags;
use wiredash_core::collections::trash::Trash;
use wiredash_core::collections::vaults::Vaults;
use wiredash_core::types::*;
use wiredash_crypto::encryption::{Decryption, Encryption};
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

async fn test_db() -> Database {
    Database::open_memory().await.unwrap()
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

// ===========================================================================
// notes_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_add_and_get_note() {
    let db = test_db().await;
    let notes = Notes::new(&db);

    let note = make_note("My First Note");
    notes.add(&note).unwrap();

    let fetched = notes.get(&note.base.id).unwrap();
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.title, "My First Note");
    assert_eq!(fetched.base.id, note.base.id);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_list_notes() {
    let db = test_db().await;
    let notes = Notes::new(&db);

    notes.add(&make_note("Note A")).unwrap();
    notes.add(&make_note("Note B")).unwrap();
    notes.add(&make_note("Note C")).unwrap();

    let all = notes.list(None).unwrap();
    assert_eq!(all.len(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_update_note() {
    let db = test_db().await;
    let notes = Notes::new(&db);

    let note = make_note("Original Title");
    notes.add(&note).unwrap();

    notes.update_title(&note.base.id, "Updated Title").unwrap();

    let fetched = notes.get(&note.base.id).unwrap().unwrap();
    assert_eq!(fetched.title, "Updated Title");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_soft_delete_note() {
    let db = test_db().await;
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

#[tokio::test(flavor = "multi_thread")]
async fn test_pin_favorite_archive() {
    let db = test_db().await;
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

#[tokio::test(flavor = "multi_thread")]
async fn test_hard_delete() {
    let db = test_db().await;
    let notes = Notes::new(&db);

    let note = make_note("To Be Deleted");
    notes.add(&note).unwrap();

    notes.remove(&note.base.id).unwrap();

    let fetched = notes.get(&note.base.id).unwrap();
    assert!(fetched.is_none());
}

// ===========================================================================
// notebooks_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_add_and_get_notebook() {
    let db = Database::open_memory().await.unwrap();
    let notebooks = Notebooks::new(&db);

    let nb = make_nb("My First Notebook");
    notebooks.add(&nb).unwrap();

    let fetched = notebooks.get(&nb.base.id).unwrap();
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.title, "My First Notebook");
    assert_eq!(fetched.base.id, nb.base.id);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_list_notebooks() {
    let db = Database::open_memory().await.unwrap();
    let notebooks = Notebooks::new(&db);

    notebooks.add(&make_nb("Notebook A")).unwrap();
    notebooks.add(&make_nb("Notebook B")).unwrap();

    let all = notebooks.list().unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_trash_notebook() {
    let db = Database::open_memory().await.unwrap();
    let notebooks = Notebooks::new(&db);

    let nb = make_nb("To Be Trashed");
    notebooks.add(&nb).unwrap();

    notebooks.move_to_trash(&nb.base.id).unwrap();

    let active = notebooks.list().unwrap();
    assert_eq!(active.len(), 0);
}

// ===========================================================================
// collections_test (tags, colors, content, settings, trash)
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_tags_crud() {
    let db = test_db().await;
    let tags = Tags::new(&db);

    let tag = Tag::new("rust");
    tags.add(&tag).unwrap();

    let found = tags.find_by_title("rust").unwrap();
    assert!(found.is_some());
    let found = found.unwrap();
    assert_eq!(found.title, "rust");
    assert_eq!(found.base.id, tag.base.id);

    tags.remove(&tag.base.id).unwrap();
    let gone = tags.get(&tag.base.id).unwrap();
    assert!(gone.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_colors_crud() {
    let db = test_db().await;
    let colors = Colors::new(&db);

    let color = Color::new("Red", "#ff0000");
    colors.add(&color).unwrap();

    let found = colors.find_by_code("#ff0000").unwrap();
    assert!(found.is_some());
    let found = found.unwrap();
    assert_eq!(found.title, "Red");
    assert_eq!(found.color_code, "#ff0000");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_content_by_note_id() {
    let db = test_db().await;
    let content = Content::new(&db);

    let mut item = ContentItem::new();
    item.note_id = Some("n1".to_string());
    item.data = Some("<p>Hello</p>".to_string());
    content.add(&item).unwrap();

    let found = content.find_by_note_id("n1").unwrap();
    assert!(found.is_some());
    let found = found.unwrap();
    assert_eq!(found.data, Some("<p>Hello</p>".to_string()));
    assert_eq!(found.note_id, Some("n1".to_string()));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_settings_kv() {
    let db = test_db().await;
    let settings = Settings::new(&db);

    let value = serde_json::json!("Note $date$");
    settings.set("titleFormat", &value).unwrap();

    let fetched = settings.get_setting("titleFormat").unwrap();
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap(), serde_json::json!("Note $date$"));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_trash_cleanup() {
    let db = test_db().await;
    let notes = Notes::new(&db);
    let trash = Trash::new(&db);

    let note = Note::new("Trash Me");
    notes.add(&note).unwrap();
    notes.move_to_trash(&note.base.id).unwrap();

    let fetched = notes.get(&note.base.id).unwrap();
    assert!(fetched.is_some());
    assert!(fetched.unwrap().base.deleted);

    let thirty_days_ago = chrono::Utc::now().timestamp_millis() - (30 * 24 * 60 * 60 * 1000);
    let table = db.table_or_err("notes").unwrap();
    let filter = format!("id = {}", wiredash_db::escape_str(&note.base.id));
    table
        .update()
        .column("dateDeleted", &thirty_days_ago.to_string())
        .only_if(&filter)
        .execute()
        .await
        .unwrap();

    let deleted_count = trash.clean_notes(7).unwrap();
    assert_eq!(deleted_count, 1);

    let gone = notes.get(&note.base.id).unwrap();
    assert!(gone.is_none());
}

// ===========================================================================
// filtered_notes_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_list_filtered_favorites_only() {
    let db = Database::open_memory().await.unwrap();
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

#[tokio::test(flavor = "multi_thread")]
async fn test_list_filtered_sort_by_title() {
    let db = Database::open_memory().await.unwrap();
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

#[tokio::test(flavor = "multi_thread")]
async fn test_list_by_ids() {
    let db = Database::open_memory().await.unwrap();
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

#[tokio::test(flavor = "multi_thread")]
async fn test_list_by_ids_empty() {
    let db = Database::open_memory().await.unwrap();
    let notes = Notes::new(&db);
    let found = notes.list_by_ids(&[]).unwrap();
    assert!(found.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_restore_from_trash() {
    let db = Database::open_memory().await.unwrap();
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

// ===========================================================================
// relations_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_add_and_query_relation() {
    let db = Database::open_memory().await.unwrap();
    let rels = Relations::new(&db);

    rels.add("notebook", "nb1", "note", "n1").unwrap();
    rels.add("notebook", "nb1", "note", "n2").unwrap();

    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&"n1".to_string()));
    assert!(ids.contains(&"n2".to_string()));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_reverse_query() {
    let db = Database::open_memory().await.unwrap();
    let rels = Relations::new(&db);

    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.add("note", "n2", "tag", "t1").unwrap();

    let ids = rels.to_ids("note", "tag", "t1").unwrap();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&"n1".to_string()));
    assert!(ids.contains(&"n2".to_string()));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_unlink() {
    let db = Database::open_memory().await.unwrap();
    let rels = Relations::new(&db);

    rels.add("notebook", "nb1", "note", "n1").unwrap();
    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert_eq!(ids.len(), 1);

    rels.unlink("notebook", "nb1", "note", "n1").unwrap();
    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert!(ids.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_unlink_all_from() {
    let db = Database::open_memory().await.unwrap();
    let rels = Relations::new(&db);

    rels.add("note", "n1", "tag", "t1").unwrap();
    rels.add("note", "n1", "tag", "t2").unwrap();
    rels.add("note", "n1", "color", "c1").unwrap();

    let tag_ids = rels.from_ids("note", "n1", "tag").unwrap();
    assert_eq!(tag_ids.len(), 2);
    let color_ids = rels.from_ids("note", "n1", "color").unwrap();
    assert_eq!(color_ids.len(), 1);

    rels.unlink_all_from("note", "n1").unwrap();

    let tag_ids = rels.from_ids("note", "n1", "tag").unwrap();
    assert!(tag_ids.is_empty());
    let color_ids = rels.from_ids("note", "n1", "color").unwrap();
    assert!(color_ids.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_deterministic_id() {
    let db = Database::open_memory().await.unwrap();
    let rels = Relations::new(&db);

    rels.add("notebook", "nb1", "note", "n1").unwrap();
    rels.add("notebook", "nb1", "note", "n1").unwrap();

    let ids = rels.from_ids("notebook", "nb1", "note").unwrap();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0], "n1");
}

// ===========================================================================
// search_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_search_notes_by_title() {
    let db = Database::open_memory().await.unwrap();
    let notes_col = Notes::new(&db);
    let search = Search::new(&db);

    let note = Note::new("Rust Programming Guide");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    let results = search.search_notes("rust").unwrap();
    assert!(
        results.contains(&note_id),
        "Expected results to contain note id, got: {:?}",
        results
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_search_no_results() {
    let db = Database::open_memory().await.unwrap();
    let search = Search::new(&db);

    let results = search.search_notes("nonexistent").unwrap();
    assert!(
        results.is_empty(),
        "Expected empty results, got: {:?}",
        results
    );
}

// ===========================================================================
// search_integration_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_search_after_indexing() {
    let db = Database::open_memory().await.unwrap();
    let notes_col = Notes::new(&db);
    let content_col = Content::new(&db);
    let search = Search::new(&db);

    let note = Note::new("Rust Programming");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    let mut ci = ContentItem::new();
    ci.note_id = Some(note_id.clone());
    ci.data = Some("Learn Rust and build fast programs.".into());
    content_col.add(&ci).unwrap();

    // index_note and index_content are no-ops in LanceDB mode
    search.index_note(&note_id, "Rust Programming").unwrap();
    search.index_content(&ci.base.id, &note_id, "Learn Rust and build fast programs.").unwrap();

    let results = search.search_notes("Rust").unwrap();
    assert!(results.contains(&note_id));

    let results = search.search_content("fast programs").unwrap();
    assert!(results.contains(&note_id));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_search_no_results_integration() {
    let db = Database::open_memory().await.unwrap();
    let search = Search::new(&db);

    let results = search.search_notes("nonexistent").unwrap();
    assert!(results.is_empty());

    let results = search.search_content("nonexistent").unwrap();
    assert!(results.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_search_update_reindex() {
    let db = Database::open_memory().await.unwrap();
    let notes_col = Notes::new(&db);
    let search = Search::new(&db);

    let note = Note::new("Original Title");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    let results = search.search_notes("Original").unwrap();
    assert!(results.contains(&note_id));

    notes_col.update_title(&note_id, "Updated Title").unwrap();

    let results = search.search_notes("Updated").unwrap();
    assert!(results.contains(&note_id));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_search_remove_note() {
    let db = Database::open_memory().await.unwrap();
    let notes_col = Notes::new(&db);
    let search = Search::new(&db);

    let note = Note::new("Deletable");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    let results = search.search_notes("Deletable").unwrap();
    assert!(results.contains(&note_id));

    notes_col.remove(&note_id).unwrap();

    let results = search.search_notes("Deletable").unwrap();
    assert!(!results.contains(&note_id));
}

// ===========================================================================
// settings_kv_extended_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_settings_roundtrip_bool() {
    let db = Database::open_memory().await.unwrap();
    let settings = Settings::new(&db);

    settings.set("app_lock_enabled", &serde_json::json!(true)).unwrap();
    let val = settings.get_setting("app_lock_enabled").unwrap().unwrap();
    assert_eq!(val, serde_json::json!(true));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_settings_roundtrip_string() {
    let db = Database::open_memory().await.unwrap();
    let settings = Settings::new(&db);

    settings.set("theme_scheme", &serde_json::json!("Dark")).unwrap();
    let val = settings.get_setting("theme_scheme").unwrap().unwrap();
    assert_eq!(val.as_str().unwrap(), "Dark");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_settings_roundtrip_number() {
    let db = Database::open_memory().await.unwrap();
    let settings = Settings::new(&db);

    settings.set("zoom_factor", &serde_json::json!(1.5)).unwrap();
    let val = settings.get_setting("zoom_factor").unwrap().unwrap();
    assert!((val.as_f64().unwrap() - 1.5).abs() < f64::EPSILON);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_settings_overwrite() {
    let db = Database::open_memory().await.unwrap();
    let settings = Settings::new(&db);

    settings.set("theme_scheme", &serde_json::json!("Light")).unwrap();
    settings.set("theme_scheme", &serde_json::json!("Dark")).unwrap();

    let val = settings.get_setting("theme_scheme").unwrap().unwrap();
    assert_eq!(val.as_str().unwrap(), "Dark");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_settings_remove() {
    let db = Database::open_memory().await.unwrap();
    let settings = Settings::new(&db);

    settings.set("temp_key", &serde_json::json!("value")).unwrap();
    settings.remove("temp_key").unwrap();

    let val = settings.get_setting("temp_key").unwrap();
    assert!(val.is_none());
}

// ===========================================================================
// reminders_update_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_update_reminder() {
    let db = Database::open_memory().await.unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Original Title", now);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    rem.title = "Updated Title".to_string();
    rem.priority = "loud".to_string();
    rem.mode = "recurring".to_string();
    rem.recurring_mode = Some("daily".to_string());
    rem.disabled = Some(false);
    reminders.update(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.title, "Updated Title");
    assert_eq!(loaded.priority, "loud");
    assert_eq!(loaded.mode, "recurring");
    assert_eq!(loaded.recurring_mode, Some("daily".to_string()));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_update_reminder_snooze() {
    let db = Database::open_memory().await.unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Snooze Test", now);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    let snooze_time = now + 30 * 60 * 1000;
    rem.snooze_until = Some(snooze_time);
    reminders.update(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.snooze_until, Some(snooze_time));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_update_reminder_selected_days() {
    let db = Database::open_memory().await.unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Weekly Standup", now);
    rem.mode = "recurring".to_string();
    rem.recurring_mode = Some("weekly".to_string());
    rem.selected_days = Some(vec![1, 3, 5]);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.selected_days, Some(vec![1, 3, 5]));
}

// ===========================================================================
// notebook_relations_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_notebook_note_relations() {
    let db = Database::open_memory().await.unwrap();
    let notebooks = Notebooks::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    let nb = Notebook::new("My Notebook");
    let n1 = Note::new("Note 1");
    let n2 = Note::new("Note 2");
    let nb_id = nb.base.id.clone();
    let n1_id = n1.base.id.clone();
    let n2_id = n2.base.id.clone();

    notebooks.add(&nb).unwrap();
    notes.add(&n1).unwrap();
    notes.add(&n2).unwrap();

    relations.add("notebook", &nb_id, "note", &n1_id).unwrap();
    relations.add("notebook", &nb_id, "note", &n2_id).unwrap();

    let note_ids = relations.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(note_ids.len(), 2);

    let found = notes.list_by_ids(&note_ids).unwrap();
    assert_eq!(found.len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_notebook_update_title() {
    let db = Database::open_memory().await.unwrap();
    let notebooks = Notebooks::new(&db);

    let nb = Notebook::new("Original");
    let id = nb.base.id.clone();
    notebooks.add(&nb).unwrap();

    notebooks.update_title(&id, "Renamed").unwrap();
    let loaded = notebooks.get(&id).unwrap().unwrap();
    assert_eq!(loaded.title, "Renamed");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_notebook_unlink_all_deletes_relations() {
    let db = Database::open_memory().await.unwrap();
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

    let ids = relations.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(ids.len(), 1);

    relations.unlink_all_from("notebook", &nb_id).unwrap();

    let ids = relations.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(ids.len(), 0);
}

// ===========================================================================
// tag_relations_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_tag_note_relations() {
    let db = Database::open_memory().await.unwrap();
    let tags = Tags::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    let tag = Tag::new("important");
    let n1 = Note::new("Note A");
    let tag_id = tag.base.id.clone();
    let n1_id = n1.base.id.clone();

    tags.add(&tag).unwrap();
    notes.add(&n1).unwrap();

    relations.add("note", &n1_id, "tag", &tag_id).unwrap();

    let note_ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(note_ids.len(), 1);
    assert_eq!(note_ids[0], n1_id);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_tag_update_title() {
    let db = Database::open_memory().await.unwrap();
    let tags = Tags::new(&db);

    let tag = Tag::new("old-name");
    let id = tag.base.id.clone();
    tags.add(&tag).unwrap();

    tags.update_title(&id, "new-name").unwrap();
    let loaded = tags.get(&id).unwrap().unwrap();
    assert_eq!(loaded.title, "new-name");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_tag_multiple_notes() {
    let db = Database::open_memory().await.unwrap();
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

#[tokio::test(flavor = "multi_thread")]
async fn test_tag_unlink_removes_relation() {
    let db = Database::open_memory().await.unwrap();
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

    let ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(ids.len(), 1);

    relations.unlink("note", &n1_id, "tag", &tag_id).unwrap();

    let ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(ids.len(), 0);
}

// ===========================================================================
// vault_lock_test
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_set_content_locked() {
    let db = Database::open_memory().await.unwrap();
    let content_col = Content::new(&db);

    let mut ci = ContentItem::new();
    ci.data = Some("Secret note content".to_string());
    let ci_id = ci.base.id.clone();
    content_col.add(&ci).unwrap();

    content_col.set_locked(&ci_id, true).unwrap();
    let loaded = content_col.get(&ci_id).unwrap().unwrap();
    assert!(loaded.locked);

    content_col.set_locked(&ci_id, false).unwrap();
    let loaded = content_col.get(&ci_id).unwrap().unwrap();
    assert!(!loaded.locked);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_list_locked_content() {
    let db = Database::open_memory().await.unwrap();
    let content_col = Content::new(&db);

    let mut c1 = ContentItem::new();
    c1.data = Some("Public note".to_string());
    content_col.add(&c1).unwrap();

    let mut c2 = ContentItem::new();
    c2.data = Some("Encrypted note".to_string());
    let c2_id = c2.base.id.clone();
    content_col.add(&c2).unwrap();
    content_col.set_locked(&c2_id, true).unwrap();

    let locked = content_col.list_locked().unwrap();
    assert_eq!(locked.len(), 1);
    assert_eq!(locked[0].base.id, c2_id);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_vault_update_key() {
    let db = Database::open_memory().await.unwrap();
    let vaults = Vaults::new(&db);

    let mut v = Vault::new("Default");
    v.key = Some("old_key_material".to_string());
    let v_id = v.base.id.clone();
    vaults.add(&v).unwrap();

    vaults.update_key(&v_id, "new_key_material").unwrap();
    let loaded = vaults.get(&v_id).unwrap().unwrap();
    assert_eq!(loaded.key, Some("new_key_material".to_string()));
}

// ===========================================================================
// integration_test (full lifecycle)
// ===========================================================================

#[tokio::test(flavor = "multi_thread")]
async fn test_full_note_lifecycle() {
    let db = Database::open_memory().await.unwrap();

    // 2. Create a note
    let note_col = Notes::new(&db);
    let mut note = Note::new("Meeting Notes");
    note.headline = Some("Q1 planning".into());
    let note_id = note.base.id.clone();
    note_col.add(&note).unwrap();

    let fetched = note_col.get(&note_id).unwrap().expect("note should exist");
    assert_eq!(fetched.title, "Meeting Notes");
    assert_eq!(fetched.headline.as_deref(), Some("Q1 planning"));
    assert!(!fetched.base.deleted);

    // 3. Add content for the note
    let content_col = Content::new(&db);
    let mut content_item = ContentItem::new();
    content_item.note_id = Some(note_id.clone());
    content_item.data = Some("<p>Discussed roadmap</p>".into());
    let content_id = content_item.base.id.clone();
    content_col.add(&content_item).unwrap();

    let fetched_content = content_col.get(&content_id).unwrap().expect("content should exist");
    assert_eq!(fetched_content.note_id.as_deref(), Some(note_id.as_str()));
    assert_eq!(fetched_content.data.as_deref(), Some("<p>Discussed roadmap</p>"));

    let by_note = content_col.find_by_note_id(&note_id).unwrap().expect("content by noteId");
    assert_eq!(by_note.base.id, content_id);

    // 4. Tag the note
    let tags_col = Tags::new(&db);
    let tag = Tag::new("work");
    let tag_id = tag.base.id.clone();
    tags_col.add(&tag).unwrap();

    let fetched_tag = tags_col.get(&tag_id).unwrap().expect("tag should exist");
    assert_eq!(fetched_tag.title, "work");

    let rels = Relations::new(&db);
    rels.add("note", &note_id, "tag", &tag_id).unwrap();

    // 5. Put the note in a notebook
    let nbs = Notebooks::new(&db);
    let mut nb = Notebook::new("Work");
    nb.description = Some("Work-related notes".into());
    let nb_id = nb.base.id.clone();
    nbs.add(&nb).unwrap();

    let fetched_nb = nbs.get(&nb_id).unwrap().expect("notebook should exist");
    assert_eq!(fetched_nb.title, "Work");
    assert_eq!(fetched_nb.description.as_deref(), Some("Work-related notes"));

    rels.add("notebook", &nb_id, "note", &note_id).unwrap();

    // 6. Verify relations
    let note_tags = rels.from_ids("note", &note_id, "tag").unwrap();
    assert_eq!(note_tags.len(), 1);
    assert_eq!(note_tags[0], tag_id);

    let nb_notes = rels.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(nb_notes.len(), 1);
    assert_eq!(nb_notes[0], note_id);

    let containing_nbs = rels.to_ids("notebook", "note", &note_id).unwrap();
    assert_eq!(containing_nbs.len(), 1);
    assert_eq!(containing_nbs[0], nb_id);

    // 7. Search for the note
    let search_col = Search::new(&db);
    search_col.index_note(&note_id, "Meeting Notes").unwrap();

    let results = search_col.search_notes("meeting").unwrap();
    assert_eq!(results.len(), 1, "should find exactly one note for 'meeting'");
    assert_eq!(results[0], note_id);

    let empty = search_col.search_notes("zzzznotfound").unwrap();
    assert!(empty.is_empty(), "no results for nonsense query");

    // 8. Encrypt and decrypt content
    let key = SerializedKey {
        password: Some("vault-password".into()),
        key: None,
        salt: None,
    };
    let plaintext = "<p>Discussed roadmap for Q1</p>";
    let cipher = Encryption::encrypt(&key, plaintext).unwrap();

    assert_eq!(cipher.format, "base64");
    assert_eq!(cipher.alg, "xcha-argon2i13-7");
    assert_eq!(cipher.length, plaintext.len());
    assert!(!cipher.cipher.is_empty(), "ciphertext must be non-empty");
    assert!(!cipher.iv.is_empty(), "IV must be non-empty");
    assert!(!cipher.salt.is_empty(), "salt must be non-empty");

    let decrypt_key = SerializedKey {
        password: Some("vault-password".into()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let decrypted = Decryption::decrypt(&cipher, &decrypt_key).unwrap();
    assert_eq!(decrypted, plaintext);

    let wrong_key = SerializedKey {
        password: Some("wrong-password".into()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    assert!(
        Decryption::decrypt(&cipher, &wrong_key).is_err(),
        "decryption with wrong password should fail"
    );

    // 9. Settings round-trip
    let settings_col = Settings::new(&db);
    settings_col
        .set("titleFormat", &serde_json::json!("Note $date$ $time$"))
        .unwrap();

    let format = settings_col
        .get_setting("titleFormat")
        .unwrap()
        .expect("setting should exist");
    assert_eq!(format, serde_json::json!("Note $date$ $time$"));

    settings_col
        .set("titleFormat", &serde_json::json!("Updated $date$"))
        .unwrap();
    let updated = settings_col
        .get_setting("titleFormat")
        .unwrap()
        .expect("updated setting should exist");
    assert_eq!(updated, serde_json::json!("Updated $date$"));

    let missing = settings_col.get_setting("nonExistentKey").unwrap();
    assert!(missing.is_none(), "missing key should return None");

    // 10. Trash the note
    note_col.move_to_trash(&note_id).unwrap();

    let active = note_col.list(None).unwrap();
    assert_eq!(active.len(), 0, "no active notes after trashing");

    let trashed = note_col.trashed().unwrap();
    assert_eq!(trashed.len(), 1, "exactly one trashed note");
    assert_eq!(trashed[0].base.id, note_id);
    assert!(trashed[0].base.deleted, "trashed note should have deleted=true");
    assert_eq!(
        trashed[0].trash.item_type.as_deref(),
        Some("note"),
        "trash metadata should record original type"
    );

    // 11. Hard delete
    note_col.remove(&note_id).unwrap();

    assert!(
        note_col.get(&note_id).unwrap().is_none(),
        "note should be gone after hard delete"
    );

    let trashed_after = note_col.trashed().unwrap();
    assert_eq!(trashed_after.len(), 0, "no trashed notes after hard delete");

    let orphan_tags = rels.from_ids("note", &note_id, "tag").unwrap();
    assert_eq!(orphan_tags.len(), 1, "relation survives note deletion");
}

// ===========================================================================
// types_test (no DB required)
// ===========================================================================

#[test]
fn test_note_serialization_roundtrip() {
    let note = Note::new("Test Note");

    let json = serde_json::to_string(&note).expect("serialize note");
    let restored: Note = serde_json::from_str(&json).expect("deserialize note");

    assert_eq!(note.base.id, restored.base.id);
    assert_eq!(note.base.item_type, restored.base.item_type);
    assert_eq!(note.base.item_type, "note");
    assert_eq!(note.title, restored.title);
    assert_eq!(restored.title, "Test Note");
    assert_eq!(note.pinned, restored.pinned);
    assert_eq!(note.favorite, restored.favorite);
    assert_eq!(note.local_only, restored.local_only);
    assert_eq!(note.conflicted, restored.conflicted);
    assert_eq!(note.readonly, restored.readonly);
    assert_eq!(note.date_edited, restored.date_edited);
    assert_eq!(note.headline, restored.headline);
    assert_eq!(note.content_id, restored.content_id);
    assert_eq!(note.is_generated_title, restored.is_generated_title);
    assert_eq!(note.archived, restored.archived);
    assert_eq!(note.expiry_date, restored.expiry_date);

    assert!(json.contains("\"dateCreated\""));
    assert!(json.contains("\"dateModified\""));
    assert!(json.contains("\"dateEdited\""));
    assert!(json.contains("\"localOnly\""));
    assert!(json.contains("\"type\":\"note\""));
}

#[test]
fn test_base_item_generates_uuid() {
    let a = BaseItem::new("note");
    let b = BaseItem::new("notebook");

    assert_ne!(a.id, b.id);
    assert_eq!(a.item_type, "note");
    assert_eq!(b.item_type, "notebook");
    assert!(a.date_created > 0);
    assert!(b.date_created > 0);
}

#[test]
fn test_notebook_default_values() {
    let nb = Notebook::new("My Notebook");

    assert_eq!(nb.base.deleted, false);
    assert_eq!(nb.base.synced, false);
    assert_eq!(nb.title, "My Notebook");
    assert_eq!(nb.pinned, false);
    assert_eq!(nb.description, None);
    assert_eq!(nb.base.item_type, "notebook");
}

// ===========================================================================
// vault_encrypt_test (no DB required)
// ===========================================================================

#[test]
fn test_encrypt_decrypt_roundtrip() {
    let password = "test_vault_password";
    let plaintext = "This is a secret note about my plans.";
    let key = SerializedKey {
        password: Some(password.to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, plaintext).unwrap();
    assert_eq!(cipher.format, "base64");
    assert!(!cipher.cipher.is_empty());

    let decrypted = Decryption::decrypt(&cipher, &key).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_wrong_password_fails() {
    let key = SerializedKey {
        password: Some("correct_password".to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, "secret").unwrap();

    let wrong_key = SerializedKey {
        password: Some("wrong_password".to_string()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let result = Decryption::decrypt(&cipher, &wrong_key);
    assert!(result.is_err());
}

#[test]
fn test_cipher_serialization() {
    let key = SerializedKey {
        password: Some("password123".to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, "test data").unwrap();
    let json = serde_json::to_string(&cipher).unwrap();
    let deserialized: wiredash_crypto::types::Cipher = serde_json::from_str(&json).unwrap();
    assert_eq!(cipher, deserialized);

    let decrypted = Decryption::decrypt(&deserialized, &key).unwrap();
    assert_eq!(decrypted, "test data");
}

// ===========================================================================
// app_lock_test (no DB required)
// ===========================================================================

#[test]
fn test_app_lock_hash_verify() {
    use wiredash_crypto::key::KeyUtils;
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;

    let password = "my_secure_password";
    let (key, salt) = KeyUtils::derive_key(password, None).unwrap();
    let hash = engine.encode(&key);
    let _salt_b64 = engine.encode(&salt);

    let (key2, _) = KeyUtils::derive_key(password, Some(&salt)).unwrap();
    let hash2 = engine.encode(&key2);
    assert_eq!(hash, hash2);

    let (key3, _) = KeyUtils::derive_key("wrong_password", Some(&salt)).unwrap();
    let hash3 = engine.encode(&key3);
    assert_ne!(hash, hash3);
}

// ===========================================================================
// task_tests
// ===========================================================================

mod task_tests {
    use wiredash_core::collections::tasks::Tasks;
    use wiredash_core::types::TaskItem;
    use wiredash_db::Database;

    #[tokio::test(flavor = "multi_thread")]
    async fn task_add_get_roundtrip() {
        let db = Database::open_memory().await.unwrap();
        let tasks = Tasks::new(&db);
        let task = TaskItem::new("My Task");
        let id = task.base.id.clone();
        tasks.add(&task).unwrap();
        let fetched = tasks.get(&id).unwrap().unwrap();
        assert_eq!(fetched.title, "My Task");
        assert_eq!(fetched.status, "open");
        assert_eq!(fetched.priority, "medium");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn task_list_excludes_deleted() {
        let db = Database::open_memory().await.unwrap();
        let tasks = Tasks::new(&db);
        let t1 = TaskItem::new("Visible");
        tasks.add(&t1).unwrap();
        let mut t2 = TaskItem::new("Hidden");
        t2.base.deleted = true;
        tasks.add(&t2).unwrap();
        let list = tasks.list(None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Visible");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn task_update_status() {
        let db = Database::open_memory().await.unwrap();
        let tasks = Tasks::new(&db);
        let task = TaskItem::new("Do thing");
        let id = task.base.id.clone();
        tasks.add(&task).unwrap();
        tasks.update_status(&id, "done").unwrap();
        let fetched = tasks.get(&id).unwrap().unwrap();
        assert_eq!(fetched.status, "done");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn task_remove() {
        let db = Database::open_memory().await.unwrap();
        let tasks = Tasks::new(&db);
        let task = TaskItem::new("Remove me");
        let id = task.base.id.clone();
        tasks.add(&task).unwrap();
        tasks.remove(&id).unwrap();
        assert!(tasks.get(&id).unwrap().is_none());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn task_list_by_status() {
        let db = Database::open_memory().await.unwrap();
        let tasks = Tasks::new(&db);
        let mut t1 = TaskItem::new("Open task");
        t1.status = "open".to_string();
        tasks.add(&t1).unwrap();
        let mut t2 = TaskItem::new("Done task");
        t2.status = "done".to_string();
        tasks.add(&t2).unwrap();
        let open = tasks.list_by_status("open").unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].title, "Open task");
    }
}

// ===========================================================================
// calendar_event_tests
// ===========================================================================

mod calendar_event_tests {
    use wiredash_core::collections::calendar_events::CalendarEvents;
    use wiredash_core::types::CalendarEvent;
    use wiredash_db::Database;

    #[tokio::test(flavor = "multi_thread")]
    async fn event_add_get_roundtrip() {
        let db = Database::open_memory().await.unwrap();
        let events = CalendarEvents::new(&db);
        let event = CalendarEvent::new("Team Standup", 1000, 2000);
        let id = event.base.id.clone();
        events.add(&event).unwrap();
        let fetched = events.get(&id).unwrap().unwrap();
        assert_eq!(fetched.title, "Team Standup");
        assert_eq!(fetched.start_date, 1000);
        assert_eq!(fetched.end_date, 2000);
        assert!(!fetched.all_day);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn event_list_excludes_deleted() {
        let db = Database::open_memory().await.unwrap();
        let events = CalendarEvents::new(&db);
        let e1 = CalendarEvent::new("Visible", 1000, 2000);
        events.add(&e1).unwrap();
        let mut e2 = CalendarEvent::new("Hidden", 3000, 4000);
        e2.base.deleted = true;
        events.add(&e2).unwrap();
        let list = events.list(None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Visible");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn event_list_in_range() {
        let db = Database::open_memory().await.unwrap();
        let events = CalendarEvents::new(&db);
        // Event from 1000..2000
        let e1 = CalendarEvent::new("Morning", 1000, 2000);
        events.add(&e1).unwrap();
        // Event from 3000..4000
        let e2 = CalendarEvent::new("Afternoon", 3000, 4000);
        events.add(&e2).unwrap();
        // Event from 5000..6000
        let e3 = CalendarEvent::new("Evening", 5000, 6000);
        events.add(&e3).unwrap();

        // Range 1500..3500 should match Morning (ends after 1500) and Afternoon (starts before 3500)
        let in_range = events.list_in_range(1500, 3500).unwrap();
        assert_eq!(in_range.len(), 2);
        let titles: Vec<&str> = in_range.iter().map(|e| e.title.as_str()).collect();
        assert!(titles.contains(&"Morning"));
        assert!(titles.contains(&"Afternoon"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn event_remove() {
        let db = Database::open_memory().await.unwrap();
        let events = CalendarEvents::new(&db);
        let event = CalendarEvent::new("Remove me", 1000, 2000);
        let id = event.base.id.clone();
        events.add(&event).unwrap();
        events.remove(&id).unwrap();
        assert!(events.get(&id).unwrap().is_none());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn event_list_sorted_by_start_date() {
        let db = Database::open_memory().await.unwrap();
        let events = CalendarEvents::new(&db);
        let e1 = CalendarEvent::new("Later", 5000, 6000);
        events.add(&e1).unwrap();
        let e2 = CalendarEvent::new("Earlier", 1000, 2000);
        events.add(&e2).unwrap();
        let list = events.list(None).unwrap();
        assert_eq!(list[0].title, "Earlier");
        assert_eq!(list[1].title, "Later");
    }
}

// ===========================================================================
// agent_tests
// ===========================================================================

mod agent_tests {
    use wiredash_core::collections::agents::Agents;
    use wiredash_core::types::Agent;
    use wiredash_db::Database;

    #[tokio::test(flavor = "multi_thread")]
    async fn agent_add_get_roundtrip() {
        let db = Database::open_memory().await.unwrap();
        let agents = Agents::new(&db);
        let agent = Agent::new("Orchestrator", "coordinator");
        let id = agent.base.id.clone();
        agents.add(&agent).unwrap();
        let fetched = agents.get(&id).unwrap().unwrap();
        assert_eq!(fetched.name, "Orchestrator");
        assert_eq!(fetched.role, "coordinator");
        assert_eq!(fetched.status, "idle");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn agent_list_excludes_deleted() {
        let db = Database::open_memory().await.unwrap();
        let agents = Agents::new(&db);
        let a1 = Agent::new("Active", "worker");
        agents.add(&a1).unwrap();
        let mut a2 = Agent::new("Removed", "worker");
        a2.base.deleted = true;
        agents.add(&a2).unwrap();
        let list = agents.list(None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Active");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn agent_update_status() {
        let db = Database::open_memory().await.unwrap();
        let agents = Agents::new(&db);
        let agent = Agent::new("Worker", "task_runner");
        let id = agent.base.id.clone();
        agents.add(&agent).unwrap();
        agents.update_status(&id, "busy").unwrap();
        let fetched = agents.get(&id).unwrap().unwrap();
        assert_eq!(fetched.status, "busy");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn agent_remove() {
        let db = Database::open_memory().await.unwrap();
        let agents = Agents::new(&db);
        let agent = Agent::new("Temp", "temp_role");
        let id = agent.base.id.clone();
        agents.add(&agent).unwrap();
        agents.remove(&id).unwrap();
        assert!(agents.get(&id).unwrap().is_none());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn agent_list_with_limit() {
        let db = Database::open_memory().await.unwrap();
        let agents = Agents::new(&db);
        agents.add(&Agent::new("Alpha", "role_a")).unwrap();
        agents.add(&Agent::new("Beta", "role_b")).unwrap();
        agents.add(&Agent::new("Gamma", "role_c")).unwrap();
        let list = agents.list(Some(2)).unwrap();
        assert_eq!(list.len(), 2);
    }
}
