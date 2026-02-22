//! Unit tests for the wiredash-editor public API.

use wiredash_editor::{
    toolbar_actions, EditorMessage, EditorMode, EditorState, TOOLBAR_ACTIONS,
};

// ---------------------------------------------------------------------------
// 1. EditorState::new() defaults
// ---------------------------------------------------------------------------

#[test]
fn test_new_editor_defaults() {
    let state = EditorState::new();

    // A fresh editor has only a trailing newline (iced text_editor always ends with '\n').
    let text = state.text();
    assert!(
        text.is_empty() || text == "\n",
        "Expected empty or single newline, got {:?}",
        text
    );

    assert!(!state.dirty, "New editor should not be dirty");
    assert_eq!(state.mode, EditorMode::Edit, "Default mode should be Edit");
    assert!(state.note_id.is_none(), "New editor should have no note_id");
    assert_eq!(state.content_id, 0, "Initial content_id should be 0");
}

// ---------------------------------------------------------------------------
// 2. EditorState::with_content() loads text
// ---------------------------------------------------------------------------

#[test]
fn test_with_content_loads_text() {
    let state = EditorState::with_content("# Hello");

    let text = state.text();
    assert!(
        text.contains("# Hello"),
        "Editor text should contain the loaded content, got {:?}",
        text
    );

    assert!(
        !state.preview_items.is_empty(),
        "Preview items should be populated for markdown content"
    );

    assert!(!state.dirty, "with_content should not mark dirty");
}

// ---------------------------------------------------------------------------
// 3. InsertSnippet marks dirty and inserts text
// ---------------------------------------------------------------------------

#[test]
fn test_insert_snippet_marks_dirty() {
    let mut state = EditorState::new();
    assert!(!state.dirty);

    state.update(EditorMessage::InsertSnippet("**bold**".into()));

    assert!(state.dirty, "InsertSnippet should mark the editor dirty");
    assert!(
        state.text().contains("**bold**"),
        "Inserted snippet should appear in the text, got {:?}",
        state.text()
    );
    assert!(
        state.content_id > 0,
        "content_id should increment after edit"
    );
}

// ---------------------------------------------------------------------------
// 4. Mode cycling: Edit -> Split -> Preview -> Edit
// ---------------------------------------------------------------------------

#[test]
fn test_cycle_mode() {
    assert_eq!(EditorMode::Edit.cycle(), EditorMode::Split);
    assert_eq!(EditorMode::Split.cycle(), EditorMode::Preview);
    assert_eq!(EditorMode::Preview.cycle(), EditorMode::Edit);

    // Also test via EditorState::update
    let mut state = EditorState::new();
    assert_eq!(state.mode, EditorMode::Edit);

    state.update(EditorMessage::CycleMode);
    assert_eq!(state.mode, EditorMode::Split);

    state.update(EditorMessage::CycleMode);
    assert_eq!(state.mode, EditorMode::Preview);

    state.update(EditorMessage::CycleMode);
    assert_eq!(state.mode, EditorMode::Edit);
}

// ---------------------------------------------------------------------------
// 5. SetMode changes mode directly
// ---------------------------------------------------------------------------

#[test]
fn test_set_mode() {
    let mut state = EditorState::new();
    assert_eq!(state.mode, EditorMode::Edit);

    state.update(EditorMessage::SetMode(EditorMode::Preview));
    assert_eq!(state.mode, EditorMode::Preview);

    state.update(EditorMessage::SetMode(EditorMode::Split));
    assert_eq!(state.mode, EditorMode::Split);

    state.update(EditorMessage::SetMode(EditorMode::Edit));
    assert_eq!(state.mode, EditorMode::Edit);
}

// ---------------------------------------------------------------------------
// 6. mark_saved clears dirty flag
// ---------------------------------------------------------------------------

#[test]
fn test_mark_saved() {
    let mut state = EditorState::new();

    // Make the editor dirty by inserting a snippet
    state.update(EditorMessage::InsertSnippet("some text".into()));
    assert!(state.dirty, "Should be dirty after insert");

    state.mark_saved();
    assert!(!state.dirty, "mark_saved should clear the dirty flag");
}

// ---------------------------------------------------------------------------
// 7. All toolbar actions produce non-empty snippets
// ---------------------------------------------------------------------------

#[test]
fn test_toolbar_actions_have_snippets() {
    let actions = toolbar_actions();
    assert!(!actions.is_empty(), "toolbar_actions() should not be empty");

    for action in &actions {
        let snippet = action.snippet();
        assert!(
            !snippet.is_empty(),
            "ToolbarAction {:?} should produce a non-empty snippet",
            action
        );
    }
}

// ---------------------------------------------------------------------------
// 8. All toolbar actions have non-empty labels and tooltip text
// ---------------------------------------------------------------------------

#[test]
fn test_toolbar_actions_have_labels() {
    let actions = toolbar_actions();

    for action in &actions {
        let label = action.label();
        assert!(
            !label.is_empty(),
            "ToolbarAction {:?} should have a non-empty label",
            action
        );

        let tooltip = action.tooltip_text();
        assert!(
            !tooltip.is_empty(),
            "ToolbarAction {:?} should have non-empty tooltip text",
            action
        );
    }

    // Also verify the static TOOLBAR_ACTIONS slice is consistent
    assert_eq!(
        TOOLBAR_ACTIONS.len(),
        actions.len(),
        "TOOLBAR_ACTIONS length should match toolbar_actions() count"
    );

    for label in TOOLBAR_ACTIONS {
        assert!(
            !label.is_empty(),
            "Static TOOLBAR_ACTIONS should not contain empty strings"
        );
    }
}
