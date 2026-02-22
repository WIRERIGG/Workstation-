# WIREDASH Phase 4 — Markdown Editor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split-pane markdown editor that loads notes from the database, edits them with syntax highlighting, and shows a live rendered preview — connected to wiredash-core's Notes + Content collections.

**Architecture:** A new `wiredash-editor` library crate wrapping iced 0.14's `text_editor` (edit pane) + `markdown` widget (preview pane) inside a `PaneGrid`. The app crate connects the editor to the database, adds a note list sidebar, and a markdown toolbar.

**Tech Stack:** iced 0.14 (`markdown`, `highlighter` features), wiredash-core, wiredash-db

**Key Discovery:** iced 0.14 has a **built-in `markdown` module** (`iced::widget::markdown`) with `parse()` and `view()` functions. This eliminates the need for pulldown-cmark + custom renderer. The built-in widget handles headings, paragraphs, code blocks (with syntax highlighting via `highlighter` feature), lists, tables, links, rules, and quotes.

---

## Pre-existing Code Reference

**wiredash-core collections already built:**
- `Notes::new(db)` → `add`, `get`, `list(limit)`, `update_title`, `set_pinned`, `set_favorite`, `move_to_trash`, `remove`
- `Content::new(db)` → `add`, `get`, `find_by_note_id`, `update_data`, `remove`
- `Search::new(db)` → `index_note`, `index_content`, `search_notes`, `search_content`
- Types: `Note { base, title, headline, content_id, pinned, favorite, ... }`, `ContentItem { base, note_id, data, ... }`
- `BaseItem::new("note")` generates UUID + timestamps

**wiredash-app current state:**
- `main.rs`: `struct Wiredash { current_view, sidebar_collapsed, theme_engine }`
- `navigation.rs`: `View::Notes` already exists, content area shows placeholder text
- `config.rs`: `AppConfig` with `data_dir()` already stubbed (`#[allow(dead_code)]`)

**iced 0.14 APIs we'll use:**
- `text_editor::Content` + `text_editor(&content).on_action(Msg).highlight("markdown", theme)` — edit pane
- `markdown::parse(text)` → `Vec<markdown::Item>`, `markdown::view(&items, theme)` → `Element` — preview pane
- `pane_grid::State<PaneKind>` + `pane_grid(&state, |pane, kind, _| ...)` — split layout
- `text_editor::Action` + `content.perform(action)` — handle edits
- `text_editor::Content::with_text(text)` — load existing content

**iced features needed:** Add `"markdown"` and `"highlighter"` to the iced dependency features list.

---

## Task 1: Create `wiredash-editor` crate scaffold

**Files:**
- Create: `wiredash/crates/wiredash-editor/Cargo.toml`
- Create: `wiredash/crates/wiredash-editor/src/lib.rs`
- Modify: `wiredash/Cargo.toml` (add to workspace members)
- Modify: `wiredash/crates/wiredash-app/Cargo.toml` (add dependency + iced features)

**Step 1: Create Cargo.toml for wiredash-editor**

```toml
[package]
name = "wiredash-editor"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
iced = { version = "0.14", features = ["markdown", "highlighter"] }
serde = { workspace = true }
serde_json = { workspace = true }
```

**Step 2: Create minimal lib.rs**

```rust
mod editor;
mod toolbar;

pub use editor::{EditorState, EditorMessage, EditorMode};
pub use toolbar::{ToolbarAction};
```

This will fail to compile (modules don't exist yet). That's expected — we create the actual modules in Tasks 2-4.

**Step 3: Add to workspace Cargo.toml**

Add `"crates/wiredash-editor"` to the `members` array.

**Step 4: Update wiredash-app Cargo.toml**

Add dependency:
```toml
wiredash-editor = { path = "../wiredash-editor" }
```

Change iced features from `["svg", "tokio"]` to `["svg", "tokio", "markdown", "highlighter"]`.

**Step 5: Commit**

```
desktop: scaffold wiredash-editor crate
```

---

## Task 2: Implement editor state and core logic (`editor.rs`)

**Files:**
- Create: `wiredash/crates/wiredash-editor/src/editor.rs`

This is the core module — `EditorState` holds the text content, parsed markdown items, editor mode, and dirty flag. No iced rendering here — just state and update logic.

**Step 1: Write editor.rs**

```rust
use iced::widget::{markdown, text_editor};

/// Editor display mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorMode {
    Edit,
    Preview,
    Split,
}

/// All messages the editor can produce.
#[derive(Debug, Clone)]
pub enum EditorMessage {
    /// User typed or moved cursor in the text editor.
    Edit(text_editor::Action),
    /// User clicked a link in the markdown preview.
    LinkClicked(markdown::Uri),
    /// Switch editor mode.
    SetMode(EditorMode),
    /// Cycle to next mode: Edit → Split → Preview → Edit.
    CycleMode,
    /// Insert text at cursor position (from toolbar).
    InsertSnippet(String),
}

/// Core editor state. Owns the text content and parsed markdown items.
pub struct EditorState {
    /// The raw text content for iced's text_editor widget.
    pub content: text_editor::Content,
    /// Parsed markdown items for the preview pane.
    pub preview_items: Vec<markdown::Item>,
    /// Current display mode.
    pub mode: EditorMode,
    /// Whether the content has been modified since last save.
    pub dirty: bool,
    /// The note ID currently being edited (None = new unsaved note).
    pub note_id: Option<String>,
    /// The content ID in the database (None = new unsaved note).
    pub content_id: Option<String>,
}

impl EditorState {
    /// Create an empty editor for a new note.
    pub fn new() -> Self {
        let content = text_editor::Content::new();
        Self {
            content,
            preview_items: Vec::new(),
            mode: EditorMode::Split,
            dirty: false,
            note_id: None,
            content_id: None,
        }
    }

    /// Create an editor with existing content (loading a note).
    pub fn with_content(text: &str, note_id: String, content_id: String) -> Self {
        let content = text_editor::Content::with_text(text);
        let preview_items: Vec<markdown::Item> = markdown::parse(text).collect();
        Self {
            content,
            preview_items,
            mode: EditorMode::Split,
            dirty: false,
            note_id: Some(note_id),
            content_id: Some(content_id),
        }
    }

    /// Get the current raw text from the editor.
    pub fn text(&self) -> String {
        self.content.text()
    }

    /// Handle an editor message. Returns true if the text content changed
    /// (caller should trigger a save).
    pub fn update(&mut self, message: EditorMessage) -> bool {
        match message {
            EditorMessage::Edit(action) => {
                let is_edit = action.is_edit();
                self.content.perform(action);
                if is_edit {
                    self.dirty = true;
                    // Re-parse markdown for preview
                    let text = self.content.text();
                    self.preview_items = markdown::parse(&text).collect();
                }
                is_edit
            }
            EditorMessage::LinkClicked(url) => {
                let _ = open::that(url);
                false
            }
            EditorMessage::SetMode(mode) => {
                self.mode = mode;
                false
            }
            EditorMessage::CycleMode => {
                self.mode = match self.mode {
                    EditorMode::Edit => EditorMode::Split,
                    EditorMode::Split => EditorMode::Preview,
                    EditorMode::Preview => EditorMode::Edit,
                };
                false
            }
            EditorMessage::InsertSnippet(snippet) => {
                // Insert snippet by performing individual edit actions
                // For now, we use the Action::Edit variant — iced 0.14's
                // text_editor::Action::Edit(Edit::Paste(Arc<String>))
                use std::sync::Arc;
                self.content.perform(
                    text_editor::Action::Edit(text_editor::Edit::Paste(Arc::new(snippet)))
                );
                self.dirty = true;
                let text = self.content.text();
                self.preview_items = markdown::parse(&text).collect();
                true
            }
        }
    }

    /// Mark as saved (clear dirty flag).
    pub fn mark_saved(&mut self) {
        self.dirty = false;
    }
}

impl Default for EditorState {
    fn default() -> Self {
        Self::new()
    }
}
```

**Step 2: Verify it compiles**

```bash
cd wiredash && cargo check -p wiredash-editor
```

**Step 3: Commit**

```
desktop: implement wiredash-editor core state and update logic
```

---

## Task 3: Implement toolbar actions (`toolbar.rs`)

**Files:**
- Create: `wiredash/crates/wiredash-editor/src/toolbar.rs`

The toolbar module defines markdown formatting snippets and provides a view function that renders toolbar buttons.

**Step 1: Write toolbar.rs**

```rust
use iced::widget::{button, row, text, tooltip};
use iced::{Element, Theme, Length};

use crate::editor::{EditorMessage, EditorMode};

/// Toolbar action descriptions for markdown formatting.
#[derive(Debug, Clone)]
pub enum ToolbarAction {
    Bold,
    Italic,
    Strikethrough,
    Heading(u8),       // 1-6
    Link,
    Image,
    Code,
    CodeBlock,
    Quote,
    BulletList,
    NumberedList,
    HorizontalRule,
    Table,
}

impl ToolbarAction {
    /// The text snippet to insert at cursor.
    pub fn snippet(&self) -> String {
        match self {
            Self::Bold => "**bold**".into(),
            Self::Italic => "*italic*".into(),
            Self::Strikethrough => "~~strikethrough~~".into(),
            Self::Heading(n) => {
                let hashes = "#".repeat(*n as usize);
                format!("{hashes} ")
            }
            Self::Link => "[text](url)".into(),
            Self::Image => "![alt](url)".into(),
            Self::Code => "`code`".into(),
            Self::CodeBlock => "```\n\n```".into(),
            Self::Quote => "> ".into(),
            Self::BulletList => "- ".into(),
            Self::NumberedList => "1. ".into(),
            Self::HorizontalRule => "\n---\n".into(),
            Self::Table => "| Header | Header |\n|--------|--------|\n| Cell   | Cell   |".into(),
        }
    }

    /// Short label for the toolbar button.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Bold => "B",
            Self::Italic => "I",
            Self::Strikethrough => "S",
            Self::Heading(1) => "H1",
            Self::Heading(2) => "H2",
            Self::Heading(3) => "H3",
            Self::Heading(_) => "H",
            Self::Link => "\u{1F517}",       // link emoji
            Self::Image => "\u{1F5BC}",      // image emoji
            Self::Code => "</>",
            Self::CodeBlock => "{ }",
            Self::Quote => "\u{201C}",       // left double quote
            Self::BulletList => "\u{2022}",  // bullet
            Self::NumberedList => "1.",
            Self::HorizontalRule => "\u{2500}", // horizontal line
            Self::Table => "\u{2637}",       // trigram
        }
    }

    /// Tooltip description.
    pub fn tooltip_text(&self) -> &'static str {
        match self {
            Self::Bold => "Bold (Ctrl+B)",
            Self::Italic => "Italic (Ctrl+I)",
            Self::Strikethrough => "Strikethrough",
            Self::Heading(n) => match n {
                1 => "Heading 1",
                2 => "Heading 2",
                3 => "Heading 3",
                _ => "Heading",
            },
            Self::Link => "Insert Link",
            Self::Image => "Insert Image",
            Self::Code => "Inline Code",
            Self::CodeBlock => "Code Block",
            Self::Quote => "Blockquote",
            Self::BulletList => "Bullet List",
            Self::NumberedList => "Numbered List",
            Self::HorizontalRule => "Horizontal Rule",
            Self::Table => "Table",
        }
    }
}

/// Standard toolbar actions in display order.
pub const TOOLBAR_ACTIONS: &[ToolbarAction] = &[
    ToolbarAction::Bold,
    ToolbarAction::Italic,
    ToolbarAction::Strikethrough,
    ToolbarAction::Heading(1),
    ToolbarAction::Heading(2),
    ToolbarAction::Heading(3),
    ToolbarAction::Link,
    ToolbarAction::Image,
    ToolbarAction::Code,
    ToolbarAction::CodeBlock,
    ToolbarAction::Quote,
    ToolbarAction::BulletList,
    ToolbarAction::NumberedList,
    ToolbarAction::HorizontalRule,
    ToolbarAction::Table,
];

/// Render the markdown toolbar as a row of buttons.
/// The `on_action` callback maps toolbar actions to the parent's message type.
/// The `on_mode` callback maps mode changes to the parent's message type.
pub fn toolbar_view<'a, Msg: Clone + 'a>(
    current_mode: EditorMode,
    on_action: impl Fn(ToolbarAction) -> Msg + 'a,
    on_mode: impl Fn(EditorMode) -> Msg + 'a,
) -> Element<'a, Msg> {
    let mut items: Vec<Element<'a, Msg>> = Vec::new();

    // Formatting buttons
    for action in TOOLBAR_ACTIONS {
        let action_clone = action.clone();
        let msg = on_action(action_clone);
        items.push(
            tooltip(
                button(text(action.label()).size(12))
                    .on_press(msg)
                    .padding([4, 8])
                    .style(button::text),
                action.tooltip_text(),
                tooltip::Position::Bottom,
            )
            .into(),
        );
    }

    // Separator
    items.push(
        iced::widget::rule::vertical(1).into(),
    );

    // Mode toggle buttons
    let modes = [
        (EditorMode::Edit, "Edit"),
        (EditorMode::Split, "Split"),
        (EditorMode::Preview, "Preview"),
    ];
    for (mode, label) in modes {
        let is_active = mode == current_mode;
        let msg = on_mode(mode);
        items.push(
            button(text(label).size(11))
                .on_press(msg)
                .padding([4, 8])
                .style(move |theme: &Theme, status| {
                    let mut style = button::text(theme, status);
                    if is_active {
                        style.background = Some(iced::Background::Color(
                            iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.15),
                        ));
                    }
                    style
                })
                .into(),
        );
    }

    row(items).spacing(2).width(Length::Fill).into()
}
```

**Step 2: Update lib.rs exports**

```rust
mod editor;
mod toolbar;

pub use editor::{EditorState, EditorMessage, EditorMode};
pub use toolbar::{ToolbarAction, toolbar_view, TOOLBAR_ACTIONS};
```

**Step 3: Verify it compiles**

```bash
cd wiredash && cargo check -p wiredash-editor
```

**Step 4: Commit**

```
desktop: add markdown toolbar with formatting snippets
```

---

## Task 4: Add editor view functions to wiredash-editor

**Files:**
- Create: `wiredash/crates/wiredash-editor/src/view.rs`
- Modify: `wiredash/crates/wiredash-editor/src/lib.rs`

This module provides `editor_view()` — the full split-pane editor widget that the app crate calls.

**Step 1: Write view.rs**

```rust
use iced::widget::{column, container, markdown, pane_grid, row, scrollable, text, text_editor};
use iced::{Element, Fill, Length, Theme};

use crate::editor::{EditorMessage, EditorMode, EditorState};
use crate::toolbar::{self, ToolbarAction};

/// Pane types for the split view.
#[derive(Debug, Clone, Copy)]
enum PaneKind {
    Editor,
    Preview,
}

/// Render the full editor widget: toolbar + pane(s).
/// `map_msg` converts `EditorMessage` to the caller's message type.
pub fn editor_view<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    theme: &Theme,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    let toolbar = toolbar::toolbar_view(
        state.mode,
        move |action: ToolbarAction| map_msg(EditorMessage::InsertSnippet(action.snippet())),
        move |mode| map_msg(EditorMessage::SetMode(mode)),
    );

    let content_area: Element<'a, Msg> = match state.mode {
        EditorMode::Edit => edit_pane(state, theme, map_msg).into(),
        EditorMode::Preview => preview_pane(state, theme, map_msg).into(),
        EditorMode::Split => split_pane(state, theme, map_msg).into(),
    };

    let dirty_indicator = if state.dirty { " (unsaved)" } else { "" };
    let status = text(format!(
        "{}{}",
        match state.mode {
            EditorMode::Edit => "Edit",
            EditorMode::Split => "Split",
            EditorMode::Preview => "Preview",
        },
        dirty_indicator,
    ))
    .size(10);

    column![
        container(toolbar).padding([4, 8]),
        content_area,
        container(status).padding([2, 8]),
    ]
    .spacing(0)
    .height(Fill)
    .into()
}

/// The raw text editor pane.
fn edit_pane<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    _theme: &Theme,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    text_editor(&state.content)
        .placeholder("Start writing markdown...")
        .on_action(move |action| map_msg(EditorMessage::Edit(action)))
        .highlight("markdown", iced::highlighter::Theme::SolarizedDark)
        .padding(16)
        .height(Fill)
        .into()
}

/// The rendered markdown preview pane.
fn preview_pane<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    theme: &Theme,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    if state.preview_items.is_empty() {
        return container(
            text("Nothing to preview. Start writing!").size(14),
        )
        .padding(24)
        .width(Fill)
        .height(Fill)
        .into();
    }

    let md_view: Element<'a, String> = markdown::view(
        &state.preview_items,
        markdown::Settings::default(),
    )
    .into();

    // markdown::view produces Element<String> (link URLs).
    // Map String -> Msg via LinkClicked.
    let mapped: Element<'a, Msg> = md_view.map(move |url| {
        map_msg(EditorMessage::LinkClicked(url))
    });

    container(scrollable(mapped))
        .padding(16)
        .width(Fill)
        .height(Fill)
        .into()
}

/// Side-by-side edit + preview.
fn split_pane<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    theme: &Theme,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    // Simple 50/50 split using a row instead of PaneGrid
    // (PaneGrid requires owned State which complicates the borrowing;
    //  a row with two Fill-width containers achieves the same visual)
    row![
        container(edit_pane(state, theme, map_msg))
            .width(Fill)
            .height(Fill)
            .style(|theme: &Theme| {
                let palette = theme.extended_palette();
                container::Style {
                    border: iced::Border {
                        width: 1.0,
                        color: palette.background.strong.color,
                        ..Default::default()
                    },
                    ..Default::default()
                }
            }),
        container(preview_pane(state, theme, map_msg))
            .width(Fill)
            .height(Fill),
    ]
    .spacing(1)
    .height(Fill)
    .into()
}
```

**Step 2: Update lib.rs**

```rust
mod editor;
mod toolbar;
mod view;

pub use editor::{EditorState, EditorMessage, EditorMode};
pub use toolbar::{ToolbarAction, toolbar_view, TOOLBAR_ACTIONS};
pub use view::editor_view;
```

**Step 3: Verify it compiles**

```bash
cd wiredash && cargo check -p wiredash-editor
```

Note: The `iced::highlighter::Theme` path and `markdown::Settings::default()` may need adjustment based on actual iced 0.14 API. If `iced::highlighter` is not directly available, use `iced::widget::text_editor`'s `.highlight("markdown", iced::highlighter::Theme::SolarizedDark)` which is gated behind the `highlighter` feature. If the exact path differs, check `cargo doc -p iced --open` for the correct import.

**Step 4: Commit**

```
desktop: add split-pane editor view with markdown preview
```

---

## Task 5: Connect database to wiredash-app

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs`
- Modify: `wiredash/crates/wiredash-app/src/config.rs`

Currently the app has no database connection. This task opens the SQLite database on startup using `AppConfig::data_dir()` and stores it in the `Wiredash` struct.

**Step 1: Update main.rs — add Database to Wiredash struct**

Add to the struct:

```rust
use wiredash_db::Database;

struct Wiredash {
    current_view: View,
    sidebar_collapsed: bool,
    theme_engine: ThemeEngine,
    db: Database,
}
```

**Step 2: Update Wiredash::new() to open the database**

In `new()`, after loading config:

```rust
let db_path = config::AppConfig::data_dir()
    .unwrap_or_else(|| std::path::PathBuf::from("."))
    .join("wiredash.db");

// Ensure the data directory exists
if let Some(parent) = db_path.parent() {
    let _ = std::fs::create_dir_all(parent);
}

let db = Database::open(
    db_path.to_str().unwrap_or("wiredash.db"),
    None, // No encryption password for now
).expect("Failed to open database");
```

Then include `db` in the `Self { ... }` constructor.

**Step 3: Verify it compiles**

```bash
cd wiredash && cargo check -p wiredash-app
```

**Step 4: Commit**

```
desktop: connect SQLite database on app startup
```

---

## Task 6: Implement the Notes view with editor

**Files:**
- Create: `wiredash/crates/wiredash-app/src/notes_view.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs`

This is the main integration task. When `View::Notes` is selected, the content area shows a note list on the left and the markdown editor on the right.

**Step 1: Create notes_view.rs**

```rust
use iced::widget::{button, column, container, row, scrollable, text, rule};
use iced::{Element, Fill, Theme};
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::content::Content;
use wiredash_core::types::{BaseItem, Note, ContentItem, TrashMeta};
use wiredash_db::Database;
use wiredash_editor::{EditorState, EditorMessage, editor_view};

/// State for the Notes view.
pub struct NotesViewState {
    /// Summary list of notes (id, title, date).
    pub note_list: Vec<NoteSummary>,
    /// Currently selected note index.
    pub selected_index: Option<usize>,
    /// The markdown editor state.
    pub editor: EditorState,
}

/// Lightweight note summary for the list.
#[derive(Debug, Clone)]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub date_modified: i64,
    pub pinned: bool,
    pub favorite: bool,
}

/// Messages produced by the Notes view.
#[derive(Debug, Clone)]
pub enum NotesMessage {
    /// Select a note from the list.
    SelectNote(usize),
    /// Create a new note.
    NewNote,
    /// Editor message (forwarded to EditorState).
    Editor(EditorMessage),
    /// Save the current note to the database.
    SaveNote,
}

impl NotesViewState {
    pub fn new() -> Self {
        Self {
            note_list: Vec::new(),
            selected_index: None,
            editor: EditorState::new(),
        }
    }

    /// Load note list from the database.
    pub fn refresh_list(&mut self, db: &Database) {
        let notes_coll = Notes::new(db);
        match notes_coll.list(Some(200)) {
            Ok(notes) => {
                self.note_list = notes.iter().map(|n| NoteSummary {
                    id: n.base.id.clone(),
                    title: if n.title.is_empty() { "Untitled".into() } else { n.title.clone() },
                    date_modified: n.base.date_modified,
                    pinned: n.pinned,
                    favorite: n.favorite,
                }).collect();
            }
            Err(e) => {
                tracing::error!("Failed to load notes: {e}");
                self.note_list.clear();
            }
        }
    }

    /// Load a note's content into the editor.
    pub fn load_note(&mut self, index: usize, db: &Database) {
        self.selected_index = Some(index);
        if let Some(summary) = self.note_list.get(index) {
            let content_coll = Content::new(db);
            let note_id = &summary.id;

            // Find content for this note
            match content_coll.find_by_note_id(note_id) {
                Ok(Some(content_item)) => {
                    let text = content_item.data.as_deref().unwrap_or("");
                    self.editor = EditorState::with_content(
                        text,
                        note_id.clone(),
                        content_item.base.id.clone(),
                    );
                }
                Ok(None) => {
                    // Note has no content yet — empty editor linked to this note
                    self.editor = EditorState::new();
                    self.editor.note_id = Some(note_id.clone());
                }
                Err(e) => {
                    tracing::error!("Failed to load content for note {note_id}: {e}");
                    self.editor = EditorState::new();
                    self.editor.note_id = Some(note_id.clone());
                }
            }
        }
    }

    /// Create a new note in the database and select it.
    pub fn create_note(&mut self, db: &Database) {
        let notes_coll = Notes::new(db);
        let content_coll = Content::new(db);

        let note = Note {
            base: BaseItem::new("note"),
            trash: TrashMeta::default(),
            title: "Untitled".into(),
            headline: None,
            content_id: None,
            pinned: false,
            favorite: false,
            local_only: false,
            conflicted: false,
            readonly: false,
            date_edited: chrono::Utc::now().timestamp_millis(),
            is_generated_title: Some(true),
            archived: None,
            expiry_date: None,
        };

        let content = ContentItem {
            base: BaseItem::new("content"),
            note_id: Some(note.base.id.clone()),
            data: Some(String::new()),
            locked: false,
            local_only: false,
            conflicted: false,
            session_id: None,
            date_edited: chrono::Utc::now().timestamp_millis(),
            date_resolved: None,
        };

        if let Err(e) = notes_coll.add(&note) {
            tracing::error!("Failed to create note: {e}");
            return;
        }
        if let Err(e) = content_coll.add(&content) {
            tracing::error!("Failed to create content: {e}");
            return;
        }

        // Refresh list and select the new note
        self.refresh_list(db);
        if let Some(idx) = self.note_list.iter().position(|n| n.id == note.base.id) {
            self.load_note(idx, db);
        }
    }

    /// Save the editor content to the database.
    pub fn save_current(&mut self, db: &Database) {
        let content_coll = Content::new(db);
        let notes_coll = Notes::new(db);

        if let Some(content_id) = &self.editor.content_id {
            let text = self.editor.text();
            if let Err(e) = content_coll.update_data(content_id, &text) {
                tracing::error!("Failed to save content: {e}");
                return;
            }
        } else if let Some(note_id) = &self.editor.note_id {
            // Create content record if it doesn't exist
            let content = ContentItem {
                base: BaseItem::new("content"),
                note_id: Some(note_id.clone()),
                data: Some(self.editor.text()),
                locked: false,
                local_only: false,
                conflicted: false,
                session_id: None,
                date_edited: chrono::Utc::now().timestamp_millis(),
                date_resolved: None,
            };
            if let Err(e) = content_coll.add(&content) {
                tracing::error!("Failed to create content: {e}");
                return;
            }
            self.editor.content_id = Some(content.base.id.clone());
        }

        // Update the note title from first line of content
        if let Some(note_id) = &self.editor.note_id {
            let text = self.editor.text();
            let first_line = text.lines().next().unwrap_or("Untitled");
            let title = first_line
                .trim_start_matches('#')
                .trim()
                .chars()
                .take(100)
                .collect::<String>();
            let title = if title.is_empty() { "Untitled".into() } else { title };
            let _ = notes_coll.update_title(note_id, &title);

            // Update the list item title
            if let Some(idx) = self.selected_index {
                if let Some(summary) = self.note_list.get_mut(idx) {
                    summary.title = title;
                }
            }
        }

        self.editor.mark_saved();
    }

    /// Handle a NotesMessage. Returns true if the view needs a re-render.
    pub fn update(&mut self, message: NotesMessage, db: &Database) -> bool {
        match message {
            NotesMessage::SelectNote(idx) => {
                // Auto-save before switching
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.load_note(idx, db);
                true
            }
            NotesMessage::NewNote => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.create_note(db);
                true
            }
            NotesMessage::Editor(editor_msg) => {
                self.editor.update(editor_msg)
            }
            NotesMessage::SaveNote => {
                self.save_current(db);
                true
            }
        }
    }
}

/// Render the Notes view: note list on the left, editor on the right.
pub fn notes_view<'a>(
    state: &'a NotesViewState,
    theme: &Theme,
) -> Element<'a, NotesMessage> {
    let note_list = note_list_view(state);

    let editor_area: Element<'a, NotesMessage> = if state.selected_index.is_some() {
        editor_view(&state.editor, theme, NotesMessage::Editor)
    } else {
        container(
            text("Select a note or create a new one").size(14),
        )
        .center(Fill)
        .width(Fill)
        .height(Fill)
        .into()
    };

    row![
        container(note_list)
            .width(260)
            .height(Fill)
            .style(|theme: &Theme| {
                let palette = theme.extended_palette();
                container::Style {
                    border: iced::Border {
                        width: 1.0,
                        color: palette.background.strong.color,
                        ..Default::default()
                    },
                    ..Default::default()
                }
            }),
        container(editor_area)
            .width(Fill)
            .height(Fill),
    ]
    .height(Fill)
    .into()
}

/// The note list sidebar.
fn note_list_view(state: &NotesViewState) -> Element<'_, NotesMessage> {
    let mut items: Vec<Element<'_, NotesMessage>> = Vec::new();

    // New note button
    items.push(
        container(
            button(text("+ New Note").size(13))
                .on_press(NotesMessage::NewNote)
                .padding([6, 12])
                .width(Fill)
                .style(button::primary),
        )
        .padding([8, 8])
        .into(),
    );

    items.push(rule::horizontal(1).into());

    // Note list
    for (idx, note) in state.note_list.iter().enumerate() {
        let is_selected = state.selected_index == Some(idx);
        let pin_marker = if note.pinned { "\u{1F4CC} " } else { "" };
        let fav_marker = if note.favorite { "\u{2605} " } else { "" };

        let label = text(format!("{}{}{}", pin_marker, fav_marker, note.title))
            .size(12);

        let btn = button(label)
            .on_press(NotesMessage::SelectNote(idx))
            .padding([8, 12])
            .width(Fill)
            .style(move |theme: &Theme, status| {
                let mut style = button::text(theme, status);
                if is_selected {
                    style.background = Some(iced::Background::Color(
                        iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.1),
                    ));
                }
                style
            });

        items.push(btn.into());
    }

    scrollable(column(items).spacing(1)).into()
}
```

**Step 2: Update main.rs — add mod and wire Notes view**

Add at top:
```rust
mod notes_view;
```

Add to `Wiredash` struct:
```rust
notes_state: notes_view::NotesViewState,
```

Add to `Message` enum:
```rust
Notes(notes_view::NotesMessage),
```

In `Wiredash::new()`, after creating `db`:
```rust
let mut notes_state = notes_view::NotesViewState::new();
notes_state.refresh_list(&db);
```

Include `notes_state` in the `Self { ... }`.

In `update()`, add arm:
```rust
Message::Notes(msg) => {
    self.notes_state.update(msg, &self.db);
}
```

Replace `content_view()` to check for `View::Notes`:
```rust
fn content_view(&self) -> Element<'_, Message> {
    match self.current_view {
        View::Notes => {
            notes_view::notes_view(&self.notes_state, &self.theme_engine.active_iced_theme())
                .map(Message::Notes)
        }
        view => {
            // Placeholder for all other views
            container(
                column![
                    text(format!("{} {}", view.icon(), view.title())).size(28),
                    rule::horizontal(1),
                    text(view.description()).size(14),
                    text("").size(8),
                    text("This view will be implemented in a future phase.").size(12),
                ]
                .spacing(8)
            )
            .padding(24)
            .width(Fill)
            .height(Fill)
            .into()
        }
    }
}
```

**Step 3: Verify it compiles**

```bash
cd wiredash && cargo check -p wiredash-app
```

**Step 4: Commit**

```
desktop: wire Notes view with note list and markdown editor
```

---

## Task 7: Add auto-save with debounce

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs`

Currently, saving requires an explicit action. This task adds a debounced auto-save: when the editor content changes, start a 2-second timer. If the timer fires without another edit, save. Also save on note switch and on app close (window close event).

**Step 1: Add auto-save state and subscription**

Add to `Wiredash` struct:
```rust
save_pending: bool,
```

Add `Message` variant:
```rust
AutoSaveTick,
```

In `update()`, for `Message::Notes(msg)`:
```rust
Message::Notes(msg) => {
    let changed = self.notes_state.update(msg, &self.db);
    if changed && self.notes_state.editor.dirty {
        self.save_pending = true;
    }
}
Message::AutoSaveTick => {
    if self.save_pending && self.notes_state.editor.dirty {
        self.notes_state.save_current(&self.db);
        self.save_pending = false;
    }
}
```

Add a time subscription for auto-save ticks:
```rust
fn subscription(&self) -> Subscription<Message> {
    let keyboard_sub = keyboard::listen().map(Message::KeyboardEvent);
    if self.save_pending {
        let save_sub = iced::time::every(std::time::Duration::from_secs(2))
            .map(|_| Message::AutoSaveTick);
        Subscription::batch([keyboard_sub, save_sub])
    } else {
        keyboard_sub
    }
}
```

**Step 2: Add Ctrl+S explicit save**

In the keyboard handler, add:
```rust
keyboard::Key::Character("s") => {
    if self.notes_state.editor.dirty {
        self.notes_state.save_current(&self.db);
        self.save_pending = false;
        state_changed = true;
    }
}
```

**Step 3: Verify it compiles**

```bash
cd wiredash && cargo check -p wiredash-app
```

**Step 4: Commit**

```
desktop: add auto-save with 2-second debounce and Ctrl+S
```

---

## Task 8: Add editor tests

**Files:**
- Create: `wiredash/crates/wiredash-editor/tests/editor_test.rs`

Test the core editor state logic (not the view rendering — that requires a running iced app).

**Step 1: Write editor_test.rs**

```rust
use wiredash_editor::{EditorState, EditorMessage, EditorMode, ToolbarAction, TOOLBAR_ACTIONS};

#[test]
fn test_new_editor_is_empty_and_not_dirty() {
    let state = EditorState::new();
    assert!(!state.dirty);
    assert_eq!(state.mode, EditorMode::Split);
    assert!(state.note_id.is_none());
    assert!(state.content_id.is_none());
    assert!(state.text().is_empty() || state.text() == "\n");
}

#[test]
fn test_with_content_loads_text() {
    let state = EditorState::with_content(
        "# Hello\n\nWorld",
        "note-1".into(),
        "content-1".into(),
    );
    assert!(!state.dirty);
    assert_eq!(state.note_id, Some("note-1".into()));
    assert_eq!(state.content_id, Some("content-1".into()));
    assert!(state.text().contains("Hello"));
    assert!(!state.preview_items.is_empty());
}

#[test]
fn test_insert_snippet_marks_dirty() {
    let mut state = EditorState::new();
    assert!(!state.dirty);

    let changed = state.update(EditorMessage::InsertSnippet("**bold**".into()));
    assert!(changed);
    assert!(state.dirty);
    assert!(state.text().contains("bold"));
}

#[test]
fn test_cycle_mode() {
    let mut state = EditorState::new();
    assert_eq!(state.mode, EditorMode::Split);

    state.update(EditorMessage::CycleMode);
    assert_eq!(state.mode, EditorMode::Preview);

    state.update(EditorMessage::CycleMode);
    assert_eq!(state.mode, EditorMode::Edit);

    state.update(EditorMessage::CycleMode);
    assert_eq!(state.mode, EditorMode::Split);
}

#[test]
fn test_set_mode() {
    let mut state = EditorState::new();
    state.update(EditorMessage::SetMode(EditorMode::Edit));
    assert_eq!(state.mode, EditorMode::Edit);
    state.update(EditorMessage::SetMode(EditorMode::Preview));
    assert_eq!(state.mode, EditorMode::Preview);
}

#[test]
fn test_mark_saved_clears_dirty() {
    let mut state = EditorState::new();
    state.update(EditorMessage::InsertSnippet("text".into()));
    assert!(state.dirty);
    state.mark_saved();
    assert!(!state.dirty);
}

#[test]
fn test_toolbar_actions_all_produce_snippets() {
    for action in TOOLBAR_ACTIONS {
        let snippet = action.snippet();
        assert!(!snippet.is_empty(), "Action {:?} has empty snippet", action.label());
    }
}

#[test]
fn test_toolbar_actions_all_have_labels() {
    for action in TOOLBAR_ACTIONS {
        assert!(!action.label().is_empty());
        assert!(!action.tooltip_text().is_empty());
    }
}
```

**Step 2: Run tests**

```bash
cd wiredash && cargo test -p wiredash-editor
```

Expected: 8 tests pass.

**Step 3: Commit**

```
desktop: add wiredash-editor unit tests
```

---

## Task 9: Integration test — note create/edit/save roundtrip

**Files:**
- Create: `wiredash/crates/wiredash-app/tests/notes_roundtrip_test.rs`

Test the full flow: create note → edit content → save → reload → verify content persisted. Uses an in-memory database.

**Step 1: Write notes_roundtrip_test.rs**

```rust
use wiredash_db::Database;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::content::Content;
use wiredash_core::types::{BaseItem, Note, ContentItem, TrashMeta};

#[test]
fn test_create_and_load_note_with_content() {
    let db = Database::open_memory().unwrap();

    let notes = Notes::new(&db);
    let content = Content::new(&db);

    // Create a note
    let note = Note {
        base: BaseItem::new("note"),
        trash: TrashMeta::default(),
        title: "Test Note".into(),
        headline: None,
        content_id: None,
        pinned: false,
        favorite: false,
        local_only: false,
        conflicted: false,
        readonly: false,
        date_edited: chrono::Utc::now().timestamp_millis(),
        is_generated_title: None,
        archived: None,
        expiry_date: None,
    };
    notes.add(&note).unwrap();

    // Create content for the note
    let content_item = ContentItem {
        base: BaseItem::new("content"),
        note_id: Some(note.base.id.clone()),
        data: Some("# Hello World\n\nThis is a test.".into()),
        locked: false,
        local_only: false,
        conflicted: false,
        session_id: None,
        date_edited: chrono::Utc::now().timestamp_millis(),
        date_resolved: None,
    };
    content.add(&content_item).unwrap();

    // Load note list
    let note_list = notes.list(Some(10)).unwrap();
    assert_eq!(note_list.len(), 1);
    assert_eq!(note_list[0].title, "Test Note");

    // Load content for the note
    let loaded = content.find_by_note_id(&note.base.id).unwrap().unwrap();
    assert_eq!(loaded.data.as_deref(), Some("# Hello World\n\nThis is a test."));

    // Update content
    content.update_data(&content_item.base.id, "# Updated\n\nNew content.").unwrap();

    // Verify update
    let updated = content.find_by_note_id(&note.base.id).unwrap().unwrap();
    assert_eq!(updated.data.as_deref(), Some("# Updated\n\nNew content."));
}

#[test]
fn test_update_title_from_content() {
    let db = Database::open_memory().unwrap();
    let notes = Notes::new(&db);

    let note = Note {
        base: BaseItem::new("note"),
        trash: TrashMeta::default(),
        title: "Untitled".into(),
        headline: None,
        content_id: None,
        pinned: false,
        favorite: false,
        local_only: false,
        conflicted: false,
        readonly: false,
        date_edited: chrono::Utc::now().timestamp_millis(),
        is_generated_title: Some(true),
        archived: None,
        expiry_date: None,
    };
    notes.add(&note).unwrap();

    // Simulate extracting title from first line of markdown
    let markdown = "## My Great Note\n\nSome content here.";
    let first_line = markdown.lines().next().unwrap_or("Untitled");
    let title: String = first_line
        .trim_start_matches('#')
        .trim()
        .chars()
        .take(100)
        .collect();

    notes.update_title(&note.base.id, &title).unwrap();

    let loaded = notes.get(&note.base.id).unwrap().unwrap();
    assert_eq!(loaded.title, "My Great Note");
}
```

**Step 2: Run tests**

```bash
cd wiredash && cargo test -p wiredash-app
```

Expected: 2 integration tests pass.

**Step 3: Commit**

```
desktop: add notes roundtrip integration tests
```

---

## Task 10: Finalize Phase 4 — full workspace verification

**Files:** None (verification only)

**Step 1: Run full workspace tests**

```bash
cd wiredash && cargo test --workspace
```

Expected: All existing Phase 1-3 tests (107) + new Phase 4 tests (~10) pass.

**Step 2: Build the binary**

```bash
cd wiredash && cargo build -p wiredash-app
```

**Step 3: Run clippy**

```bash
cd wiredash && cargo clippy --workspace -- -W clippy::all
```

Fix any new warnings introduced by Phase 4 code.

**Step 4: Commit any fixes**

```
desktop: finalize Phase 4 — markdown editor with note list
```

---

## NOT Doing (Deliberately Scoped Out)

- **No pulldown-cmark** — iced 0.14's built-in `markdown` widget handles parsing + rendering
- **No syntect dependency** — iced's `highlighter` feature provides syntax highlighting
- **No PaneGrid for split view** — simple `row![]` with two Fill containers (PaneGrid's owned state complicates borrow patterns; can upgrade later if resize is needed)
- **No session history / undo** — Phase 5+ feature; the NoteHistory/SessionContent collections exist in wiredash-core but are not wired to the editor yet
- **No vim-mode** — future enhancement via `key_binding` closure on `text_editor`
- **No attachment support** — no `![](path)` image loading; images render as text placeholders
- **No vault/encryption** — encrypted notes are not decrypted in the editor yet (requires sync + auth integration)
- **No drag-and-drop** — no file drop to insert images/attachments
- **No search integration** — FTS5 search exists in wiredash-core but is not wired to the notes view
- **No keyboard shortcuts for formatting** — toolbar is click-only; Ctrl+B/I shortcuts inside the editor conflict with iced's text_editor built-in bindings; deferred to Phase 5

## Verification Checklist

1. Launch the app: `cargo run -p wiredash-app`
2. Click "Notes" in the sidebar
3. Click "+ New Note" — a new note appears in the list and the editor opens
4. Type markdown in the editor — the preview pane shows rendered output in real-time
5. Switch between Edit/Split/Preview modes using the toolbar buttons
6. Click toolbar buttons (B, I, H1, etc.) — formatting snippets are inserted
7. Click a different note — the previous one auto-saves, the new one loads
8. Ctrl+S saves immediately
9. Restart the app — previously created notes appear in the list with their content preserved
10. All tests pass: `cargo test --workspace`
