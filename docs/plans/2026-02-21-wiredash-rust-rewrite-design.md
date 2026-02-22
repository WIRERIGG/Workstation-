# WIREDASH — Full Rust Rewrite Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan from this design.

**Goal:** Single-binary, GPU-rendered desktop app (Win/Mac/Linux) — a 1:1 Rust replica of Workstation (Notesnook fork) with E2E encrypted notes, markdown editor, and full feature set.

**Architecture:** Cargo workspace of 8 crates. iced 0.14 GUI framework (Elm-inspired, GPU-native). Business logic separated from UI for testability. Byte-compatible crypto and DB with Workstation.

**Tech Stack:** Rust, iced 0.14, rusqlite + sqlcipher, sodiumoxide, reqwest, tokio, pulldown-cmark, syntect, git2, portable-pty, notify

---

## 1. Core Architecture

### Cargo Workspace Layout

```
wiredash/
├── Cargo.toml                    # [workspace]
├── crates/
│   ├── wiredash-app/             # Binary: iced Application, routing, window management
│   ├── wiredash-core/            # Lib: business logic, collections, queries
│   ├── wiredash-db/              # Lib: rusqlite + sqlcipher, migrations, query builder
│   ├── wiredash-crypto/          # Lib: sodiumoxide/ring, key derivation, encrypt/decrypt
│   ├── wiredash-sync/            # Lib: sync protocol, conflict resolution, reqwest HTTP
│   ├── wiredash-editor/          # Lib: iced widget for markdown editing + live preview
│   ├── wiredash-views/           # Lib: all 31 view modules as iced components
│   ├── wiredash-theme/           # Lib: theme engine (JSON themes → iced styling)
│   └── wiredash-fs/              # Lib: filesystem, git2, portable-pty, notify watcher
├── assets/                       # Icons, fonts, default themes
├── tests/                        # Integration tests
└── docs/
```

### Key Dependencies (~24 crates)

| Crate | Purpose | Replaces (TS) |
|-------|---------|---------------|
| `iced` 0.14 | GUI framework | React + Theme UI |
| `rusqlite` + `bundled-sqlcipher` | Encrypted SQLite | better-sqlite3 |
| `sodiumoxide` or `ring` | Cryptography | @notesnook/crypto + sodium |
| `reqwest` | HTTP client | fetch API |
| `serde` + `serde_json` | Serialization | JSON.parse/stringify |
| `tokio` | Async runtime | Node.js event loop |
| `pulldown-cmark` | Markdown parsing | TipTap/ProseMirror |
| `syntect` | Syntax highlighting | highlight.js |
| `git2` | Git operations | git tRPC router |
| `portable-pty` | Terminal emulator | node-pty |
| `notify` | File watching | chokidar |
| `chrono` | Date/time | dayjs |
| `uuid` | UUIDs | uuid npm |
| `flate2` | Compression | zlib |
| `keyring` | OS keychain | safeStorage |
| `open` | Open URLs/files | shell.openExternal |
| `arboard` | Clipboard | Clipboard API |
| `directories` | XDG/AppData paths | electron app.getPath |
| `tracing` | Logging | @notesnook/logger |
| `thiserror` + `anyhow` | Error handling | try/catch |
| `image` | Image processing | canvas API |
| `rfd` | Native file dialogs | dialog.showOpenDialog |
| `dark-light` | System theme detection | nativeTheme |
| `auto-launch` | Start on boot | autolaunch |

### State Architecture (Elm-inspired)

```rust
// wiredash-app/src/app.rs
struct Wiredash {
    // Route / navigation
    current_view: View,
    history: Vec<View>,

    // Domain state (mirrors Zustand stores)
    notes: NoteStore,
    notebooks: NotebookStore,
    tags: TagStore,
    editor: EditorStore,
    calendar: CalendarStore,
    tasks: TaskStore,
    agents: AgentStore,
    comms: CommsStore,
    spreadsheets: SpreadsheetStore,
    // ... 28 stores total

    // Infrastructure
    db: Arc<Database>,
    sync: SyncEngine,
    theme: ThemeEngine,
}

enum Message {
    // Navigation
    Navigate(View),
    GoBack,
    GoForward,

    // Per-view messages
    Notes(notes::Message),
    Editor(editor::Message),
    Dashboard(dashboard::Message),
    // ... one variant per view

    // Cross-cutting
    SyncCompleted(Result<SyncResult>),
    ThemeChanged(Theme),
    DbReady(Arc<Database>),
}
```

Each view module exposes `view()` -> `Element<Message>` and `update()` -> `Command<Message>`, following iced's Elm pattern. This directly maps to how Workstation's React components work — each view has its own state slice and renders independently.

---

## 2. Database Layer (`wiredash-db`)

### Schema Migration from Workstation

Workstation uses SQLite via `better-sqlite3` (Electron) with Kysely query builder. WIREDASH mirrors this exactly:

```rust
// wiredash-db/src/lib.rs
pub struct Database {
    conn: rusqlite::Connection,  // bundled-sqlcipher for encryption-at-rest
}

// 17 collections (1:1 from packages/core)
// notes, notebooks, tags, colors, attachments, relations,
// reminders, shortcuts, settings, vault, content,
// session_history, note_history, monographs,
// trash, sync_state, kv_store
```

**Key design decisions:**
- `rusqlite` with `bundled-sqlcipher` feature — same SQLCipher encryption as desktop app, binary-compatible DB files
- No ORM — raw SQL with typed wrapper functions (like Kysely but compile-time checked)
- Migrations stored as embedded SQL files via `include_str!`
- All queries return domain structs via `serde` deserialization from rows
- **DB file compatibility**: WIREDASH reads/writes the same `.db` file as Workstation — zero migration needed for user data

```rust
// Example: note queries
impl Database {
    pub fn get_note(&self, id: &str) -> Result<Note> {
        self.conn.query_row(
            "SELECT * FROM notes WHERE id = ?1 AND deleted = 0",
            [id],
            |row| Note::from_row(row),
        )
    }

    pub fn get_notes(&self, options: QueryOptions) -> Result<Vec<Note>> {
        let mut stmt = self.conn.prepare(&build_query("notes", &options))?;
        let rows = stmt.query_map([], |row| Note::from_row(row))?;
        rows.collect()
    }

    pub fn upsert_note(&self, note: &Note) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO notes (id, title, headline, ...) VALUES (?1, ?2, ...)",
            note.to_params(),
        )
    }
}
```

### Grouping & Sorting

```rust
pub enum SortBy { DateCreated, DateModified, Title, DateDeleted }
pub enum GroupBy { None, Year, Month, Week, ABC, Default }
pub enum SortDirection { Asc, Desc }

pub struct QueryOptions {
    pub sort_by: SortBy,
    pub sort_dir: SortDirection,
    pub group_by: GroupBy,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}
```

---

## 3. Crypto Layer (`wiredash-crypto`)

### 1:1 Port of `@notesnook/crypto`

The encryption protocol must be **byte-compatible** with Workstation so synced notes decrypt on both clients.

```rust
// wiredash-crypto/src/lib.rs

/// Key derivation: Argon2id (same params as NN)
pub fn derive_key(password: &str, salt: &[u8]) -> Result<EncryptionKey> {
    // argon2id with OPSLIMIT_MODERATE, MEMLIMIT_MODERATE
    sodiumoxide::crypto::pwhash::derive_key(...)
}

/// Encrypt: XChaCha20-Poly1305 (same as NN)
pub fn encrypt(plaintext: &[u8], key: &EncryptionKey) -> Result<Encrypted> {
    let nonce = secretbox::gen_nonce();
    let ciphertext = secretbox::seal(plaintext, &nonce, &key.0);
    Ok(Encrypted { ciphertext, nonce, salt: key.salt })
}

/// Decrypt
pub fn decrypt(encrypted: &Encrypted, key: &EncryptionKey) -> Result<Vec<u8>> {
    secretbox::open(&encrypted.ciphertext, &encrypted.nonce, &key.0)
        .map_err(|_| CryptoError::DecryptionFailed)
}
```

**Critical compatibility points:**
- Same algorithm: XChaCha20-Poly1305 via libsodium
- Same KDF: Argon2id with identical parameters
- Same encoding: base64 for wire format
- Same nonce generation: random 24 bytes
- Vault encryption uses same scheme with separate key

`sodiumoxide` wraps the same `libsodium` C library that `@notesnook/sodium` uses, so byte output is identical.

---

## 4. Sync Engine (`wiredash-sync`)

### Protocol (mirrors `packages/core/src/api/`)

```rust
pub struct SyncEngine {
    client: reqwest::Client,
    base_url: String,
    auth: Option<AuthToken>,
}

impl SyncEngine {
    /// Full sync flow (same 5-step protocol as NN)
    pub async fn sync(&self, db: &Database) -> Result<SyncResult> {
        // 1. Fetch server timestamp
        let server_time = self.fetch_timestamp().await?;
        // 2. Push local changes (since last sync)
        let pushed = self.push_changes(db, server_time).await?;
        // 3. Pull remote changes
        let pulled = self.pull_changes(db, server_time).await?;
        // 4. Resolve conflicts (last-write-wins, same as NN)
        let resolved = self.resolve_conflicts(db, &pulled)?;
        // 5. Update sync checkpoint
        db.set_last_sync(server_time)?;
        Ok(SyncResult { pushed, pulled, resolved })
    }
}
```

Auth flow: email/password -> server returns JWT -> stored in `keyring` (OS keychain). Same REST API endpoints as Workstation's server.

---

## 5. Markdown Editor (`wiredash-editor`)

This is the most complex custom widget. Replaces TipTap/ProseMirror entirely.

### Architecture

```rust
// wiredash-editor/src/lib.rs
pub struct MarkdownEditor {
    // Source text
    content: iced::widget::text_editor::Content,
    // Parsed AST (updated on every keystroke, debounced)
    ast: Vec<pulldown_cmark::Event<'static>>,
    // Preview HTML rendered to iced elements
    preview_elements: Vec<Element<'static, Message>>,
    // Mode
    mode: EditorMode,
}

pub enum EditorMode {
    Edit,           // Raw markdown with syntax highlighting
    Preview,        // Rendered output only
    Split,          // Side-by-side edit + preview
}

pub enum Message {
    ContentChanged(iced::widget::text_editor::Action),
    ToggleMode(EditorMode),
    InsertHeading(u8),
    InsertBold,
    InsertLink { url: String, text: String },
    // ... toolbar actions
}
```

**Key components:**
- **Edit pane**: iced's built-in `TextEditor` widget with `syntect`-based highlighting for markdown syntax
- **Preview pane**: `pulldown-cmark` parses markdown -> custom renderer converts events to iced `Element` tree (headings, paragraphs, code blocks, lists, images, links)
- **Split view**: iced `PaneGrid` with two panes, synced scroll position
- **Toolbar**: Standard markdown actions (bold, italic, heading, link, image, code, list, quote, table)

### What we lose vs TipTap (acceptable per user decision)

- No WYSIWYG inline editing (markdown source + preview instead)
- No 40+ editor extensions (task lists, tables, math become markdown syntax)
- No collaborative editing
- No embedded attachments inline (images via `![](path)` syntax)

### What we gain

- 10x faster rendering (GPU text, no DOM)
- Zero JavaScript, no browser engine
- Full control over keyboard shortcuts
- Vim-mode possible via key interceptor

---

## 6. Feature Map (31 Views -> Rust Modules)

| # | Workstation View | WIREDASH Module | Complexity |
|---|-----------------|-----------------|------------|
| 1 | dashboard.tsx | `views/dashboard.rs` | Medium |
| 2 | all-notes.tsx | `views/notes.rs` | Low |
| 3 | notebooks.tsx | `views/notebooks.rs` | Low |
| 4 | notes.tsx (tagged/colored/mono) | `views/notes.rs` (filtered) | Low |
| 5 | agents.tsx | `views/agents.rs` | Medium |
| 6 | agent-chat.tsx | `views/agent_chat.rs` | High |
| 7 | tasks.tsx | `views/tasks.rs` | Medium |
| 8 | calendar.tsx | `views/calendar.rs` | High |
| 9 | spreadsheets.tsx | `views/spreadsheets.rs` | High |
| 10 | communications.tsx | `views/comms.rs` | Medium |
| 11 | call-queue.tsx | `views/call_queue.rs` | Low |
| 12 | file-explorer.tsx | `views/file_explorer.rs` | Medium |
| 13 | git-panel.tsx | `views/git_panel.rs` | Medium |
| 14 | terminal.tsx | `views/terminal.rs` | High |
| 15 | conversations.tsx | `views/conversations.rs` | Low |
| 16 | settings (12 panels) | `views/settings/*.rs` | Medium |
| 17 | auth.tsx | `views/auth.rs` | Medium |
| 18 | trash.tsx | `views/trash.rs` | Low |
| 19 | favorites/archive | Filtered note lists | Low |
| 20 | reminders.tsx | `views/reminders.rs` | Low |
| 21 | search.tsx | `views/search.rs` | Medium |
| 22 | newsletters.tsx | `views/newsletters.rs` | Low |
| 23 | checkout/plans | `views/billing.rs` | Medium |
| 24 | code-search.tsx | `views/code_search.rs` | Medium |
| 25 | diagnostics.tsx | `views/diagnostics.rs` | Low |

**Complexity summary:** 5 High, 10 Medium, 10 Low

---

## 7. Development Phases

### Phase 1 — Foundation (wiredash-core + db + crypto)
- Database layer with all 17 collections
- Crypto layer (byte-compatible with NN)
- Core business logic (CRUD for all entities)
- **Test target:** Port `packages/core` test suite (~500 tests)
- **Deliverable:** Library crate that passes core tests, no UI

### Phase 2 — Sync + Auth
- Sync engine (5-step protocol)
- Auth flow (login, signup, JWT management)
- Keyring integration for token storage
- **Test target:** Sync round-trip against NN server
- **Deliverable:** CLI tool that syncs notes

### Phase 3 — Shell + Navigation
- iced Application scaffold
- Sidebar navigation (4 sections, same as Workstation)
- Theme engine (load Workstation JSON themes)
- Window management, system tray, auto-launch
- **Deliverable:** Running app with sidebar, no content views

### Phase 4 — Markdown Editor
- Custom iced widget with edit/preview/split modes
- Syntax highlighting via syntect
- Markdown toolbar
- Session history (undo across sessions)
- **Deliverable:** Functional editor that saves/loads notes

### Phase 5 — Core Views (Notes, Notebooks, Tags, Search)
- Note list with grouping/sorting
- Notebook tree
- Tag management
- Full-text search (SQLite FTS5)
- **Deliverable:** Usable note-taking app

### Phase 6 — Workstation Views (Dashboard, Agents, Tasks, Calendar, etc.)
- All remaining 20+ views
- Agent chat with streaming markdown
- Spreadsheet grid widget
- Calendar week view
- Communications inbox
- **Deliverable:** Feature-complete WIREDASH

### Phase 7 — Developer Tools
- File explorer (port from TS)
- Git panel (git2)
- Terminal (portable-pty + VT100)
- Code search (ripgrep)
- **Deliverable:** Full developer suite

### Phase 8 — Polish + Migration
- Performance profiling
- Accessibility
- Installer/updater (self-update binary)
- Data migration tool (reads Workstation DB, verifies compatibility)
- **Deliverable:** Production-ready v1.0

---

## 8. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| iced lacks mature text editor widget | High | Extend `text_editor` with syntect; fallback: embed `wgpu` custom text renderer |
| Spreadsheet grid in iced is hard | Medium | Virtual scrolling via `lazy` column/row; start with simple table, iterate |
| Calendar week view custom rendering | Medium | Canvas-based drawing on iced `Canvas` widget |
| Terminal VT100 parsing | Medium | Use `vt100` crate (battle-tested); render to iced `Canvas` |
| Sync protocol edge cases | High | Port NN's sync test suite; run against same server |
| Build times | Low | Workspace crates + `sccache` + incremental compilation |
| Cross-platform packaging | Low | `cargo-bundle` for macOS `.app`, NSIS for Windows `.exe`, AppImage for Linux |

---

## Decisions Log

- **Name:** WIREDASH
- **Approach:** Workspace crate split (Approach B)
- **Platforms:** Desktop only (Win/Mac/Linux) at v1.0
- **GUI:** iced 0.14 (GPU-native, Elm-inspired)
- **Editor:** Markdown-only (no rich text/TipTap)
- **DB compatibility:** Same SQLCipher DB files as Workstation
- **Crypto compatibility:** Byte-identical with @notesnook/crypto
- **Development strategy:** Keep Workstation as-is, build WIREDASH in parallel, reference until migration-ready
