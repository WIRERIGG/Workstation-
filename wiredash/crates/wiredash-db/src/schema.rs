const SCHEMA_SQL: &str = r#"
-- notes (with trash columns, all indices)
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    dateDeleted INTEGER, itemType TEXT, deletedBy TEXT,
    title TEXT COLLATE NOCASE, headline TEXT, contentId TEXT,
    pinned BOOLEAN, favorite BOOLEAN, localOnly BOOLEAN, conflicted BOOLEAN, readonly BOOLEAN,
    dateEdited INTEGER, isGeneratedTitle BOOLEAN, archived BOOLEAN, expiryDate TEXT
);
CREATE INDEX IF NOT EXISTS note_type ON notes(type);
CREATE INDEX IF NOT EXISTS note_deleted ON notes(deleted);
CREATE INDEX IF NOT EXISTS note_date_deleted ON notes(dateDeleted);

-- notebooks
CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    dateDeleted INTEGER, itemType TEXT, deletedBy TEXT,
    title TEXT COLLATE NOCASE, description TEXT, dateEdited INTEGER, pinned BOOLEAN
);
CREATE INDEX IF NOT EXISTS notebook_type ON notebooks(type);

-- content
CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    noteId TEXT, data TEXT, locked BOOLEAN, localOnly BOOLEAN,
    conflicted TEXT, sessionId TEXT, dateEdited INTEGER, dateResolved INTEGER
);
CREATE INDEX IF NOT EXISTS content_noteId ON content(noteId);

-- tags
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    title TEXT COLLATE NOCASE
);

-- colors
CREATE TABLE IF NOT EXISTS colors (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    title TEXT COLLATE NOCASE, colorCode TEXT UNIQUE
);

-- attachments
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    iv TEXT, salt TEXT, size INTEGER, alg TEXT, key TEXT, chunkSize INTEGER,
    hash TEXT UNIQUE, hashType TEXT, mimeType TEXT, filename TEXT,
    dateDeleted INTEGER, dateUploaded INTEGER, failed TEXT
);
CREATE INDEX IF NOT EXISTS attachment_hash ON attachments(hash);

-- relations
CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    fromType TEXT, fromId TEXT, toType TEXT, toId TEXT
);
CREATE INDEX IF NOT EXISTS relation_from_general ON relations(fromType, toType, fromId);
CREATE INDEX IF NOT EXISTS relation_to_general ON relations(fromType, toType, toId);

-- reminders
CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    title TEXT COLLATE NOCASE, description TEXT, priority TEXT, date INTEGER, mode TEXT,
    recurringMode TEXT, selectedDays TEXT, localOnly BOOLEAN, disabled BOOLEAN, snoozeUntil INTEGER
);

-- vaults
CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    title TEXT COLLATE NOCASE, key TEXT
);

-- shortcuts
CREATE TABLE IF NOT EXISTS shortcuts (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    sortIndex INTEGER, itemId TEXT, itemType TEXT
);

-- monographs
CREATE TABLE IF NOT EXISTS monographs (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    datePublished INTEGER, title TEXT COLLATE NOCASE, selfDestruct BOOLEAN, password TEXT
);

-- settings
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    key TEXT UNIQUE, value TEXT
);

-- notehistory
CREATE TABLE IF NOT EXISTS notehistory (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    noteId TEXT, sessionContentId TEXT, localOnly BOOLEAN, locked BOOLEAN
);
CREATE INDEX IF NOT EXISTS notehistory_noteid ON notehistory(noteId);

-- sessioncontent
CREATE TABLE IF NOT EXISTS sessioncontent (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT, dateModified INTEGER, dateCreated INTEGER, synced BOOLEAN, deleted BOOLEAN,
    data TEXT, contentType TEXT, locked BOOLEAN, compressed BOOLEAN, localOnly BOOLEAN, title TEXT
);

-- kv
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY NOT NULL, value TEXT, dateModified INTEGER
);

-- config
CREATE TABLE IF NOT EXISTS config (
    name TEXT PRIMARY KEY NOT NULL, value TEXT, dateModified INTEGER
);

-- FTS5 (use tokenize='porter' only)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, title, content='notes', tokenize='porter');
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(id UNINDEXED, noteId UNINDEXED, data, content='content', tokenize='porter');
"#;

pub fn create_all_tables(db: &crate::Database) -> Result<(), anyhow::Error> {
    db.conn().execute_batch(SCHEMA_SQL)?;
    Ok(())
}
