/*
This file is part of the Notesnook project (https://notesnook.com/)

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
 * One-time migration from SQLite (better-sqlite3-multiple-ciphers) to LanceDB.
 * Runs when the desktop app detects an existing .sql database but no .lance directory.
 *
 * Flow:
 *   1. Open existing SQLite DB
 *   2. For each table: SELECT * → transform → lanceTable.add(rows)
 *   3. Verify row counts
 *   4. Rename .sql → .sql.bak
 *   5. Store migration version in LanceDB config table
 */

import type { Database } from "better-sqlite3-multiple-ciphers";
import { LanceDriver } from "./lancedb-driver.js";
import { getSchema, getPrimaryKey } from "./lance-schema.js";

const MIGRATION_VERSION = "1.0.0";

/** Tables to migrate in dependency order */
const TABLE_ORDER = [
  "kv",
  "config",
  "notes",
  "content",
  "notebooks",
  "tags",
  "colors",
  "vaults",
  "relations",
  "shortcuts",
  "reminders",
  "attachments",
  "settings",
  "notehistory",
  "sessioncontent",
  "monographs"
];

export interface MigrationResult {
  success: boolean;
  tables: Record<string, { sqliteCount: number; lanceCount: number }>;
  errors: string[];
  durationMs: number;
}

/**
 * Check if migration is needed: SQLite file exists but LanceDB directory does not.
 */
export async function needsMigration(sqlitePath: string): Promise<boolean> {
  const fs = require("fs");
  const lancePath = sqlitePath.replace(/\.sql$/, ".lance");
  const sqliteExists = fs.existsSync(sqlitePath);
  const lanceExists = fs.existsSync(lancePath);
  return sqliteExists && !lanceExists;
}

/**
 * Run the full SQLite → LanceDB migration.
 */
export async function migrateSqliteToLance(
  sqlitePath: string,
  password?: string
): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const tableCounts: Record<string, { sqliteCount: number; lanceCount: number }> = {};
  const lancePath = sqlitePath.replace(/\.sql$/, ".lance");

  // Step 1: Open SQLite database
  let sqlite: Database;
  try {
    sqlite = require("better-sqlite3-multiple-ciphers")(sqlitePath);
    if (password) {
      sqlite.pragma(`key = '${password}'`);
    }
    sqlite.pragma("journal_mode = WAL");
  } catch (e) {
    return {
      success: false,
      tables: {},
      errors: [`Failed to open SQLite database: ${e}`],
      durationMs: Date.now() - startTime
    };
  }

  // Step 2: Open LanceDB
  const lance = new LanceDriver();
  try {
    await lance.open(sqlitePath); // LanceDriver converts .sql → .lance internally
  } catch (e) {
    sqlite.close();
    return {
      success: false,
      tables: {},
      errors: [`Failed to open LanceDB: ${e}`],
      durationMs: Date.now() - startTime
    };
  }

  // Step 3: Get list of existing SQLite tables
  const existingTables = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name)
  );

  // Step 4: Migrate each table
  for (const tableName of TABLE_ORDER) {
    if (!existingTables.has(tableName)) {
      continue;
    }

    // Skip FTS virtual tables — they'll be rebuilt via LanceDB FTS indexes
    if (tableName.endsWith("_fts")) continue;

    const schema = getSchema(tableName);
    if (!schema) {
      errors.push(`No schema defined for table: ${tableName}`);
      continue;
    }

    try {
      // Create the LanceDB table
      const createSql = buildCreateTableSql(tableName, schema);
      await lance.run(createSql);

      // Read all rows from SQLite
      const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all() as any[];
      const sqliteCount = rows.length;

      if (rows.length > 0) {
        // Transform rows for LanceDB compatibility
        const transformed = rows.map((row) => transformRow(row, tableName));

        // Insert in batches to avoid memory issues
        const BATCH_SIZE = 1000;
        const pk = getPrimaryKey(tableName);
        const columns = Object.keys(transformed[0]);

        for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
          const batch = transformed.slice(i, i + BATCH_SIZE);
          const insertSql = buildInsertSql(tableName, columns, batch);
          await lance.run(insertSql, flattenValues(columns, batch));
        }
      }

      // Verify row count
      const countResult = await lance.run<{ "count(*)": number }>(
        `SELECT count(*) as "count(*)" FROM ${tableName}`
      );
      const lanceCount =
        countResult.rows.length > 0 ? countResult.rows[0]["count(*)"] : 0;

      tableCounts[tableName] = { sqliteCount, lanceCount };

      if (sqliteCount !== lanceCount) {
        errors.push(
          `Row count mismatch for ${tableName}: SQLite=${sqliteCount}, LanceDB=${lanceCount}`
        );
      }
    } catch (e) {
      errors.push(`Failed to migrate table ${tableName}: ${e}`);
    }
  }

  // Step 5: Store migration version in LanceDB config
  try {
    await lance.run(
      `REPLACE INTO config ("name", "value", "dateModified") VALUES (?, ?, ?)`,
      ["lance_migration_version", MIGRATION_VERSION, Date.now()]
    );
  } catch (e) {
    errors.push(`Failed to store migration version: ${e}`);
  }

  // Step 6: Create FTS indexes
  try {
    await lance.run(
      `CREATE VIRTUAL TABLE notes_fts USING fts5(id, title, content='notes')`
    );
    await lance.run(
      `CREATE VIRTUAL TABLE content_fts USING fts5(id, noteId, data, content='content')`
    );
  } catch (e) {
    errors.push(`Failed to create FTS indexes: ${e}`);
  }

  // Step 7: Close both databases
  sqlite.close();
  await lance.close();

  // Step 8: Rename SQLite file to .bak
  const fs = require("fs/promises");
  try {
    await fs.rename(sqlitePath, `${sqlitePath}.bak`);
    // Also rename WAL and SHM files if they exist
    for (const ext of ["-wal", "-shm"]) {
      try {
        await fs.rename(`${sqlitePath}${ext}`, `${sqlitePath}${ext}.bak`);
      } catch {
        // WAL/SHM files might not exist
      }
    }
  } catch (e) {
    errors.push(`Failed to rename SQLite backup: ${e}`);
  }

  const success = errors.length === 0;

  console.log(
    `Migration ${success ? "completed" : "completed with errors"} in ${Date.now() - startTime}ms`
  );
  if (errors.length > 0) {
    console.error("Migration errors:", errors);
  }

  return {
    success,
    tables: tableCounts,
    errors,
    durationMs: Date.now() - startTime
  };
}

/**
 * Transform a SQLite row for LanceDB storage. Handles type coercion:
 * - Boolean fields (0/1) stay as integers (LanceDB stores them as Int32)
 * - JSON string fields stay as strings (parsed on read by SqliteBooleanPlugin)
 * - null values stay null
 */
function transformRow(
  row: Record<string, any>,
  _tableName: string
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) {
      result[key] = null;
    } else if (value instanceof Buffer) {
      // Convert Buffer to string (for text fields stored as blobs)
      result[key] = value.toString("utf-8");
    } else {
      result[key] = value;
    }
  }
  return result;
}

function buildCreateTableSql(
  tableName: string,
  schema: import("apache-arrow").Schema
): string {
  const columns = schema.fields.map((f) => {
    const typeName = f.type.toString();
    let sqlType = "TEXT";
    if (typeName.includes("Int32") || typeName.includes("Int64"))
      sqlType = "INTEGER";
    if (typeName.includes("Float")) sqlType = "REAL";

    const nullable = f.nullable ? "" : " NOT NULL";
    const pk =
      (f.name === "id" || f.name === "key" || f.name === "name") &&
      !f.nullable
        ? " PRIMARY KEY"
        : "";
    return `"${f.name}" ${sqlType}${pk}${nullable}`;
  });

  return `CREATE TABLE ${tableName} (${columns.join(", ")})`;
}

function buildInsertSql(
  tableName: string,
  columns: string[],
  _rows: any[]
): string {
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`;
}

function flattenValues(columns: string[], rows: any[]): any[] {
  // For batch insert, we only support one row at a time through the SQL interface
  // The caller should iterate over rows
  if (rows.length === 0) return [];
  const row = rows[0];
  return columns.map((col) => row[col] ?? null);
}
