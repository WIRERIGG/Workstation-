# Phase 7: LanceDB Migration + Productivity Core

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace SQLite/rusqlite with LanceDB across the entire data layer, then build Dashboard, Tasks, Calendar, and Agents views on top.

**Architecture:** Two sub-phases. 7A rewrites `wiredash-db` and `wiredash-core` to use the `lancedb` Rust crate (async, Arrow-based). 7B adds 3 new tables and 4 new views for productivity features.

**Tech Stack:** lancedb 0.20+, apache-arrow, tokio (async runtime), iced 0.14 (GUI), wiredash-crypto (application-layer encryption)

---

## Phase 7A: SQLite → LanceDB Migration

### Problem

The current `wiredash-db` crate wraps `rusqlite::Connection` with synchronous SQL. All 16 collection modules in `wiredash-core` use raw SQL strings with `rusqlite::params!`. This ties the app to SQLite and prevents leveraging LanceDB's vector search, built-in FTS, and columnar storage.

### Approach

Replace `rusqlite` with the `lancedb` Rust crate. The `Database` struct wraps `lancedb::Connection` instead. All collection methods become `async fn`. Queries use LanceDB's DataFusion-compatible WHERE filters (syntax is nearly identical to current SQL WHERE clauses).

### Key Design Decisions

1. **Async everywhere**: All `Database` methods and collection CRUD become async. The iced app already runs on tokio, so `block_on` or `Command::perform` bridges sync iced update with async DB calls.

2. **Arrow schemas**: Each table gets an Apache Arrow `Schema` definition in a new `schemas.rs` module. Replaces SQL DDL from `schema.rs`.

3. **Query translation**: LanceDB WHERE filters use DataFusion SQL syntax. Most existing WHERE clauses translate directly:
   - `"deleted = 0 AND type = 'note'"` → same
   - `"id = ?1"` → `format!("id = '{}'", id)` (parameterized → interpolated)
   - `ORDER BY` → in-memory sort (LanceDB has limited native sort)

4. **Encryption**: No SQLCipher equivalent in LanceDB. Sensitive fields (content `data`, vault `key`) are encrypted via `wiredash-crypto` before storage and decrypted on read. Non-sensitive metadata (timestamps, IDs, booleans) stays unencrypted for queryability.

5. **Full-text search**: LanceDB has built-in FTS via Tantivy. Replace FTS5 virtual tables with LanceDB FTS indexes on `title` and `data` columns. The `search.rs` collection simplifies.

6. **No transactions**: LanceDB lacks ACID transactions. Acceptable for a single-user desktop app with no concurrent writers.

### Tables Migrated (16)

| Table | Columns | Notes |
|-------|---------|-------|
| notes | 21 cols | title, headline, contentId, pinned, favorite, archived, etc. |
| notebooks | 13 cols | title, description, pinned |
| content | 14 cols | noteId, data (encrypted), locked, sessionId |
| tags | 7 cols | title |
| colors | 8 cols | title, colorCode (unique) |
| attachments | 19 cols | iv, salt, size, hash, mimeType, filename |
| relations | 10 cols | fromType/fromId/toType/toId graph edges |
| reminders | 16 cols | title, date, mode, recurringMode, selectedDays |
| vaults | 8 cols | title, key (encrypted) |
| shortcuts | 9 cols | sortIndex, itemId, itemType |
| monographs | 10 cols | datePublished, selfDestruct, password |
| settings | 8 cols | key (unique), value (JSON) |
| notehistory | 10 cols | noteId, sessionContentId |
| sessioncontent | 12 cols | data, contentType, compressed |
| kv | 3 cols | key/value/dateModified |
| config | 3 cols | name/value/dateModified |

### Collection Modules Rewritten (16)

Each module's methods change from sync rusqlite to async LanceDB:
- `notes.rs` — 10 methods (add, get, list, trashed, update_title, set_pinned, etc.)
- `notebooks.rs` — 6 methods
- `content.rs` — 8 methods
- `tags.rs` — 5 methods
- `colors.rs` — 5 methods
- `attachments.rs` — 5 methods
- `relations.rs` — 6 graph operations
- `reminders.rs` — 5 methods
- `vaults.rs` — 5 methods
- `shortcuts.rs` — 4 methods
- `monographs.rs` — 4 methods
- `settings.rs` — 3 methods
- `note_history.rs` — 5 methods
- `session_content.rs` — 4 methods
- `trash.rs` — 2 cleanup methods
- `search.rs` — 6 FTS methods (simplified with Tantivy)

### `wiredash-db` Changes

**Before:**
```rust
pub struct Database { conn: rusqlite::Connection }
impl Database {
    pub fn open(path, password) -> Result<Self> { ... }
    pub fn execute(sql, params) -> Result<usize> { ... }
    pub fn conn() -> &Connection { ... }
}
```

**After:**
```rust
pub struct Database { conn: lancedb::Connection, tables: HashMap<String, lancedb::Table> }
impl Database {
    pub async fn open(path: &str) -> Result<Self> { ... }
    pub async fn table(&self, name: &str) -> Result<&lancedb::Table> { ... }
    pub async fn create_table(&self, name: &str, schema: Schema) -> Result<()> { ... }
}
```

---

## Phase 7B: Productivity Core Views

### New Tables (3)

#### tasks
| Column | Type | Description |
|--------|------|-------------|
| id | Utf8 (PK) | UUID |
| type | Utf8 | "task" |
| dateModified | Int64 | Timestamp ms |
| dateCreated | Int64 | Timestamp ms |
| synced | Int32 | Boolean |
| deleted | Int32 | Boolean |
| title | Utf8 | Task title |
| description | Utf8 | Rich text body |
| status | Utf8 | "open" / "in_progress" / "done" / "cancelled" |
| priority | Utf8 | "low" / "medium" / "high" / "urgent" |
| assignee | Utf8 | Agent name or "user" |
| dueDate | Int64 | Optional deadline timestamp |
| labels | Utf8 | JSON array of strings |
| parentId | Utf8 | Sub-task FK |

#### calendar_events
| Column | Type | Description |
|--------|------|-------------|
| id | Utf8 (PK) | UUID |
| type | Utf8 | "event" |
| dateModified | Int64 | Timestamp ms |
| dateCreated | Int64 | Timestamp ms |
| synced | Int32 | Boolean |
| deleted | Int32 | Boolean |
| title | Utf8 | Event title |
| description | Utf8 | Event details |
| startDate | Int64 | Start timestamp ms |
| endDate | Int64 | End timestamp ms |
| allDay | Int32 | Boolean |
| color | Utf8 | Display color hex |
| recurrence | Utf8 | JSON recurrence rule |
| source | Utf8 | "user" / "agent" / "reminder" |

#### agents
| Column | Type | Description |
|--------|------|-------------|
| id | Utf8 (PK) | UUID |
| type | Utf8 | "agent" |
| dateModified | Int64 | Timestamp ms |
| dateCreated | Int64 | Timestamp ms |
| synced | Int32 | Boolean |
| deleted | Int32 | Boolean |
| name | Utf8 | Display name |
| role | Utf8 | "orchestrator" / "comms" / "research" / "taskmaster" / "code" |
| status | Utf8 | "active" / "idle" / "busy" / "offline" |
| model | Utf8 | LLM model identifier |
| systemPrompt | Utf8 | Agent instructions |
| capabilities | Utf8 | JSON array |
| lastActive | Int64 | Last activity timestamp ms |

### New Collection Modules (3)

- `tasks.rs` — add, get, list, update, remove, list_by_status, list_by_assignee, list_overdue
- `calendar_events.rs` — add, get, list, remove, list_for_date_range, list_for_day
- `agents.rs` — add, get, list, update_status, update_config, remove

### New Views (4)

#### Dashboard (`dashboard_view.rs`)
Mission control layout:
- **Header**: Greeting + current date/time
- **Stat row**: 4 cards (Total Notes count, Open Tasks count, Today's Events count, Active Agents count)
- **Two-column body**:
  - Left: Today's Schedule (chronological list of today's events)
  - Right: Priority Tasks (top 5 by priority then due date)
- **Bottom**: Agent status strip (5 agents with status indicators)

#### Tasks (`tasks_view.rs`)
Split-panel layout (like Notes view):
- **Left panel** (320px): Task list with status filter tabs (All / Open / In Progress / Done)
- **Right panel** (Fill): Task detail/edit form
  - Fields: title, description, status picker, priority picker, assignee picker, due date, labels
  - Action buttons: Save, Delete, Mark Done

#### Calendar (`calendar_view.rs`)
Week view layout:
- **Header**: Week navigation (< This Week >) + "New Event" button
- **Grid**: 7 columns (Mon-Sun) × 24 hour rows
- **Events**: Colored blocks positioned by start/end time
- **Click to create**: Click empty slot → new event form

#### Agents (`agents_view.rs`)
Card grid layout:
- **Grid**: 5 agent cards (Orchestrator, Comms, Research, TaskMaster, Code)
- **Each card**: Name, role, status indicator (colored dot), model name
- **Detail panel**: Click card → edit agent config (name, model, system prompt, capabilities)

---

## Testing Strategy

- **Unit tests**: Each collection module gets CRUD tests against in-memory LanceDB
- **Integration tests**: End-to-end tests verifying data roundtrips through the full stack
- **Migration test**: Verify existing SQLite data can be read after format change (or provide migration utility)
- **View tests**: Verify view state management (create/update/delete flows)

## Risk Mitigation

- **LanceDB API instability**: Pin to specific version, wrap in our own trait for future-proofing
- **Performance**: LanceDB is optimized for analytical/vector workloads, not OLTP. For our scale (thousands of records, single user), this is fine
- **Encryption gap**: Application-layer encryption for content fields is sufficient; OS-level encryption covers the rest
