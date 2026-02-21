use wiredash_core::types::*;

#[test]
fn test_note_serialization_roundtrip() {
    let note = Note::new("Test Note");

    // Serialize to JSON
    let json = serde_json::to_string(&note).expect("serialize note");

    // Deserialize back
    let restored: Note = serde_json::from_str(&json).expect("deserialize note");

    // All fields must match
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

    // Verify camelCase keys appear in serialized JSON
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

    // Each call generates a different UUID
    assert_ne!(a.id, b.id);

    // item_type is set correctly
    assert_eq!(a.item_type, "note");
    assert_eq!(b.item_type, "notebook");

    // Timestamps are positive (milliseconds since epoch)
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
