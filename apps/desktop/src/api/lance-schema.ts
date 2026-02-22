/*
This file is part of the Workstation project

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Apache Arrow schema definitions for LanceDB tables, matching
 * the DatabaseSchema from packages/core.
 *
 * All apache-arrow access uses require() inside functions (not top-level
 * imports) so Vite/esbuild doesn't try to bundle the native module.
 *
 * SQLite types are mapped as follows:
 *   TEXT      → Utf8
 *   INTEGER   → Int64 (for dates/timestamps) or Int32 (for booleans stored as 0/1)
 *   BOOLEAN   → Int32 (SQLite stores booleans as 0/1)
 *
 * The `id` field is always non-nullable (primary key).
 * All other fields are nullable to match SQLiteItem<T> where all fields
 * except `id` are optional.
 */

import type { Schema as ArrowSchema } from "apache-arrow";

// Lazy-load apache-arrow to avoid Vite bundling native modules
function getArrow() {
  return require("apache-arrow") as typeof import("apache-arrow");
}

let _schemasCache: Record<string, ArrowSchema> | undefined;

function buildSchemas(): Record<string, ArrowSchema> {
  const { Schema, Field, Utf8, LargeUtf8, Int32, Int64 } = getArrow();

  const utf8 = () => new Utf8();
  const int32 = () => new Int32();
  const int64 = () => new Int64();

  const idField = () => new Field("id", utf8(), false);

  function baseFields() {
    return [
      idField(),
      new Field("type", utf8(), true),
      new Field("dateModified", int64(), true),
      new Field("dateCreated", int64(), true),
      new Field("synced", int32(), true),
      new Field("deleted", int32(), true)
    ];
  }

  function trashFields() {
    return [
      new Field("dateDeleted", int64(), true),
      new Field("itemType", utf8(), true),
      new Field("deletedBy", utf8(), true)
    ];
  }

  return {
    kv: new Schema([
      new Field("key", utf8(), false),
      new Field("value", utf8(), true),
      new Field("dateModified", int64(), true)
    ]),

    config: new Schema([
      new Field("name", utf8(), false),
      new Field("value", utf8(), true),
      new Field("dateModified", int64(), true)
    ]),

    notes: new Schema([
      ...baseFields(),
      ...trashFields(),
      new Field("title", utf8(), true),
      new Field("headline", utf8(), true),
      new Field("contentId", utf8(), true),
      new Field("pinned", int32(), true),
      new Field("favorite", int32(), true),
      new Field("localOnly", int32(), true),
      new Field("conflicted", int32(), true),
      new Field("readonly", int32(), true),
      new Field("dateEdited", int64(), true),
      new Field("isGeneratedTitle", int32(), true),
      new Field("archived", int32(), true),
      new Field("expiryDate", utf8(), true)
    ]),

    content: new Schema([
      ...baseFields(),
      new Field("noteId", utf8(), true),
      new Field("data", utf8(), true),
      new Field("locked", int32(), true),
      new Field("localOnly", int32(), true),
      new Field("conflicted", utf8(), true),
      new Field("sessionId", utf8(), true),
      new Field("dateEdited", int64(), true),
      new Field("dateResolved", int64(), true)
    ]),

    notehistory: new Schema([
      ...baseFields(),
      new Field("noteId", utf8(), true),
      new Field("sessionContentId", utf8(), true),
      new Field("localOnly", int32(), true),
      new Field("locked", int32(), true)
    ]),

    sessioncontent: new Schema([
      ...baseFields(),
      new Field("data", utf8(), true),
      new Field("contentType", utf8(), true),
      new Field("locked", int32(), true),
      new Field("compressed", int32(), true),
      new Field("localOnly", int32(), true),
      new Field("title", utf8(), true)
    ]),

    notebooks: new Schema([
      ...baseFields(),
      ...trashFields(),
      new Field("title", utf8(), true),
      new Field("description", utf8(), true),
      new Field("dateEdited", int64(), true),
      new Field("pinned", int32(), true)
    ]),

    tags: new Schema([
      ...baseFields(),
      new Field("title", utf8(), true)
    ]),

    colors: new Schema([
      ...baseFields(),
      new Field("title", utf8(), true),
      new Field("colorCode", utf8(), true)
    ]),

    vaults: new Schema([
      ...baseFields(),
      new Field("title", utf8(), true),
      new Field("key", utf8(), true)
    ]),

    relations: new Schema([
      ...baseFields(),
      new Field("fromType", utf8(), true),
      new Field("fromId", utf8(), true),
      new Field("toType", utf8(), true),
      new Field("toId", utf8(), true)
    ]),

    shortcuts: new Schema([
      ...baseFields(),
      new Field("sortIndex", int32(), true),
      new Field("itemId", utf8(), true),
      new Field("itemType", utf8(), true)
    ]),

    reminders: new Schema([
      ...baseFields(),
      new Field("title", utf8(), true),
      new Field("description", utf8(), true),
      new Field("priority", utf8(), true),
      new Field("date", int64(), true),
      new Field("mode", utf8(), true),
      new Field("recurringMode", utf8(), true),
      new Field("selectedDays", utf8(), true),
      new Field("localOnly", int32(), true),
      new Field("disabled", int32(), true),
      new Field("snoozeUntil", int64(), true)
    ]),

    attachments: new Schema([
      ...baseFields(),
      new Field("iv", utf8(), true),
      new Field("salt", utf8(), true),
      new Field("size", int64(), true),
      new Field("alg", utf8(), true),
      new Field("key", utf8(), true),
      new Field("chunkSize", int32(), true),
      new Field("hash", utf8(), true),
      new Field("hashType", utf8(), true),
      new Field("mimeType", utf8(), true),
      new Field("filename", utf8(), true),
      new Field("dateDeleted", int64(), true),
      new Field("dateUploaded", int64(), true),
      new Field("failed", utf8(), true)
    ]),

    settings: new Schema([
      ...baseFields(),
      new Field("key", utf8(), true),
      new Field("value", utf8(), true)
    ]),

    monographs: new Schema([
      ...baseFields(),
      new Field("datePublished", int64(), true),
      new Field("title", utf8(), true),
      new Field("selfDestruct", int32(), true),
      new Field("password", utf8(), true)
    ]),

    // Logger table (created by NNLogsMigrationProvider)
    logs: new Schema([
      new Field("timestamp", int64(), false),
      new Field("message", new LargeUtf8(), false),
      new Field("level", int64(), true),
      new Field("date", utf8(), true),
      new Field("scope", utf8(), true),
      new Field("extras", new LargeUtf8(), true),
      new Field("elapsed", int64(), true)
    ]),

    // Kysely migration tracking table
    kysely_migration: new Schema([
      new Field("name", utf8(), false),
      new Field("timestamp", utf8(), true)
    ]),

    // Kysely migration lock table
    kysely_migration_lock: new Schema([
      new Field("id", utf8(), false),
      new Field("is_locked", int64(), true)
    ])
  };
}

/**
 * Get the schema for a table. Returns undefined for FTS virtual tables
 * and other non-standard tables. Lazy-loads apache-arrow on first call.
 */
export function getSchema(tableName: string): ArrowSchema | undefined {
  if (!_schemasCache) _schemasCache = buildSchemas();
  return _schemasCache[tableName];
}

/**
 * Get the primary key column name for a table.
 */
export function getPrimaryKey(tableName: string): string {
  if (tableName === "kv") return "key";
  if (tableName === "config") return "name";
  if (tableName === "kysely_migration") return "name";
  if (tableName === "kysely_migration_lock") return "id";
  if (tableName === "logs") return "timestamp";
  return "id";
}

/**
 * Get column names from a schema.
 */
export function getColumnNames(schema: ArrowSchema): string[] {
  return schema.fields.map((f) => f.name);
}

/**
 * Tables that use FTS (full-text search). These are virtual tables in SQLite
 * that map to LanceDB FTS indexes instead of separate tables.
 */
export const FTS_TABLES: Record<string, { contentTable: string; indexedColumns: string[] }> = {
  notes_fts: {
    contentTable: "notes",
    indexedColumns: ["title"]
  },
  content_fts: {
    contentTable: "content",
    indexedColumns: ["data"]
  }
};
