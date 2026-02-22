# Phase 7: LanceDB Migration + Productivity Core — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace SQLite/rusqlite with the `lancedb` Rust crate across the entire data layer, then build Dashboard, Tasks, Calendar, and Agents views on top.

**Architecture:** The `wiredash-db` crate swaps `rusqlite::Connection` for `lancedb::Connection`. A `sync_run()` bridge function uses `tokio::task::block_in_place` + `Handle::current().block_on()` to call async LanceDB from iced's sync `update()`. Arrow RecordBatch ↔ HashMap conversion utilities centralize serialization. All 16 existing collections + 3 new ones use LanceDB's query/merge_insert/delete API through this bridge.

**Tech Stack:** lancedb 0.26, lance-index 0.26, arrow 57 (arrow-array, arrow-schema), tokio 1, futures 0.3, iced 0.14

---

## Phase 7A: LanceDB Migration

### Task 1: Update Cargo.toml Dependencies

**Files:**
- Modify: `crates/wiredash-db/Cargo.toml`
- Modify: `crates/wiredash-core/Cargo.toml`
- Modify: `Cargo.toml` (workspace)

**Step 1: Update workspace Cargo.toml**

Add arrow and lancedb to workspace dependencies if not already present.

**Step 2: Rewrite `wiredash-db/Cargo.toml`**

```toml
[package]
name = "wiredash-db"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
chrono.workspace = true
thiserror.workspace = true
anyhow.workspace = true
tracing.workspace = true

lancedb = "0.26"
lance-index = "0.26"
arrow = "57"
arrow-array = "57"
arrow-schema = "57"
tokio = { version = "1", features = ["rt-multi-thread"] }
futures = "0.3"

[dev-dependencies]
tempfile = "3"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

Remove: `rusqlite`, `base64`.

**Step 3: Update `wiredash-core/Cargo.toml`**

Remove the direct `rusqlite` dependency. Keep `wiredash-db` dependency.

```toml
[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
anyhow.workspace = true
uuid.workspace = true
chrono.workspace = true
tracing.workspace = true
wiredash-crypto = { path = "../wiredash-crypto" }
wiredash-db = { path = "../wiredash-db" }

[dev-dependencies]
tempfile = "3"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

**Step 4: Verify workspace compiles (expect errors — that's OK)**

Run: `cargo check -p wiredash-db 2>&1 | head -5`

Expected: Compilation errors (rusqlite references removed). This is fine — we'll fix them in subsequent tasks.

**Step 5: Commit**

```bash
git add crates/wiredash-db/Cargo.toml crates/wiredash-core/Cargo.toml Cargo.toml
git commit -s -m "misc: replace rusqlite with lancedb + arrow dependencies"
```

---

### Task 2: Create Arrow Schema Definitions

**Files:**
- Create: `crates/wiredash-db/src/schemas.rs`
- Modify: `crates/wiredash-db/src/lib.rs`

**Step 1: Create `schemas.rs` with Arrow Schema for every table**

Each table gets a `pub fn <table>_schema() -> Arc<Schema>` function returning an Arrow schema. All string columns use `DataType::Utf8`. Boolean columns use `DataType::Int32` (matching SQLite convention of 0/1). Timestamp columns use `DataType::Int64`.

```rust
use std::sync::Arc;
use arrow_schema::{DataType, Field, Schema};

pub fn notes_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("dateDeleted", DataType::Int64, true),
        Field::new("itemType", DataType::Utf8, true),
        Field::new("deletedBy", DataType::Utf8, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("headline", DataType::Utf8, true),
        Field::new("contentId", DataType::Utf8, true),
        Field::new("pinned", DataType::Int32, true),
        Field::new("favorite", DataType::Int32, true),
        Field::new("localOnly", DataType::Int32, true),
        Field::new("conflicted", DataType::Int32, true),
        Field::new("readonly", DataType::Int32, true),
        Field::new("dateEdited", DataType::Int64, true),
        Field::new("isGeneratedTitle", DataType::Int32, true),
        Field::new("archived", DataType::Int32, true),
        Field::new("expiryDate", DataType::Utf8, true),
    ]))
}

pub fn notebooks_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("dateDeleted", DataType::Int64, true),
        Field::new("itemType", DataType::Utf8, true),
        Field::new("deletedBy", DataType::Utf8, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("description", DataType::Utf8, true),
        Field::new("dateEdited", DataType::Int64, true),
        Field::new("pinned", DataType::Int32, true),
    ]))
}

pub fn content_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("noteId", DataType::Utf8, true),
        Field::new("data", DataType::Utf8, true),
        Field::new("locked", DataType::Int32, true),
        Field::new("localOnly", DataType::Int32, true),
        Field::new("conflicted", DataType::Utf8, true),
        Field::new("sessionId", DataType::Utf8, true),
        Field::new("dateEdited", DataType::Int64, true),
        Field::new("dateResolved", DataType::Int64, true),
    ]))
}

pub fn tags_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("title", DataType::Utf8, true),
    ]))
}

pub fn colors_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("colorCode", DataType::Utf8, true),
    ]))
}

pub fn attachments_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("iv", DataType::Utf8, true),
        Field::new("salt", DataType::Utf8, true),
        Field::new("size", DataType::Int64, true),
        Field::new("alg", DataType::Utf8, true),
        Field::new("key", DataType::Utf8, true),
        Field::new("chunkSize", DataType::Int64, true),
        Field::new("hash", DataType::Utf8, true),
        Field::new("hashType", DataType::Utf8, true),
        Field::new("mimeType", DataType::Utf8, true),
        Field::new("filename", DataType::Utf8, true),
        Field::new("dateDeleted", DataType::Int64, true),
        Field::new("dateUploaded", DataType::Int64, true),
        Field::new("failed", DataType::Utf8, true),
    ]))
}

pub fn relations_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("fromType", DataType::Utf8, true),
        Field::new("fromId", DataType::Utf8, true),
        Field::new("toType", DataType::Utf8, true),
        Field::new("toId", DataType::Utf8, true),
    ]))
}

pub fn reminders_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("description", DataType::Utf8, true),
        Field::new("priority", DataType::Utf8, true),
        Field::new("date", DataType::Int64, true),
        Field::new("mode", DataType::Utf8, true),
        Field::new("recurringMode", DataType::Utf8, true),
        Field::new("selectedDays", DataType::Utf8, true),
        Field::new("localOnly", DataType::Int32, true),
        Field::new("disabled", DataType::Int32, true),
        Field::new("snoozeUntil", DataType::Int64, true),
    ]))
}

pub fn vaults_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("key", DataType::Utf8, true),
    ]))
}

pub fn shortcuts_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("sortIndex", DataType::Int64, true),
        Field::new("itemId", DataType::Utf8, true),
        Field::new("itemType", DataType::Utf8, true),
    ]))
}

pub fn monographs_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("datePublished", DataType::Int64, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("selfDestruct", DataType::Int32, true),
        Field::new("password", DataType::Utf8, true),
    ]))
}

pub fn settings_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("key", DataType::Utf8, true),
        Field::new("value", DataType::Utf8, true),
    ]))
}

pub fn notehistory_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("noteId", DataType::Utf8, true),
        Field::new("sessionContentId", DataType::Utf8, true),
        Field::new("localOnly", DataType::Int32, true),
        Field::new("locked", DataType::Int32, true),
    ]))
}

pub fn sessioncontent_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("data", DataType::Utf8, true),
        Field::new("contentType", DataType::Utf8, true),
        Field::new("locked", DataType::Int32, true),
        Field::new("compressed", DataType::Int32, true),
        Field::new("localOnly", DataType::Int32, true),
        Field::new("title", DataType::Utf8, true),
    ]))
}

pub fn kv_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("key", DataType::Utf8, false),
        Field::new("value", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
    ]))
}

pub fn config_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("name", DataType::Utf8, false),
        Field::new("value", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
    ]))
}

/// All table schemas. Returns (name, schema) pairs.
pub fn all_schemas() -> Vec<(&'static str, Arc<Schema>)> {
    vec![
        ("notes", notes_schema()),
        ("notebooks", notebooks_schema()),
        ("content", content_schema()),
        ("tags", tags_schema()),
        ("colors", colors_schema()),
        ("attachments", attachments_schema()),
        ("relations", relations_schema()),
        ("reminders", reminders_schema()),
        ("vaults", vaults_schema()),
        ("shortcuts", shortcuts_schema()),
        ("monographs", monographs_schema()),
        ("settings", settings_schema()),
        ("notehistory", notehistory_schema()),
        ("sessioncontent", sessioncontent_schema()),
        ("kv", kv_schema()),
        ("config", config_schema()),
    ]
}
```

**Step 2: Register in `lib.rs`**

Replace old `schema` module with new `schemas` module.

**Step 3: Commit**

```bash
git add crates/wiredash-db/src/schemas.rs crates/wiredash-db/src/lib.rs
git commit -s -m "core: add Arrow schema definitions for all 16 tables"
```

---

### Task 3: Arrow Conversion Utilities + Sync Bridge

**Files:**
- Create: `crates/wiredash-db/src/arrow_utils.rs`
- Modify: `crates/wiredash-db/src/lib.rs`

**Step 1: Create `arrow_utils.rs`**

This module provides:
1. `sync_run(future)` — bridge async LanceDB calls into sync context
2. `batches_to_maps(batches)` — convert `Vec<RecordBatch>` to `Vec<HashMap<String, Value>>`
3. `maps_to_batch(schema, maps)` — convert maps to RecordBatch for inserts
4. `escape_str(s)` — escape string for DataFusion SQL filters

```rust
use std::collections::HashMap;
use std::sync::Arc;
use arrow_array::{RecordBatch, StringArray, Int32Array, Int64Array, Array};
use arrow_schema::{DataType, Schema};
use futures::TryStreamExt;
use serde_json::Value;

/// Run an async future from synchronous iced context.
/// Uses block_in_place to avoid deadlocking iced's tokio runtime.
/// REQUIRES: iced must be running with multi-threaded tokio runtime (features = ["tokio"]).
pub fn sync_run<F: std::future::Future>(f: F) -> F::Output {
    tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(f)
    })
}

/// Convert a Vec<RecordBatch> (from LanceDB query) into Vec<HashMap<String, Value>>.
pub fn batches_to_maps(batches: &[RecordBatch]) -> Vec<HashMap<String, Value>> {
    let mut result = Vec::new();
    for batch in batches {
        let schema = batch.schema();
        for row_idx in 0..batch.num_rows() {
            let mut map = HashMap::new();
            for (col_idx, field) in schema.fields().iter().enumerate() {
                let col = batch.column(col_idx);
                let val = array_value_at(col.as_ref(), row_idx);
                map.insert(field.name().clone(), val);
            }
            result.push(map);
        }
    }
    result
}

/// Extract a single value from an Arrow array at a given row index.
fn array_value_at(array: &dyn Array, idx: usize) -> Value {
    if array.is_null(idx) {
        return Value::Null;
    }
    match array.data_type() {
        DataType::Utf8 => {
            let arr = array.as_any().downcast_ref::<StringArray>().unwrap();
            Value::String(arr.value(idx).to_string())
        }
        DataType::Int32 => {
            let arr = array.as_any().downcast_ref::<Int32Array>().unwrap();
            Value::Number(arr.value(idx).into())
        }
        DataType::Int64 => {
            let arr = array.as_any().downcast_ref::<Int64Array>().unwrap();
            Value::Number(arr.value(idx).into())
        }
        _ => Value::Null,
    }
}

/// Convert a Vec<HashMap<String, Value>> into a RecordBatch for LanceDB insert.
pub fn maps_to_batch(
    schema: &Arc<Schema>,
    maps: &[HashMap<String, Value>],
) -> Result<RecordBatch, anyhow::Error> {
    let num_rows = maps.len();
    let mut columns: Vec<Arc<dyn Array>> = Vec::new();

    for field in schema.fields() {
        match field.data_type() {
            DataType::Utf8 => {
                let values: Vec<Option<String>> = maps.iter().map(|m| {
                    m.get(field.name()).and_then(|v| match v {
                        Value::String(s) => Some(s.clone()),
                        Value::Null => None,
                        other => Some(other.to_string()),
                    })
                }).collect();
                columns.push(Arc::new(StringArray::from(values)));
            }
            DataType::Int32 => {
                let values: Vec<Option<i32>> = maps.iter().map(|m| {
                    m.get(field.name()).and_then(|v| match v {
                        Value::Number(n) => n.as_i64().map(|n| n as i32),
                        Value::Bool(b) => Some(if *b { 1 } else { 0 }),
                        Value::Null => None,
                        _ => None,
                    })
                }).collect();
                columns.push(Arc::new(Int32Array::from(values)));
            }
            DataType::Int64 => {
                let values: Vec<Option<i64>> = maps.iter().map(|m| {
                    m.get(field.name()).and_then(|v| match v {
                        Value::Number(n) => n.as_i64(),
                        Value::Null => None,
                        _ => None,
                    })
                }).collect();
                columns.push(Arc::new(Int64Array::from(values)));
            }
            _ => {
                // Fallback: null array
                let values: Vec<Option<String>> = vec![None; num_rows];
                columns.push(Arc::new(StringArray::from(values)));
            }
        }
    }

    Ok(RecordBatch::try_new(schema.clone(), columns)?)
}

/// Escape a string value for use in DataFusion SQL filter expressions.
/// Single quotes are doubled: "O'Brien" → "'O''Brien'"
pub fn escape_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Collect a LanceDB query stream into Vec<RecordBatch>.
pub async fn collect_batches(
    stream: lancedb::query::SendableRecordBatchStream,
) -> Result<Vec<RecordBatch>, anyhow::Error> {
    Ok(stream.try_collect::<Vec<_>>().await?)
}
```

**Step 2: Register in `lib.rs`**

```rust
pub mod connection;
pub mod schemas;
pub mod arrow_utils;
pub mod kv;

pub use connection::Database;
pub use arrow_utils::{sync_run, batches_to_maps, maps_to_batch, escape_str, collect_batches};
```

**Step 3: Commit**

```bash
git add crates/wiredash-db/src/arrow_utils.rs crates/wiredash-db/src/lib.rs
git commit -s -m "core: add Arrow conversion utilities and sync bridge"
```

---

### Task 4: Rewrite Database Connection

**Files:**
- Rewrite: `crates/wiredash-db/src/connection.rs`

**Step 1: Rewrite `connection.rs`**

Replace rusqlite `Connection` with `lancedb::Connection`. Store table handles in a `HashMap`. Provide `ensure_tables()` to create all tables on open.

```rust
use std::collections::HashMap;
use std::sync::Arc;
use arrow_schema::Schema;
use lancedb::Table;

pub struct Database {
    conn: lancedb::Connection,
    tables: HashMap<String, Table>,
    path: String,
}

impl Database {
    /// Open (or create) a LanceDB database at the given directory path.
    pub async fn open(path: &str) -> Result<Self, anyhow::Error> {
        let conn = lancedb::connect(path).execute().await?;

        let mut tables = HashMap::new();
        let existing = conn.table_names().execute().await?;
        for name in &existing {
            let t = conn.open_table(name).execute().await?;
            tables.insert(name.clone(), t);
        }

        let mut db = Self {
            conn,
            tables,
            path: path.to_string(),
        };
        db.ensure_tables().await?;
        Ok(db)
    }

    /// Open an in-memory database for testing.
    /// LanceDB doesn't have a true in-memory mode, so we use a temp directory.
    pub async fn open_memory() -> Result<Self, anyhow::Error> {
        let dir = std::env::temp_dir().join(format!("wiredash-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;
        Self::open(dir.to_str().unwrap()).await
    }

    /// Ensure all required tables exist with their Arrow schemas.
    async fn ensure_tables(&mut self) -> Result<(), anyhow::Error> {
        for (name, schema) in crate::schemas::all_schemas() {
            if !self.tables.contains_key(name) {
                let t = self.conn
                    .create_empty_table(name, schema)
                    .execute()
                    .await?;
                self.tables.insert(name.to_string(), t);
            }
        }
        Ok(())
    }

    /// Get a table handle by name.
    pub fn table(&self, name: &str) -> Option<&Table> {
        self.tables.get(name)
    }

    /// Get a table handle by name, or return an error.
    pub fn table_or_err(&self, name: &str) -> Result<&Table, anyhow::Error> {
        self.tables.get(name)
            .ok_or_else(|| anyhow::anyhow!("Table '{}' not found", name))
    }

    /// Get the LanceDB connection.
    pub fn conn(&self) -> &lancedb::Connection {
        &self.conn
    }

    /// Get the database path.
    pub fn path(&self) -> &str {
        &self.path
    }
}
```

**Step 2: Run `cargo check -p wiredash-db`**

Expected: Schema and arrow_utils should compile. Connection module should compile. KV module will still have errors (fixed in Task 5).

**Step 3: Commit**

```bash
git add crates/wiredash-db/src/connection.rs
git commit -s -m "core: rewrite Database connection for LanceDB"
```

---

### Task 5: Rewrite KvStore

**Files:**
- Rewrite: `crates/wiredash-db/src/kv.rs`

**Step 1: Rewrite `kv.rs` to use LanceDB**

```rust
use crate::{Database, sync_run, batches_to_maps, maps_to_batch, escape_str, collect_batches};
use crate::schemas::kv_schema;
use lancedb::query::{ExecutableQuery, QueryBase};
use std::collections::HashMap;

pub struct KvStore<'a> {
    db: &'a Database,
}

impl<'a> KvStore<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn read(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        sync_run(self.read_async(key))
    }

    async fn read_async(&self, key: &str) -> Result<Option<serde_json::Value>, anyhow::Error> {
        let table = self.db.table_or_err("kv")?;
        let filter = format!("key = {}", escape_str(key));
        let batches = table.query()
            .only_if(&filter)
            .limit(1)
            .execute().await?
            .try_collect::<Vec<_>>().await?;
        let maps = batches_to_maps(&batches);
        match maps.first() {
            Some(map) => {
                match map.get("value") {
                    Some(serde_json::Value::String(s)) => Ok(serde_json::from_str(s).ok()),
                    _ => Ok(None),
                }
            }
            None => Ok(None),
        }
    }

    pub fn read_as<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>, anyhow::Error> {
        match self.read(key)? {
            Some(v) => Ok(Some(serde_json::from_value(v)?)),
            None => Ok(None),
        }
    }

    pub fn write(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        sync_run(self.write_async(key, value))
    }

    async fn write_async(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("kv")?;
        let now = chrono::Utc::now().timestamp_millis();
        let val_json = serde_json::to_string(value)?;

        let mut map = HashMap::new();
        map.insert("key".to_string(), serde_json::Value::String(key.to_string()));
        map.insert("value".to_string(), serde_json::Value::String(val_json));
        map.insert("dateModified".to_string(), serde_json::json!(now));

        let batch = maps_to_batch(&kv_schema(), &[map])?;
        let reader = arrow_array::RecordBatchIterator::new(
            vec![Ok(batch)], kv_schema(),
        );
        let mut builder = table.merge_insert(&["key"]);
        builder.when_matched_update_all(None).when_not_matched_insert_all();
        builder.execute(Box::new(reader)).await?;
        Ok(())
    }

    pub fn delete(&self, key: &str) -> Result<(), anyhow::Error> {
        sync_run(self.delete_async(key))
    }

    async fn delete_async(&self, key: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("kv")?;
        let filter = format!("key = {}", escape_str(key));
        table.delete(&filter).await?;
        Ok(())
    }
}
```

**Step 2: Remove old `schema.rs` and `migrations.rs` (no longer needed)**

Delete `crates/wiredash-db/src/schema.rs` and `crates/wiredash-db/src/migrations.rs`. Update `lib.rs` to remove those modules.

**Step 3: Run `cargo check -p wiredash-db`**

Expected: wiredash-db compiles cleanly.

**Step 4: Commit**

```bash
git add -A crates/wiredash-db/
git commit -s -m "core: rewrite KvStore for LanceDB, remove old schema/migrations"
```

---

### Task 6: Test Database + KvStore

**Files:**
- Create: `crates/wiredash-db/tests/lance_db_test.rs`

**Step 1: Write basic tests**

```rust
use wiredash_db::Database;
use wiredash_db::kv::KvStore;

#[tokio::test]
async fn test_open_database() {
    let dir = std::env::temp_dir().join(format!("wiredash-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = Database::open(dir.to_str().unwrap()).await.unwrap();
    // All 16 tables should exist
    assert!(db.table("notes").is_some());
    assert!(db.table("kv").is_some());
    assert!(db.table("config").is_some());
    std::fs::remove_dir_all(&dir).ok();
}

#[tokio::test]
async fn test_kv_write_read() {
    let db = Database::open_memory().await.unwrap();
    let kv = KvStore::new(&db);
    // sync_run won't work in #[tokio::test] — use async methods directly
    // For testing, call async methods directly
    kv.write_async("test_key", &serde_json::json!("hello")).await.unwrap();
    let val = kv.read_async("test_key").await.unwrap();
    assert_eq!(val, Some(serde_json::json!("hello")));
}

#[tokio::test]
async fn test_kv_delete() {
    let db = Database::open_memory().await.unwrap();
    let kv = KvStore::new(&db);
    kv.write_async("del_key", &serde_json::json!(42)).await.unwrap();
    kv.delete_async("del_key").await.unwrap();
    let val = kv.read_async("del_key").await.unwrap();
    assert_eq!(val, None);
}

#[tokio::test]
async fn test_kv_overwrite() {
    let db = Database::open_memory().await.unwrap();
    let kv = KvStore::new(&db);
    kv.write_async("key", &serde_json::json!("first")).await.unwrap();
    kv.write_async("key", &serde_json::json!("second")).await.unwrap();
    let val = kv.read_async("key").await.unwrap();
    assert_eq!(val, Some(serde_json::json!("second")));
}
```

Note: Tests use `#[tokio::test]` and call async methods directly (not `sync_run`, which requires a multi-threaded runtime context that isn't available in test). Make the async methods `pub(crate)` or `pub` for testing.

**Step 2: Run tests**

Run: `cargo test -p wiredash-db`
Expected: All pass.

**Step 3: Commit**

```bash
git add crates/wiredash-db/tests/
git commit -s -m "core: add LanceDB and KvStore tests"
```

---

### Task 7: Rewrite Notes Collection (Template Pattern)

**Files:**
- Rewrite: `crates/wiredash-core/src/collections/notes.rs`

This is the **template** for all other collection rewrites. The pattern is:
1. Struct holds `&Database` reference
2. Each CRUD method has a sync wrapper calling an async implementation
3. Async methods use `table.query()` / `table.merge_insert()` / `table.delete()`
4. Conversion uses `batches_to_maps()` → `note_from_map()` and `note_to_map()` → `maps_to_batch()`

**Step 1: Rewrite `notes.rs`**

```rust
use crate::types::*;
use wiredash_db::{Database, sync_run, batches_to_maps, maps_to_batch, escape_str};
use wiredash_db::schemas::notes_schema;
use lancedb::query::{ExecutableQuery, QueryBase};
use futures::TryStreamExt;
use std::collections::HashMap;
use serde_json::Value;

pub struct Notes<'a> {
    db: &'a Database,
}

fn note_from_map(map: &HashMap<String, Value>) -> Result<Note, anyhow::Error> {
    let get_str = |k: &str| -> String {
        map.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
    };
    let get_opt_str = |k: &str| -> Option<String> {
        map.get(k).and_then(|v| v.as_str()).map(|s| s.to_string())
    };
    let get_i64 = |k: &str| -> Option<i64> {
        map.get(k).and_then(|v| v.as_i64())
    };
    let get_bool = |k: &str| -> Option<bool> {
        map.get(k).and_then(|v| v.as_i64()).map(|n| n != 0)
    };

    let expiry_str = get_opt_str("expiryDate");
    let expiry_date: Option<Value> = expiry_str.and_then(|s| serde_json::from_str(&s).ok());

    Ok(Note {
        base: BaseItem {
            id: get_str("id"),
            item_type: get_str("type"),
            date_modified: get_i64("dateModified"),
            date_created: get_i64("dateCreated"),
            synced: get_bool("synced"),
            deleted: get_bool("deleted"),
        },
        trash: TrashMeta {
            date_deleted: get_i64("dateDeleted"),
            item_type: get_opt_str("itemType"),
            deleted_by: get_opt_str("deletedBy"),
        },
        title: get_str("title"),
        headline: get_opt_str("headline"),
        content_id: get_opt_str("contentId"),
        pinned: get_bool("pinned"),
        favorite: get_bool("favorite"),
        local_only: get_bool("localOnly"),
        conflicted: get_bool("conflicted"),
        readonly: get_bool("readonly"),
        date_edited: get_i64("dateEdited"),
        is_generated_title: get_bool("isGeneratedTitle"),
        archived: get_bool("archived"),
        expiry_date,
    })
}

fn note_to_map(note: &Note) -> HashMap<String, Value> {
    let mut m = HashMap::new();
    m.insert("id".into(), Value::String(note.base.id.clone()));
    m.insert("type".into(), Value::String(note.base.item_type.clone()));
    m.insert("dateModified".into(), note.base.date_modified.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
    m.insert("dateCreated".into(), note.base.date_created.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
    m.insert("synced".into(), note.base.synced.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("deleted".into(), note.base.deleted.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("dateDeleted".into(), note.trash.date_deleted.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
    m.insert("itemType".into(), note.trash.item_type.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::Null));
    m.insert("deletedBy".into(), note.trash.deleted_by.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::Null));
    m.insert("title".into(), Value::String(note.title.clone()));
    m.insert("headline".into(), note.headline.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::Null));
    m.insert("contentId".into(), note.content_id.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::Null));
    m.insert("pinned".into(), note.pinned.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("favorite".into(), note.favorite.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("localOnly".into(), note.local_only.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("conflicted".into(), note.conflicted.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("readonly".into(), note.readonly.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("dateEdited".into(), note.date_edited.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
    m.insert("isGeneratedTitle".into(), note.is_generated_title.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("archived".into(), note.archived.map(|b| Value::Number((b as i32).into())).unwrap_or(Value::Null));
    m.insert("expiryDate".into(), note.expiry_date.as_ref().map(|v| Value::String(serde_json::to_string(v).unwrap_or_default())).unwrap_or(Value::Null));
    m
}

impl<'a> Notes<'a> {
    pub fn new(db: &'a Database) -> Self { Self { db } }

    pub fn add(&self, note: &Note) -> Result<(), anyhow::Error> {
        sync_run(self.add_async(note))
    }

    async fn add_async(&self, note: &Note) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let map = note_to_map(note);
        let batch = maps_to_batch(&notes_schema(), &[map])?;
        let reader = arrow_array::RecordBatchIterator::new(vec![Ok(batch)], notes_schema());
        let mut builder = table.merge_insert(&["id"]);
        builder.when_matched_update_all(None).when_not_matched_insert_all();
        builder.execute(Box::new(reader)).await?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Note>, anyhow::Error> {
        sync_run(self.get_async(id))
    }

    async fn get_async(&self, id: &str) -> Result<Option<Note>, anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let batches = table.query()
            .only_if(&format!("id = {}", escape_str(id)))
            .limit(1)
            .execute().await?
            .try_collect::<Vec<_>>().await?;
        let maps = batches_to_maps(&batches);
        match maps.first() {
            Some(map) => Ok(Some(note_from_map(map)?)),
            None => Ok(None),
        }
    }

    pub fn list(&self, limit: Option<u32>) -> Result<Vec<Note>, anyhow::Error> {
        sync_run(self.list_async(limit))
    }

    async fn list_async(&self, limit: Option<u32>) -> Result<Vec<Note>, anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        let mut query = table.query().only_if("deleted = 0 OR deleted IS NULL");
        if let Some(lim) = limit {
            query = query.limit(lim as usize);
        }
        let batches = query.execute().await?.try_collect::<Vec<_>>().await?;
        let maps = batches_to_maps(&batches);
        let mut notes: Vec<Note> = maps.iter().map(note_from_map).collect::<Result<Vec<_>, _>>()?;
        // Sort by dateModified descending (in-memory, LanceDB has limited sort)
        notes.sort_by(|a, b| b.base.date_modified.cmp(&a.base.date_modified));
        Ok(notes)
    }

    pub fn remove(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(self.remove_async(id))
    }

    async fn remove_async(&self, id: &str) -> Result<(), anyhow::Error> {
        let table = self.db.table_or_err("notes")?;
        table.delete(&format!("id = {}", escape_str(id))).await?;
        Ok(())
    }

    // ... remaining methods (update_title, set_pinned, set_favorite, etc.)
    // follow the same pattern: sync wrapper → async impl → table.update()

    pub fn update_title(&self, id: &str, title: &str) -> Result<(), anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let now = chrono::Utc::now().timestamp_millis();
            table.update()
                .only_if(&format!("id = {}", escape_str(id)))
                .column("title", &escape_str(title))
                .column("dateModified", &now.to_string())
                .column("synced", "0")
                .execute().await?;
            Ok(())
        })
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let now = chrono::Utc::now().timestamp_millis();
            table.update()
                .only_if(&format!("id = {}", escape_str(id)))
                .column("pinned", if pinned { "1" } else { "0" })
                .column("dateModified", &now.to_string())
                .column("synced", "0")
                .execute().await?;
            Ok(())
        })
    }

    pub fn set_favorite(&self, id: &str, fav: bool) -> Result<(), anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let now = chrono::Utc::now().timestamp_millis();
            table.update()
                .only_if(&format!("id = {}", escape_str(id)))
                .column("favorite", if fav { "1" } else { "0" })
                .column("dateModified", &now.to_string())
                .column("synced", "0")
                .execute().await?;
            Ok(())
        })
    }

    pub fn set_archived(&self, id: &str, archived: bool) -> Result<(), anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let now = chrono::Utc::now().timestamp_millis();
            table.update()
                .only_if(&format!("id = {}", escape_str(id)))
                .column("archived", if archived { "1" } else { "0" })
                .column("dateModified", &now.to_string())
                .column("synced", "0")
                .execute().await?;
            Ok(())
        })
    }

    pub fn move_to_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let now = chrono::Utc::now().timestamp_millis();
            table.update()
                .only_if(&format!("id = {}", escape_str(id)))
                .column("deleted", "1")
                .column("dateDeleted", &now.to_string())
                .column("itemType", "'note'")
                .column("deletedBy", "'user'")
                .column("dateModified", &now.to_string())
                .column("synced", "0")
                .execute().await?;
            Ok(())
        })
    }

    pub fn restore_from_trash(&self, id: &str) -> Result<(), anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let now = chrono::Utc::now().timestamp_millis();
            table.update()
                .only_if(&format!("id = {}", escape_str(id)))
                .column("deleted", "0")
                .column("dateDeleted", "NULL")
                .column("itemType", "NULL")
                .column("deletedBy", "NULL")
                .column("dateModified", &now.to_string())
                .column("synced", "0")
                .execute().await?;
            Ok(())
        })
    }

    pub fn trashed(&self) -> Result<Vec<Note>, anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let batches = table.query()
                .only_if("deleted = 1")
                .execute().await?
                .try_collect::<Vec<_>>().await?;
            let maps = batches_to_maps(&batches);
            let mut notes: Vec<Note> = maps.iter().map(note_from_map).collect::<Result<Vec<_>, _>>()?;
            notes.sort_by(|a, b| b.trash.date_deleted.cmp(&a.trash.date_deleted));
            Ok(notes)
        })
    }

    pub fn list_by_ids(&self, ids: &[String]) -> Result<Vec<Note>, anyhow::Error> {
        if ids.is_empty() { return Ok(vec![]); }
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let in_list = ids.iter().map(|id| escape_str(id)).collect::<Vec<_>>().join(", ");
            let batches = table.query()
                .only_if(&format!("id IN ({})", in_list))
                .execute().await?
                .try_collect::<Vec<_>>().await?;
            let maps = batches_to_maps(&batches);
            maps.iter().map(note_from_map).collect()
        })
    }

    pub fn list_filtered(
        &self,
        favorites_only: bool,
        archived_only: bool,
        _sort_by: &str,
        _sort_dir: &str,
        limit: Option<u32>,
    ) -> Result<Vec<Note>, anyhow::Error> {
        sync_run(async {
            let table = self.db.table_or_err("notes")?;
            let mut conditions = vec!["(deleted = 0 OR deleted IS NULL)".to_string()];
            if favorites_only {
                conditions.push("favorite = 1".to_string());
            }
            if archived_only {
                conditions.push("archived = 1".to_string());
            } else {
                conditions.push("(archived = 0 OR archived IS NULL)".to_string());
            }
            let filter = conditions.join(" AND ");
            let mut query = table.query().only_if(&filter);
            if let Some(lim) = limit {
                query = query.limit(lim as usize);
            }
            let batches = query.execute().await?.try_collect::<Vec<_>>().await?;
            let maps = batches_to_maps(&batches);
            let mut notes: Vec<Note> = maps.iter().map(note_from_map).collect::<Result<Vec<_>, _>>()?;
            // Sort: pinned first, then by dateModified descending
            notes.sort_by(|a, b| {
                let ap = a.pinned.unwrap_or(false);
                let bp = b.pinned.unwrap_or(false);
                bp.cmp(&ap).then(b.base.date_modified.cmp(&a.base.date_modified))
            });
            Ok(notes)
        })
    }
}
```

**Step 2: Commit**

```bash
git add crates/wiredash-core/src/collections/notes.rs
git commit -s -m "core: rewrite Notes collection for LanceDB"
```

---

### Task 8: Rewrite All Remaining Core Collections

**Files:**
- Rewrite: `crates/wiredash-core/src/collections/notebooks.rs`
- Rewrite: `crates/wiredash-core/src/collections/content.rs`
- Rewrite: `crates/wiredash-core/src/collections/tags.rs`
- Rewrite: `crates/wiredash-core/src/collections/colors.rs`
- Rewrite: `crates/wiredash-core/src/collections/attachments.rs`
- Rewrite: `crates/wiredash-core/src/collections/relations.rs`
- Rewrite: `crates/wiredash-core/src/collections/reminders.rs`
- Rewrite: `crates/wiredash-core/src/collections/vaults.rs`
- Rewrite: `crates/wiredash-core/src/collections/shortcuts.rs`
- Rewrite: `crates/wiredash-core/src/collections/monographs.rs`
- Rewrite: `crates/wiredash-core/src/collections/settings.rs`
- Rewrite: `crates/wiredash-core/src/collections/note_history.rs`
- Rewrite: `crates/wiredash-core/src/collections/session_content.rs`
- Rewrite: `crates/wiredash-core/src/collections/trash.rs`
- Rewrite: `crates/wiredash-core/src/collections/search.rs`
- Modify: `crates/wiredash-core/src/collections/mod.rs`

**Pattern for each collection:**

Follow the exact same pattern as Notes (Task 7):
1. Replace `use rusqlite::params;` with LanceDB imports
2. Replace `fn xxx_from_row(row: &rusqlite::Row)` with `fn xxx_from_map(map: &HashMap<String, Value>)`
3. Replace `fn xxx_to_map(item: &Xxx) -> HashMap<String, Value>`
4. Each method: `sync_run(async { table.query()/merge_insert()/update()/delete() })`

**Search collection** uses LanceDB FTS instead of SQLite FTS5:
```rust
// Instead of FTS5 virtual tables, use LanceDB's built-in FTS
pub async fn search_notes_async(&self, query: &str) -> Result<Vec<String>> {
    let table = self.db.table_or_err("notes")?;
    let fts_query = FullTextSearchQuery::new(query.to_string());
    let batches = table.query()
        .full_text_search(fts_query)
        .limit(100)
        .execute().await?
        .try_collect::<Vec<_>>().await?;
    let maps = batches_to_maps(&batches);
    Ok(maps.iter().filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(String::from)).collect())
}
```

**Note:** FTS requires creating an index first. Add index creation to `Database::ensure_tables()`:
```rust
// After creating tables, create FTS indexes
if let Some(notes_table) = self.tables.get("notes") {
    let _ = notes_table.create_index(&["title"], Index::FTS(FtsIndexBuilder::default())).execute().await;
}
if let Some(content_table) = self.tables.get("content") {
    let _ = content_table.create_index(&["data"], Index::FTS(FtsIndexBuilder::default())).execute().await;
}
```

**Trash collection** — the `clean_notes` and `clean_notebooks` methods use delete with age filter:
```rust
pub async fn clean_notes_async(&self, days: i64) -> Result<usize> {
    let cutoff = chrono::Utc::now().timestamp_millis() - (days * 86_400_000);
    let table = self.db.table_or_err("notes")?;
    let count = table.count_rows(Some(format!("deleted = 1 AND dateDeleted < {}", cutoff))).await?;
    table.delete(&format!("deleted = 1 AND dateDeleted < {}", cutoff)).await?;
    Ok(count as usize)
}
```

**Step: Commit after each batch of 3-4 collections**

```bash
git commit -s -m "core: rewrite notebooks/content/tags/colors collections for LanceDB"
git commit -s -m "core: rewrite attachments/relations/reminders/vaults collections for LanceDB"
git commit -s -m "core: rewrite shortcuts/monographs/settings/history collections for LanceDB"
git commit -s -m "core: rewrite search (FTS) and trash collections for LanceDB"
```

---

### Task 9: Update wiredash-core Module Structure

**Files:**
- Modify: `crates/wiredash-core/src/collections/mod.rs`
- Modify: `crates/wiredash-core/src/lib.rs`
- Modify: `crates/wiredash-core/Cargo.toml` (verify no rusqlite)

**Step 1: Ensure `collections/mod.rs` exports all modules correctly**

Remove any `use rusqlite` references. All collections should import from `wiredash_db` only.

**Step 2: Run `cargo check -p wiredash-core`**

Expected: Compiles cleanly with no rusqlite references.

**Step 3: Commit**

```bash
git add crates/wiredash-core/
git commit -s -m "core: finalize LanceDB migration for wiredash-core"
```

---

### Task 10: Update wiredash-app for Async Database

**Files:**
- Modify: `crates/wiredash-app/src/main.rs`
- Modify: `crates/wiredash-app/Cargo.toml`

**Step 1: Update Cargo.toml**

Add `tokio` with `rt-multi-thread` feature (if not already present). Remove any direct rusqlite dependency.

**Step 2: Update `main.rs` Database initialization**

The current code opens the database synchronously in `Wiredash::new()`. Change to:

```rust
// In main():
fn main() -> iced::Result {
    // Create a tokio runtime for DB initialization
    let rt = tokio::runtime::Runtime::new().unwrap();

    // Open database before starting iced
    let db_path = get_db_path(); // existing path logic
    let db = rt.block_on(Database::open(&db_path)).unwrap();
    let db = std::sync::Arc::new(db);

    // Leak the runtime so it stays alive (app runs until exit)
    let handle = rt.handle().clone();
    std::mem::forget(rt);

    iced::application("Wiredash", Wiredash::update, Wiredash::view)
        // ... existing settings ...
        .run_with(move || {
            let app = Wiredash::new_with_db(db.clone());
            (app, iced::Task::none())
        })
}
```

**Step 3: Change `self.db` from `Database` to `Arc<Database>`**

Update the `Wiredash` struct and all view state structs to use `Arc<Database>` instead of owned `Database`.

**Step 4: Collection calls remain sync**

All collection calls in views (e.g., `Notes::new(&self.db).list(None)`) continue to work because they use `sync_run()` internally. No changes needed in view update/refresh methods.

**Step 5: Run `cargo check -p wiredash-app`**

Expected: Compiles. Fix any remaining compilation errors.

**Step 6: Commit**

```bash
git add crates/wiredash-app/
git commit -s -m "desktop: update app for async LanceDB database"
```

---

### Task 11: Run Full Test Suite + Fix Issues

**Step 1: Run all tests**

Run: `cargo test --workspace`

Fix any compilation errors or test failures.

**Step 2: Run clippy**

Run: `cargo clippy --workspace -- -W clippy::all`

Fix any warnings.

**Step 3: Build release**

Run: `cargo build`

Verify the app compiles and runs.

**Step 4: Commit**

```bash
git add -A
git commit -s -m "misc: fix Phase 7A LanceDB migration issues"
```

---

## Phase 7B: Productivity Core Views

### Task 12: Add New Schemas + Collections (Tasks, Events, Agents)

**Files:**
- Modify: `crates/wiredash-db/src/schemas.rs` — add 3 new schema functions
- Modify: `crates/wiredash-db/src/schemas.rs` → `all_schemas()` — add new tables
- Create: `crates/wiredash-core/src/collections/tasks.rs`
- Create: `crates/wiredash-core/src/collections/calendar_events.rs`
- Create: `crates/wiredash-core/src/collections/agents.rs`
- Modify: `crates/wiredash-core/src/types.rs` — add Task, CalendarEvent, Agent types
- Modify: `crates/wiredash-core/src/collections/mod.rs`

**Step 1: Add Arrow schemas to `schemas.rs`**

```rust
pub fn tasks_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("description", DataType::Utf8, true),
        Field::new("status", DataType::Utf8, true),
        Field::new("priority", DataType::Utf8, true),
        Field::new("assignee", DataType::Utf8, true),
        Field::new("dueDate", DataType::Int64, true),
        Field::new("labels", DataType::Utf8, true),
        Field::new("parentId", DataType::Utf8, true),
    ]))
}

pub fn calendar_events_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("title", DataType::Utf8, true),
        Field::new("description", DataType::Utf8, true),
        Field::new("startDate", DataType::Int64, true),
        Field::new("endDate", DataType::Int64, true),
        Field::new("allDay", DataType::Int32, true),
        Field::new("color", DataType::Utf8, true),
        Field::new("recurrence", DataType::Utf8, true),
        Field::new("source", DataType::Utf8, true),
    ]))
}

pub fn agents_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("type", DataType::Utf8, true),
        Field::new("dateModified", DataType::Int64, true),
        Field::new("dateCreated", DataType::Int64, true),
        Field::new("synced", DataType::Int32, true),
        Field::new("deleted", DataType::Int32, true),
        Field::new("name", DataType::Utf8, true),
        Field::new("role", DataType::Utf8, true),
        Field::new("status", DataType::Utf8, true),
        Field::new("model", DataType::Utf8, true),
        Field::new("systemPrompt", DataType::Utf8, true),
        Field::new("capabilities", DataType::Utf8, true),
        Field::new("lastActive", DataType::Int64, true),
    ]))
}
```

Add to `all_schemas()`: `("tasks", tasks_schema()), ("calendar_events", calendar_events_schema()), ("agents", agents_schema())`

**Step 2: Add domain types to `types.rs`**

```rust
pub struct Task {
    pub base: BaseItem,
    pub title: String,
    pub description: Option<String>,
    pub status: String,       // "open", "in_progress", "done", "cancelled"
    pub priority: String,     // "low", "medium", "high", "urgent"
    pub assignee: Option<String>,
    pub due_date: Option<i64>,
    pub labels: Option<Vec<String>>,
    pub parent_id: Option<String>,
}

pub struct CalendarEvent {
    pub base: BaseItem,
    pub title: String,
    pub description: Option<String>,
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub all_day: Option<bool>,
    pub color: Option<String>,
    pub recurrence: Option<String>,  // JSON
    pub source: Option<String>,      // "user", "agent", "reminder"
}

pub struct Agent {
    pub base: BaseItem,
    pub name: String,
    pub role: String,
    pub status: String,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub last_active: Option<i64>,
}
```

**Step 3: Create collection modules** following the Notes pattern (Task 7).

**Step 4: Commit**

```bash
git commit -s -m "core: add tasks, calendar_events, agents schemas and collections"
```

---

### Task 13: Dashboard View

**Files:**
- Create: `crates/wiredash-app/src/dashboard_view.rs`
- Modify: `crates/wiredash-app/src/main.rs`

**Implementation:**
- `DashboardViewState` with cached counts (notes, open tasks, today events, active agents)
- `DashboardMessage` enum: Refresh, NavigateTo(View)
- `refresh()` queries all four counts + today's events + top 5 tasks
- Layout: greeting row → 4 stat cards → two-column (schedule | priority tasks) → agent strip
- Wire into `main.rs` View::Dashboard match arm

**Step: Commit**

```bash
git commit -s -m "desktop: add Dashboard view with stats, schedule, and priority tasks"
```

---

### Task 14: Tasks View

**Files:**
- Create: `crates/wiredash-app/src/tasks_view.rs`
- Modify: `crates/wiredash-app/src/main.rs`

**Implementation:**
- `TasksViewState` with task list, selected task, filter (All/Open/InProgress/Done), form fields
- `TasksMessage` enum: Refresh, Select(id), Create, Save, Delete, SetFilter, SetTitle, SetStatus, etc.
- Split layout: left list panel (320px) | vertical rule | right detail/edit panel
- Filter tabs at top of list
- Wire into main.rs

**Step: Commit**

```bash
git commit -s -m "desktop: add Tasks view with list, filters, and edit form"
```

---

### Task 15: Calendar View

**Files:**
- Create: `crates/wiredash-app/src/calendar_view.rs`
- Modify: `crates/wiredash-app/src/main.rs`

**Implementation:**
- `CalendarViewState` with current_week_start, events for visible range, form fields
- `CalendarMessage` enum: PrevWeek, NextWeek, Refresh, CreateEvent, SelectEvent, SaveEvent, DeleteEvent, etc.
- Layout: header (< Mon Feb 23 – Sun Mar 1 >) | 7-column grid | event form overlay
- Each day column shows events sorted by start time
- Wire into main.rs

**Step: Commit**

```bash
git commit -s -m "desktop: add Calendar view with week grid and event management"
```

---

### Task 16: Agents View

**Files:**
- Create: `crates/wiredash-app/src/agents_view.rs`
- Modify: `crates/wiredash-app/src/main.rs`

**Implementation:**
- `AgentsViewState` with agent list, selected agent, form fields
- `AgentsMessage` enum: Refresh, Select(id), UpdateStatus, SaveConfig, etc.
- Seed 5 default agents on first load (Orchestrator, Comms, Research, TaskMaster, Code)
- Layout: card grid (2×3) with status dots | detail panel on right
- Wire into main.rs

**Step: Commit**

```bash
git commit -s -m "desktop: add Agents view with card grid and configuration panel"
```

---

### Task 17: Integration Tests

**Files:**
- Create: `crates/wiredash-core/tests/tasks_test.rs`
- Create: `crates/wiredash-core/tests/calendar_events_test.rs`
- Create: `crates/wiredash-core/tests/agents_test.rs`

**Tests for each collection:**
- Add + get roundtrip
- List with filter
- Update fields
- Delete
- Edge cases (empty list, non-existent ID)

**Step: Commit**

```bash
git commit -s -m "core: add integration tests for tasks, calendar_events, agents"
```

---

### Task 18: Finalize Phase 7

**Step 1: Run full test suite**

```bash
cargo test --workspace
```

Expected: All tests pass.

**Step 2: Run clippy**

```bash
cargo clippy --workspace -- -W clippy::all
```

Fix any warnings.

**Step 3: Build and test the app**

```bash
cargo build
./target/debug/wiredash
```

Navigate to Dashboard, Tasks, Calendar, Agents views. Verify they render correctly.

**Step 4: Final commit**

```bash
git add -A
git commit -s -m "misc: finalize Phase 7 — LanceDB migration + Productivity Core"
```
