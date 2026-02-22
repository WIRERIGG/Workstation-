# WIREDASH Phase 5 — Core Views (Notebooks, Tags, Search, Organize) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the core note-organizing views — Notebooks, Tags, Search, Favorites, Archive, Trash — that transform WIREDASH from a single-note editor into a usable note-taking app.

**Architecture:** Each view follows the established pattern from `notes_view.rs`: a view state struct, a message enum, an `update()` method, and a pure view function. All views share the `editor_view()` widget from `wiredash-editor`. Backend queries are enhanced with filtering/sorting in `wiredash-core`. Navigation gets 3 new routes (Notebooks, Tags, Search).

**Tech Stack:** Rust, iced 0.14 (text_input, pick_list, scrollable, button), wiredash-core (Notes, Notebooks, Tags, Relations, Search collections), SQLite FTS5

---

## What Already Exists

### Backend (wiredash-core)
- `Notes` — add, get, list(limit), trashed(), update_title, set_pinned, set_favorite, set_archived, move_to_trash, remove
- `Notebooks` — add, get, list(), set_pinned, move_to_trash, remove (missing: update_title)
- `Tags` — add, get, list(), find_by_title, remove (missing: update_title)
- `Relations` — add, from_ids, to_ids, unlink, unlink_all_from, unlink_all_to
- `Search` — index_note, index_content, search_notes, search_content, remove_note, remove_content
- `Content` — add, get, find_by_note_id, update_data, remove
- `Trash` — clean_notes(days), clean_notebooks(days)

### Frontend (wiredash-app)
- `notes_view.rs` — Full working notes view (list + editor, CRUD, auto-save)
- `navigation.rs` — 21 views across 4 sections. **Missing from View enum:** Notebooks, Tags, Search
- `main.rs` — Wiredash app with db, notes_state, auto-save, keyboard shortcuts
- **Organize section views** — Favorites, Archive, Trash exist as routes but render placeholder text

### Editor (wiredash-editor)
- `editor_view()` — Reusable split-pane markdown editor with toolbar

---

## iced 0.14 API Reference (Phase 5 Widgets)

```rust
// Search bar
text_input("Search...", &query)
    .on_input(Msg::QueryChanged)
    .on_submit(Msg::QuerySubmit)
    .padding(8)

// Sort dropdown
pick_list(
    [SortBy::DateModified, SortBy::DateCreated, SortBy::Title],
    Some(current_sort),
    Msg::SortChanged,
).placeholder("Sort by...")

// Keyboard shortcuts (in subscription)
keyboard::listen().map(Msg::KeyboardEvent)

// Focus a text_input programmatically
text_input::focus(id)
```

---

## NOT Doing

- No drag-and-drop for notebooks/tags (future)
- No multi-tag AND/OR filter (just single-tag click)
- No sub-notebooks / nested tree (flat notebook list for now)
- No search result highlighting / context snippets (just show titles)
- No settings view (Phase 6)
- No vault/encryption UI (Phase 6)

---

## Task 1: Backend — Add Filtered Queries to wiredash-core

**Files:**
- Modify: `wiredash/crates/wiredash-core/src/types.rs` — add SortBy, SortDirection enums
- Modify: `wiredash/crates/wiredash-core/src/collections/notes.rs` — add list_filtered, list_by_ids, restore_from_trash
- Modify: `wiredash/crates/wiredash-core/src/collections/notebooks.rs` — add update_title
- Modify: `wiredash/crates/wiredash-core/src/collections/tags.rs` — add update_title
- Test: `wiredash/crates/wiredash-core/tests/filtered_notes_test.rs`

### Step 1: Add sorting enums to types.rs

Append to `wiredash/crates/wiredash-core/src/types.rs`:

```rust
/// Sort field for note/notebook queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SortBy {
    DateModified,
    DateCreated,
    Title,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SortDirection {
    Asc,
    Desc,
}

impl SortBy {
    pub fn column(&self) -> &'static str {
        match self {
            Self::DateModified => "dateModified",
            Self::DateCreated => "dateCreated",
            Self::Title => "title",
        }
    }
}

impl SortDirection {
    pub fn sql(&self) -> &'static str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }
}
```

### Step 2: Add Notes::list_filtered and Notes::list_by_ids

Add to `notes.rs`:

```rust
/// List notes matching filter criteria.
/// - `favorites_only`: if true, only return notes where favorite = 1
/// - `archived_only`: if true, only return notes where archived = 1
/// - `sort_by` / `sort_dir`: ordering
/// - `limit`: max results
pub fn list_filtered(
    &self,
    favorites_only: bool,
    archived_only: bool,
    sort_by: SortBy,
    sort_dir: SortDirection,
    limit: Option<u32>,
) -> Result<Vec<Note>, anyhow::Error> {
    let mut conditions = vec!["deleted = 0", "(type = 'note' OR type IS NULL)"];
    if favorites_only {
        conditions.push("favorite = 1");
    }
    if archived_only {
        conditions.push("archived = 1");
    }
    let where_clause = conditions.join(" AND ");
    let limit_clause = limit.map(|n| format!("LIMIT {}", n)).unwrap_or_default();

    let sql = format!(
        "SELECT id, type, dateModified, dateCreated, synced, deleted,
                dateDeleted, itemType, deletedBy,
                title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                dateEdited, isGeneratedTitle, archived, expiryDate
         FROM notes
         WHERE {}
         ORDER BY pinned DESC, {} {}
         {}",
        where_clause,
        sort_by.column(),
        sort_dir.sql(),
        limit_clause,
    );

    let conn = self.db.conn();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], note_from_row)?;
    let mut notes = Vec::new();
    for row in rows {
        notes.push(row?);
    }
    Ok(notes)
}

/// Load notes by a set of IDs. Order is not guaranteed.
pub fn list_by_ids(&self, ids: &[String]) -> Result<Vec<Note>, anyhow::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT id, type, dateModified, dateCreated, synced, deleted,
                dateDeleted, itemType, deletedBy,
                title, headline, contentId, pinned, favorite, localOnly, conflicted, readonly,
                dateEdited, isGeneratedTitle, archived, expiryDate
         FROM notes
         WHERE id IN ({})
         ORDER BY dateModified DESC",
        placeholders.join(", ")
    );

    let conn = self.db.conn();
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), note_from_row)?;
    let mut notes = Vec::new();
    for row in rows {
        notes.push(row?);
    }
    Ok(notes)
}

/// Restore a note from trash back to active.
pub fn restore_from_trash(&self, id: &str) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    self.db.execute(
        "UPDATE notes SET deleted = 0, type = 'note', dateDeleted = NULL, itemType = NULL, deletedBy = NULL, synced = 0, dateModified = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}
```

### Step 3: Add Notebooks::update_title and Tags::update_title

In `notebooks.rs`:
```rust
pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    self.db.execute(
        "UPDATE notebooks SET title = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
        params![title, now, id],
    )?;
    Ok(())
}
```

In `tags.rs`:
```rust
pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    self.db.execute(
        "UPDATE tags SET title = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
        params![title, now, id],
    )?;
    Ok(())
}
```

### Step 4: Write tests

Create `wiredash/crates/wiredash-core/tests/filtered_notes_test.rs`:

```rust
use wiredash_core::collections::notes::Notes;
use wiredash_core::types::{Note, SortBy, SortDirection};
use wiredash_db::Database;

#[test]
fn test_list_filtered_favorites_only() {
    let db = Database::open_memory().unwrap();
    let notes = Notes::new(&db);

    let mut n1 = Note::new("Alpha");
    let mut n2 = Note::new("Beta");
    n2.favorite = true;

    notes.add(&n1).unwrap();
    notes.add(&n2).unwrap();

    let fav = notes.list_filtered(true, false, SortBy::Title, SortDirection::Asc, None).unwrap();
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

    let sorted = notes.list_filtered(false, false, SortBy::Title, SortDirection::Asc, None).unwrap();
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

    let trashed = notes.trashed().unwrap();
    assert_eq!(trashed.len(), 0);

    let active = notes.list(None).unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].title, "Trashed Note");
}
```

### Step 5: Run tests

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo test -p wiredash-core -- filtered_notes
```

Expected: 4 tests pass.

### Step 6: Commit

```bash
git add crates/wiredash-core/
git commit -s -m "core: add filtered queries, list_by_ids, restore_from_trash, update_title"
```

---

## Task 2: Navigation — Add Notebooks, Tags, Search Routes

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/navigation.rs` — add 3 new View variants
- Modify: `wiredash/crates/wiredash-app/src/icons.rs` — add NOTEBOOK, TAG icons

### Step 1: Add icons

Append to `icons.rs`:
```rust
pub const NOTEBOOK: &str = "\u{1F4D3}";  // 📓
pub const TAG: &str = "\u{1F3F7}";       // 🏷
```

### Step 2: Add View::Notebooks, View::Tags, View::Search to navigation.rs

Insert `Notebooks` and `Tags` after `Notes` in the Workspace section. Add `Search` after `Notes`.

In the View enum:
```rust
pub enum View {
    Dashboard, Control, Notes, Notebooks, Tags, Search, Tasks, Calendar, AgentChat, Terminal, Files,
    // ... rest unchanged
}
```

Add to `title()`, `icon()`, `description()`, `section()` match arms:
- `Notebooks` → title: "Notebooks", icon: `icons::NOTEBOOK`, section: Workspace, description: "Organize notes into notebooks."
- `Tags` → title: "Tags", icon: `icons::TAG`, section: Workspace, description: "Manage tags and filter notes by tag."
- `Search` → title: "Search", icon: `icons::SEARCH`, section: Workspace, description: "Full-text search across all notes."

Move `Search` from Developer (CodeSearch is separate) to Workspace. Update `ALL` and `section()`.

### Step 3: Compile check

```bash
cargo check -p wiredash-app
```

Expected: compile with warnings about unmatched patterns in content_view (placeholder views).

### Step 4: Commit

```bash
git add crates/wiredash-app/src/navigation.rs crates/wiredash-app/src/icons.rs
git commit -s -m "misc: add Notebooks, Tags, Search routes to navigation"
```

---

## Task 3: Notebooks View

**Files:**
- Create: `wiredash/crates/wiredash-app/src/notebooks_view.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add mod, state, message routing

### Step 1: Create notebooks_view.rs

Layout: `row![ notebook_list(260px) | vertical_rule | note_list(280px) | vertical_rule | editor(Fill) ]`

```rust
//! Notebooks view — list notebooks, show notes in selected notebook, edit.

use iced::widget::{button, column, container, row, scrollable, text, text_input, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::notebooks::Notebooks;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::relations::Relations;
use wiredash_core::collections::content::Content;
use wiredash_core::types::{ContentItem, Note, Notebook, SortBy, SortDirection};
use wiredash_db::Database;
use wiredash_editor::{editor_view, EditorMessage, EditorState};

/// Lightweight notebook summary for the sidebar.
pub struct NotebookSummary {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub note_count: usize,
}

/// Lightweight note summary for the middle panel.
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub pinned: bool,
}

#[derive(Debug, Clone)]
pub enum NotebooksMessage {
    SelectNotebook(usize),
    SelectNote(usize),
    NewNotebook,
    NewNote,
    RenameNotebook(String),     // new title text
    SubmitRename,
    CancelRename,
    DeleteNotebook,
    Editor(EditorMessage),
    SaveNote,
}

pub struct NotebooksViewState {
    pub notebook_list: Vec<NotebookSummary>,
    pub selected_notebook: Option<usize>,
    pub note_list: Vec<NoteSummary>,
    pub selected_note: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
    pub renaming: bool,
    pub rename_text: String,
}
```

The state implements:
- `new()` — empty state
- `refresh_notebooks(db)` — reload notebook list from DB, count notes per notebook via Relations
- `refresh_notes(db)` — reload notes for selected notebook via Relations::from_ids("notebook", nb_id, "note") → Notes::list_by_ids
- `load_note(idx, db)` — load note content into editor (same pattern as notes_view)
- `create_notebook(db)` — create new Notebook, add to DB
- `create_note(db)` — create Note + Content, add Relation(notebook→note)
- `save_current(db)` — save editor content (same pattern as notes_view)
- `delete_notebook(db)` — move to trash, unlink all relations
- `update(msg, db) -> bool` — message handler

View functions:
- `notebooks_view(&state, &theme) -> Element<NotebooksMessage>` — full 3-panel layout
- `notebook_sidebar(&state) -> Element<NotebooksMessage>` — left: "New Notebook" + list
- `notebook_note_list(&state) -> Element<NotebooksMessage>` — middle: "New Note" + note list
- `notebook_editor_area(&state, &theme) -> Element<NotebooksMessage>` — right: editor or placeholder

### Step 2: Wire into main.rs

In `Wiredash` struct, add:
```rust
notebooks_state: notebooks_view::NotebooksViewState,
```

In `Message` enum, add:
```rust
Notebooks(notebooks_view::NotebooksMessage),
```

In `new()`, after `notes_state.refresh_list(&db)`:
```rust
let mut notebooks_state = notebooks_view::NotebooksViewState::new();
notebooks_state.refresh_notebooks(&db);
```

In `update()`, add match arm:
```rust
Message::Notebooks(msg) => {
    let changed = self.notebooks_state.update(msg, &self.db);
    if changed && self.notebooks_state.editor.dirty {
        self.save_pending = true;
    }
}
```

In `content_view()`, add match:
```rust
View::Notebooks => {
    notebooks_view::notebooks_view(&self.notebooks_state, &self.theme_engine.active_iced_theme())
        .map(Message::Notebooks)
}
```

In `AutoSaveTick` handler, also check notebooks_state:
```rust
Message::AutoSaveTick => {
    if self.save_pending {
        if self.notes_state.editor.dirty {
            self.notes_state.save_current(&self.db);
        }
        if self.notebooks_state.editor.dirty {
            self.notebooks_state.save_current(&self.db);
        }
        self.save_pending = false;
    }
}
```

### Step 3: Compile and test

```bash
cargo check -p wiredash-app
```

### Step 4: Commit

```bash
git add crates/wiredash-app/src/notebooks_view.rs crates/wiredash-app/src/main.rs
git commit -s -m "web: add Notebooks view with notebook list, note list, and editor"
```

---

## Task 4: Tags View

**Files:**
- Create: `wiredash/crates/wiredash-app/src/tags_view.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add mod, state, message routing

### Step 1: Create tags_view.rs

Layout: `row![ tag_list(240px) | vertical_rule | note_list(280px) | vertical_rule | editor(Fill) ]`

```rust
//! Tags view — list tags, show notes with selected tag, edit.

pub struct TagSummary {
    pub id: String,
    pub title: String,
    pub note_count: usize,
}

#[derive(Debug, Clone)]
pub enum TagsMessage {
    SelectTag(usize),
    SelectNote(usize),
    NewTag,
    RenameTag(String),
    SubmitRename,
    CancelRename,
    DeleteTag,
    Editor(EditorMessage),
    SaveNote,
}

pub struct TagsViewState {
    pub tag_list: Vec<TagSummary>,
    pub selected_tag: Option<usize>,
    pub note_list: Vec<NoteSummary>,
    pub selected_note: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
    pub renaming: bool,
    pub rename_text: String,
}
```

Same implementation pattern as notebooks_view:
- `refresh_tags(db)` — reload tags, count notes per tag via Relations::to_ids("note", "tag", tag_id)
- `refresh_notes(db)` — load notes for selected tag via Relations
- `create_tag(db)` — create new Tag
- `delete_tag(db)` — remove tag, unlink all relations
- `save_current(db)` — same editor save pattern

### Step 2: Wire into main.rs

Same pattern as Task 3. Add `tags_state`, `Tags(TagsMessage)`, content_view match, auto-save check.

### Step 3: Compile and test

```bash
cargo check -p wiredash-app
```

### Step 4: Commit

```bash
git add crates/wiredash-app/src/tags_view.rs crates/wiredash-app/src/main.rs
git commit -s -m "web: add Tags view with tag list, note list, and editor"
```

---

## Task 5: Search View

**Files:**
- Create: `wiredash/crates/wiredash-app/src/search_view.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add mod, state, message routing
- Modify: `wiredash/crates/wiredash-app/src/notes_view.rs` — index notes on save

### Step 1: Create search_view.rs

Layout: `column![ search_bar | row![ results_list(320px) | vertical_rule | editor(Fill) ] ]`

```rust
//! Search view — FTS5 search across notes and content.

use iced::widget::{text_input, ...};

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub source: SearchSource,  // Title or Content
}

#[derive(Debug, Clone)]
pub enum SearchSource {
    Title,
    Content,
}

#[derive(Debug, Clone)]
pub enum SearchMessage {
    QueryChanged(String),
    ExecuteSearch,
    SelectResult(usize),
    Editor(EditorMessage),
    SaveNote,
}

pub struct SearchViewState {
    pub query: String,
    pub results: Vec<SearchResult>,
    pub selected_result: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
}
```

Implementation:
- `new()` — empty state
- `execute_search(db)` — calls `Search::search_notes(query)` and `Search::search_content(query)`, deduplicates by note_id, loads Note titles
- `select_result(idx, db)` — loads content into editor
- `save_current(db)` — same pattern

The `text_input` for search uses `on_input(SearchMessage::QueryChanged)` and `on_submit(SearchMessage::ExecuteSearch)`.

### Step 2: Index notes on save

In `notes_view.rs`, after successful save in `save_current()`, add FTS indexing:

```rust
// Index for FTS search
if let Ok(search) = std::panic::catch_unwind(|| {
    use wiredash_core::collections::search::Search;
    let search = Search::new(db);
    let _ = search.index_note(note_id, &title);
    let _ = search.index_content(content_id, note_id, &editor_text);
}) { /* indexed */ }
```

Actually, simpler — just call `Search::index_note` and `Search::index_content` directly:

```rust
// After successful content + title save:
let search = wiredash_core::collections::search::Search::new(db);
if let Err(e) = search.index_note(note_id, &title) {
    tracing::warn!("FTS index note failed: {e}");
}
if let Err(e) = search.index_content(content_id, note_id, &editor_text) {
    tracing::warn!("FTS index content failed: {e}");
}
```

### Step 3: Wire into main.rs

Add `search_state`, `Search(SearchMessage)`, content_view match, auto-save check.

### Step 4: Compile and test

```bash
cargo check -p wiredash-app
```

### Step 5: Commit

```bash
git add crates/wiredash-app/src/search_view.rs crates/wiredash-app/src/notes_view.rs crates/wiredash-app/src/main.rs
git commit -s -m "web: add Search view with FTS5 full-text search"
```

---

## Task 6: Organize Views — Favorites, Archive, Trash

**Files:**
- Create: `wiredash/crates/wiredash-app/src/organize_views.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add mod, states, message routing

### Step 1: Create organize_views.rs

Three lightweight views that reuse the note-list + editor pattern with different filters.

```rust
//! Organize views — Favorites, Archive, Trash.
//! Filtered note lists with editor integration.

/// Shared state for filtered note views.
pub struct FilteredNotesState {
    pub note_list: Vec<NoteSummary>,
    pub selected_index: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
}

#[derive(Debug, Clone)]
pub enum FilteredNotesMessage {
    SelectNote(usize),
    Editor(EditorMessage),
    SaveNote,
    ToggleFavorite,     // Favorites view: unfavorite
    RestoreNote,        // Archive/Trash: restore
    PermanentDelete,    // Trash: permanent delete
}

/// Which filter to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteFilter {
    Favorites,
    Archived,
    Trashed,
}
```

Implementation:
- `FilteredNotesState::new()` — empty
- `refresh(db, filter)` — calls `Notes::list_filtered(favorites_only, archived_only, ...)` or `Notes::trashed()`
- `load_note(idx, db)` — same pattern
- `save_current(db)` — same pattern
- `toggle_favorite(db)` — calls `Notes::set_favorite(id, false)`
- `restore_note(db)` — calls `Notes::restore_from_trash(id)` or `Notes::set_archived(id, false)`
- `permanent_delete(db)` — calls `Notes::remove(id)` + `Content::remove(content_id)`
- `update(msg, db, filter) -> bool`

View function:
- `filtered_notes_view(state, theme, filter) -> Element<FilteredNotesMessage>`
  - Left: note list with contextual action buttons (Unfavorite / Restore / Delete)
  - Right: editor

### Step 2: Wire into main.rs

Add three state fields:
```rust
favorites_state: organize_views::FilteredNotesState,
archive_state: organize_views::FilteredNotesState,
trash_state: organize_views::FilteredNotesState,
```

Three message variants:
```rust
Favorites(organize_views::FilteredNotesMessage),
Archive(organize_views::FilteredNotesMessage),
TrashView(organize_views::FilteredNotesMessage),
```

Three content_view matches:
```rust
View::Favorites => {
    organize_views::filtered_notes_view(
        &self.favorites_state, &theme, organize_views::NoteFilter::Favorites
    ).map(Message::Favorites)
}
View::Archive => { ... NoteFilter::Archived ... }
View::Trash => { ... NoteFilter::Trashed ... }
```

Initialize in `new()`:
```rust
let mut favorites_state = organize_views::FilteredNotesState::new();
favorites_state.refresh(&db, organize_views::NoteFilter::Favorites);
// same for archive, trash
```

### Step 3: Compile and test

```bash
cargo check -p wiredash-app
```

### Step 4: Commit

```bash
git add crates/wiredash-app/src/organize_views.rs crates/wiredash-app/src/main.rs
git commit -s -m "web: add Favorites, Archive, Trash views with filtered note lists"
```

---

## Task 7: Keyboard Shortcuts + Cross-View Refresh

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add Ctrl+F search shortcut, refresh on navigate

### Step 1: Add Ctrl+F shortcut

In the keyboard handler, add:
```rust
keyboard::Key::Character("f") => {
    self.current_view = View::Search;
    state_changed = true;
}
```

### Step 2: Refresh views on navigate

When navigating to a view, refresh its data:
```rust
Message::Navigate(view) => {
    self.current_view = view;
    state_changed = true;
    match view {
        View::Notes => self.notes_state.refresh_list(&self.db),
        View::Notebooks => self.notebooks_state.refresh_notebooks(&self.db),
        View::Tags => self.tags_state.refresh_tags(&self.db),
        View::Favorites => self.favorites_state.refresh(&self.db, organize_views::NoteFilter::Favorites),
        View::Archive => self.archive_state.refresh(&self.db, organize_views::NoteFilter::Archived),
        View::Trash => self.trash_state.refresh(&self.db, organize_views::NoteFilter::Trashed),
        _ => {}
    }
}
```

### Step 3: Save dirty editors on navigate away

Before switching views, save any dirty editor:
```rust
// At the top of Message::Navigate handler:
if self.notes_state.editor.dirty { self.notes_state.save_current(&self.db); }
if self.notebooks_state.editor.dirty { self.notebooks_state.save_current(&self.db); }
if self.tags_state.editor.dirty { self.tags_state.save_current(&self.db); }
// ... same for organize views
```

### Step 4: Compile and test

```bash
cargo check -p wiredash-app
```

### Step 5: Commit

```bash
git add crates/wiredash-app/src/main.rs
git commit -s -m "misc: add Ctrl+F search shortcut, refresh-on-navigate, save-on-navigate-away"
```

---

## Task 8: Tests

**Files:**
- Create: `wiredash/crates/wiredash-core/tests/filtered_notes_test.rs` (already in Task 1)
- Create: `wiredash/crates/wiredash-core/tests/notebook_relations_test.rs`
- Create: `wiredash/crates/wiredash-core/tests/tag_relations_test.rs`
- Create: `wiredash/crates/wiredash-core/tests/search_integration_test.rs`

### Step 1: Notebook-note relation tests

`notebook_relations_test.rs`:
```rust
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
```

### Step 2: Tag-note relation tests

`tag_relations_test.rs`:
```rust
#[test]
fn test_tag_note_relations() {
    let db = Database::open_memory().unwrap();
    let tags = Tags::new(&db);
    let notes = Notes::new(&db);
    let relations = Relations::new(&db);

    let tag = Tag::new("important");
    let n1 = Note::new("Note A");
    let tag_id = tag.base.id.clone();
    let n1_id = n1.base.id.clone();

    tags.add(&tag).unwrap();
    notes.add(&n1).unwrap();

    // Link note to tag: note → tag
    relations.add("note", &n1_id, "tag", &tag_id).unwrap();

    // Query: which notes have this tag?
    let note_ids = relations.to_ids("note", "tag", &tag_id).unwrap();
    assert_eq!(note_ids.len(), 1);
    assert_eq!(note_ids[0], n1_id);
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
```

### Step 3: Search integration test

`search_integration_test.rs`:
```rust
#[test]
fn test_search_after_indexing() {
    let db = Database::open_memory().unwrap();
    let notes_col = Notes::new(&db);
    let content_col = Content::new(&db);
    let search = Search::new(&db);

    // Create note + content
    let note = Note::new("Rust Programming");
    let note_id = note.base.id.clone();
    notes_col.add(&note).unwrap();

    let mut ci = ContentItem::new();
    ci.note_id = Some(note_id.clone());
    ci.data = Some("Learn Rust and build fast programs.".into());
    let ci_id = ci.base.id.clone();
    content_col.add(&ci).unwrap();

    // Index
    search.index_note(&note_id, "Rust Programming").unwrap();
    search.index_content(&ci_id, &note_id, "Learn Rust and build fast programs.").unwrap();

    // Search by title
    let results = search.search_notes("Rust").unwrap();
    assert!(results.contains(&note_id));

    // Search by content
    let results = search.search_content("fast programs").unwrap();
    assert!(results.contains(&note_id));
}
```

### Step 4: Run all tests

```bash
cargo test --workspace
```

Expected: All existing 111 tests + ~10 new tests pass.

### Step 5: Commit

```bash
git add crates/wiredash-core/tests/
git commit -s -m "core: add filtered notes, notebook relations, tag relations, search integration tests"
```

---

## Task 9: Finalize Phase 5

### Step 1: Full workspace check

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo check --workspace
cargo test --workspace
cargo clippy --workspace
cargo build -p wiredash-app
```

### Step 2: Fix any clippy warnings

Address all new clippy warnings from Phase 5 code.

### Step 3: Commit any fixes

```bash
git add -A
git commit -s -m "misc: Phase 5 clippy fixes and finalization"
```

---

## Verification

After all tasks:
1. `cargo test --workspace` — all tests pass (120+ expected)
2. `cargo build -p wiredash-app` — binary builds
3. Run the app and verify:
   - **Notebooks:** Create notebook → create note in notebook → edit → save → see note in list
   - **Tags:** Create tag → see tag in list (note tagging via code, no UI yet for assigning tags to notes from Notes view)
   - **Search:** Type query → see matching notes → click to open in editor
   - **Favorites:** Navigate to Favorites → see favorited notes
   - **Archive:** Navigate to Archive → see archived notes → restore one
   - **Trash:** Navigate to Trash → see trashed notes → restore or permanently delete
   - **Ctrl+F:** Opens Search view from any view
   - **Auto-save:** Works across all views with editors
