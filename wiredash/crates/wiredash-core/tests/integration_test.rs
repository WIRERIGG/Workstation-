use wiredash_core::collections::*;
use wiredash_core::types::*;
use wiredash_crypto::encryption::{Decryption, Encryption};
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

#[test]
fn test_full_note_lifecycle() {
    // -----------------------------------------------------------------------
    // 1. Open in-memory database
    // -----------------------------------------------------------------------
    let db = Database::open_memory().unwrap();

    // -----------------------------------------------------------------------
    // 2. Create a note
    // -----------------------------------------------------------------------
    let note_col = notes::Notes::new(&db);

    let mut note = Note::new("Meeting Notes");
    note.headline = Some("Q1 planning".into());
    let note_id = note.base.id.clone();

    note_col.add(&note).unwrap();

    // Verify the note was persisted
    let fetched = note_col.get(&note_id).unwrap().expect("note should exist");
    assert_eq!(fetched.title, "Meeting Notes");
    assert_eq!(fetched.headline.as_deref(), Some("Q1 planning"));
    assert!(!fetched.base.deleted);

    // -----------------------------------------------------------------------
    // 3. Add content for the note
    // -----------------------------------------------------------------------
    let content_col = content::Content::new(&db);

    let mut content_item = ContentItem::new();
    content_item.note_id = Some(note_id.clone());
    content_item.data = Some("<p>Discussed roadmap</p>".into());
    let content_id = content_item.base.id.clone();

    content_col.add(&content_item).unwrap();

    let fetched_content = content_col.get(&content_id).unwrap().expect("content should exist");
    assert_eq!(fetched_content.note_id.as_deref(), Some(note_id.as_str()));
    assert_eq!(fetched_content.data.as_deref(), Some("<p>Discussed roadmap</p>"));

    // Also verify find_by_note_id works
    let by_note = content_col.find_by_note_id(&note_id).unwrap().expect("content by noteId");
    assert_eq!(by_note.base.id, content_id);

    // -----------------------------------------------------------------------
    // 4. Tag the note
    // -----------------------------------------------------------------------
    let tags_col = tags::Tags::new(&db);

    let tag = Tag::new("work");
    let tag_id = tag.base.id.clone();
    tags_col.add(&tag).unwrap();

    // Verify tag was stored
    let fetched_tag = tags_col.get(&tag_id).unwrap().expect("tag should exist");
    assert_eq!(fetched_tag.title, "work");

    // Create a relation: note -> tag
    let rels = relations::Relations::new(&db);
    rels.add("note", &note_id, "tag", &tag_id).unwrap();

    // -----------------------------------------------------------------------
    // 5. Put the note in a notebook
    // -----------------------------------------------------------------------
    let nbs = notebooks::Notebooks::new(&db);

    let mut nb = Notebook::new("Work");
    nb.description = Some("Work-related notes".into());
    let nb_id = nb.base.id.clone();
    nbs.add(&nb).unwrap();

    // Verify notebook was stored
    let fetched_nb = nbs.get(&nb_id).unwrap().expect("notebook should exist");
    assert_eq!(fetched_nb.title, "Work");
    assert_eq!(fetched_nb.description.as_deref(), Some("Work-related notes"));

    // Create a relation: notebook -> note
    rels.add("notebook", &nb_id, "note", &note_id).unwrap();

    // -----------------------------------------------------------------------
    // 6. Verify relations work both directions
    // -----------------------------------------------------------------------
    let note_tags = rels.from_ids("note", &note_id, "tag").unwrap();
    assert_eq!(note_tags.len(), 1);
    assert_eq!(note_tags[0], tag_id);

    let nb_notes = rels.from_ids("notebook", &nb_id, "note").unwrap();
    assert_eq!(nb_notes.len(), 1);
    assert_eq!(nb_notes[0], note_id);

    // Reverse lookup: which notebooks contain this note?
    let containing_nbs = rels.to_ids("notebook", "note", &note_id).unwrap();
    assert_eq!(containing_nbs.len(), 1);
    assert_eq!(containing_nbs[0], nb_id);

    // -----------------------------------------------------------------------
    // 7. Search for the note (FTS5)
    // -----------------------------------------------------------------------
    let search_col = search::Search::new(&db);

    // The note is already in the notes table (from step 2), but we need to
    // rebuild the FTS index so it picks up the title.
    search_col.index_note(&note_id, "Meeting Notes").unwrap();

    let results = search_col.search_notes("meeting").unwrap();
    assert_eq!(results.len(), 1, "should find exactly one note for 'meeting'");
    assert_eq!(results[0], note_id);

    // Negative search — nothing should match
    let empty = search_col.search_notes("zzzznotfound").unwrap();
    assert!(empty.is_empty(), "no results for nonsense query");

    // -----------------------------------------------------------------------
    // 8. Encrypt and decrypt content (verify crypto end-to-end)
    // -----------------------------------------------------------------------
    let key = SerializedKey {
        password: Some("vault-password".into()),
        key: None,
        salt: None,
    };
    let plaintext = "<p>Discussed roadmap for Q1</p>";

    let cipher = Encryption::encrypt(&key, plaintext).unwrap();

    // Verify cipher envelope fields
    assert_eq!(cipher.format, "base64");
    assert_eq!(cipher.alg, "xcha-argon2i13-7");
    assert_eq!(cipher.length, plaintext.len());
    assert!(!cipher.cipher.is_empty(), "ciphertext must be non-empty");
    assert!(!cipher.iv.is_empty(), "IV must be non-empty");
    assert!(!cipher.salt.is_empty(), "salt must be non-empty");

    // Decrypt using the same password + the cipher's embedded salt
    let decrypt_key = SerializedKey {
        password: Some("vault-password".into()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let decrypted = Decryption::decrypt(&cipher, &decrypt_key).unwrap();
    assert_eq!(decrypted, plaintext);

    // Verify wrong password fails
    let wrong_key = SerializedKey {
        password: Some("wrong-password".into()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    assert!(
        Decryption::decrypt(&cipher, &wrong_key).is_err(),
        "decryption with wrong password should fail"
    );

    // -----------------------------------------------------------------------
    // 9. Settings round-trip
    // -----------------------------------------------------------------------
    let settings_col = settings::Settings::new(&db);

    settings_col
        .set("titleFormat", &serde_json::json!("Note $date$ $time$"))
        .unwrap();

    let format = settings_col
        .get_setting("titleFormat")
        .unwrap()
        .expect("setting should exist");
    assert_eq!(format, serde_json::json!("Note $date$ $time$"));

    // Overwrite and verify
    settings_col
        .set("titleFormat", &serde_json::json!("Updated $date$"))
        .unwrap();
    let updated = settings_col
        .get_setting("titleFormat")
        .unwrap()
        .expect("updated setting should exist");
    assert_eq!(updated, serde_json::json!("Updated $date$"));

    // Non-existent key returns None
    let missing = settings_col.get_setting("nonExistentKey").unwrap();
    assert!(missing.is_none(), "missing key should return None");

    // -----------------------------------------------------------------------
    // 10. Trash the note
    // -----------------------------------------------------------------------
    note_col.move_to_trash(&note_id).unwrap();

    // Active list should be empty
    let active = note_col.list(None).unwrap();
    assert_eq!(active.len(), 0, "no active notes after trashing");

    // Trashed list should contain our note
    let trashed = note_col.trashed().unwrap();
    assert_eq!(trashed.len(), 1, "exactly one trashed note");
    assert_eq!(trashed[0].base.id, note_id);
    assert!(trashed[0].base.deleted, "trashed note should have deleted=true");
    assert_eq!(
        trashed[0].trash.item_type.as_deref(),
        Some("note"),
        "trash metadata should record original type"
    );

    // -----------------------------------------------------------------------
    // 11. Hard delete
    // -----------------------------------------------------------------------
    note_col.remove(&note_id).unwrap();

    assert!(
        note_col.get(&note_id).unwrap().is_none(),
        "note should be gone after hard delete"
    );

    // Trashed list should now also be empty
    let trashed_after = note_col.trashed().unwrap();
    assert_eq!(trashed_after.len(), 0, "no trashed notes after hard delete");

    // Relations that pointed to the note should still exist (no cascade)
    // — this is by-design; the application layer cleans up relations separately
    let orphan_tags = rels.from_ids("note", &note_id, "tag").unwrap();
    assert_eq!(orphan_tags.len(), 1, "relation survives note deletion");
}
