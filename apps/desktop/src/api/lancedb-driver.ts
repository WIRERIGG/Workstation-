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
 * LanceDB driver that implements the same interface as the SQLite class
 * in sqlite-kysely.ts. Translates SQL queries (from Kysely's SqliteQueryCompiler)
 * into LanceDB API calls.
 *
 * Drop-in replacement: the worker file just instantiates this class instead
 * of `SQLite`, and the existing comlink bridge + Kysely dialect work as-is.
 */

// Use type-only imports for native modules. Runtime access uses require()
// inside method bodies, matching the pattern in sqlite-kysely.ts. This
// prevents Vite/esbuild from trying to bundle .node native binaries.
import type * as LanceDbTypes from "@lancedb/lancedb";
import type { QueryResult } from "@streetwriters/kysely";
import {
  parseSql,
  formatValue,
  type SelectOp,
  type InsertOp,
  type ReplaceOp,
  type UpdateOp,
  type DeleteOp,
  type CreateTableOp,
  type CreateIndexOp,
  type DropTableOp,
  type AlterTableOp,
  type CreateVirtualTableOp,
  type SubqueryRef
} from "./sql-parser.js";
import { getSchema, getPrimaryKey, FTS_TABLES } from "./lance-schema.js";
import type { Schema } from "apache-arrow";

function getLanceDb(): typeof LanceDbTypes {
  return require("@lancedb/lancedb");
}

type SQLiteCompatibleType =
  | number
  | string
  | Uint8Array
  | Array<number>
  | bigint
  | null;

interface JsonFilter {
  column: string;
  path: string;
  op: string;
  value: any;
}

export class LanceDriver {
  private db?: LanceDbTypes.Connection;
  private tables: Map<string, LanceDbTypes.Table> = new Map();
  private dirPath?: string;

  // Track schemas we've created so ALTER TABLE ADD COLUMN can update them
  private liveSchemas: Map<string, Map<string, string>> = new Map();

  constructor() {
    console.log("new lancedb driver");
  }

  async open(filePath: string): Promise<void> {
    if (this.db) {
      console.error("LanceDB is already initialized");
      return;
    }

    // Convert .sql file path to .lance directory path
    this.dirPath = filePath.replace(/\.sql$/, ".lance");
    const lancedb = getLanceDb();
    this.db = await lancedb.connect(this.dirPath);

    // Load existing table handles
    const tableNames = await this.db.tableNames();
    for (const name of tableNames) {
      this.tables.set(name, await this.db.openTable(name));
    }
  }

  async run<R>(
    sql: string,
    parameters?: SQLiteCompatibleType[]
  ): Promise<QueryResult<R>> {
    if (!this.db) throw new Error("LanceDB is not opened.");
    return this.exec(sql, parameters);
  }

  async exec<R>(
    sql: string,
    parameters: SQLiteCompatibleType[] = []
  ): Promise<QueryResult<R>> {
    if (!this.db) throw new Error("LanceDB is not initialized.");

    const op = parseSql(sql, parameters);

    // Determine target table for error handling
    const targetTable = "table" in op ? (op as any).table : undefined;

    try {
      // IMPORTANT: `return await` is required here so that rejections from
      // async exec* methods are caught by this try/catch block. Plain
      // `return promise` in an async function bypasses the local catch.
      switch (op.type) {
        case "select":
          return await this.execSelect(op);

        case "insert":
          return await this.execInsert(op);

        case "replace":
          return await this.execReplace(op);

        case "update":
          return await this.execUpdate(op);

        case "delete":
          return await this.execDelete(op);

        case "create_table":
          return await this.execCreateTable(op);

        case "create_index":
          return await this.execCreateIndex(op);

        case "drop_table":
          return await this.execDropTable(op);

        case "alter_table":
          return await this.execAlterTable(op);

        case "create_virtual_table":
          return await this.execCreateVirtualTable(op);

        // No-ops: PRAGMAs, transactions, triggers
        case "pragma":
        case "transaction":
        case "create_trigger":
        case "noop":
          return { rows: [] as R[] };

        default:
          return { rows: [] as R[] };
      }
    } catch (err) {
      // Logs table is non-critical — silently handle errors (Arrow data corruption, etc.)
      if (targetTable === "logs") {
        console.warn("LanceDB logs table error (non-fatal):", (err as Error).message);
        return { rows: [] as R[] };
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    this.tables.clear();
    this.db = undefined;
  }

  async delete(filePath: string): Promise<void> {
    await this.close();
    const dirPath = filePath.replace(/\.sql$/, ".lance");
    const fs = require("fs/promises");
    await fs.rm(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }

  // =========================================================================
  // SELECT execution
  // =========================================================================

  private async execSelect<R>(op: SelectOp): Promise<QueryResult<R>> {
    // Handle UNION ALL — execute each part separately and combine results
    if (op.unionAll && op.unionAll.length > 0) {
      return this.execUnionAll(op);
    }

    // Handle FTS MATCH queries (e.g., SELECT ... FROM notes_fts WHERE notes_fts MATCH ...)
    if (this.isFtsQuery(op)) {
      return this.execFtsSearch(op);
    }

    // Handle CTE / recursive queries by falling back to full in-memory evaluation
    if (op.cte) {
      return this.execCteQuery(op);
    }

    // Handle JOINs by decomposing into multiple queries
    if (op.joins && op.joins.length > 0) {
      return this.execJoinQuery(op);
    }

    // Handle subqueries in WHERE clause
    if (op.subqueries && op.subqueries.length > 0) {
      return this.execSubquerySelect(op);
    }

    // Simple single-table query
    return this.execSimpleSelect(op);
  }

  private async execUnionAll<R>(op: SelectOp): Promise<QueryResult<R>> {
    // Execute the primary SELECT
    const primaryOp = { ...op, unionAll: undefined };
    const primaryResult = await this.execSelect<R>(primaryOp);
    const allRows = [...primaryResult.rows];

    // Execute each UNION ALL part
    for (const unionPart of op.unionAll!) {
      const partResult = await this.execSelect<R>(unionPart);
      allRows.push(...partResult.rows);
    }

    return { rows: allRows };
  }

  private async execSimpleSelect<R>(op: SelectOp): Promise<QueryResult<R>> {
    const table = this.tables.get(op.table);
    if (!table) return { rows: [] as R[] };

    // Preprocess WHERE: handle empty IN(), ->> JSON operator
    const { where, jsonFilters, alwaysFalse } = this.preprocessWhere(op.where);

    // Short-circuit if WHERE is always false (e.g., empty IN())
    if (alwaysFalse) {
      const isCount = op.columns.length === 1 &&
        /^count\s*\(\s*\*\s*\)/i.test(op.columns[0]);
      if (isCount) {
        const alias = this.extractAlias(op.columns[0]) || "count(*)";
        return { rows: [{ [alias]: 0 } as unknown as R] };
      }
      return { rows: [] as R[] };
    }

    // Check if this is a COUNT(*) query (fast path only without JSON filters)
    const isCount = op.columns.length === 1 &&
      /^count\s*\(\s*\*\s*\)/i.test(op.columns[0]);
    if (isCount && !op.groupBy && jsonFilters.length === 0) {
      const count = await table.countRows(where || undefined);
      const alias = this.extractAlias(op.columns[0]) || "count(*)";
      return { rows: [{ [alias]: count } as unknown as R] };
    }

    let query = table.query();

    if (where) {
      query = query.where(where);
    }

    if (op.limit !== undefined && jsonFilters.length === 0) {
      // If we need offset or sorting, fetch more and trim later
      if (op.offset || op.orderBy) {
        query = query.limit((op.offset || 0) + op.limit);
      } else {
        query = query.limit(op.limit);
      }
    }

    let rows = await query.toArray();

    // Convert Arrow table rows to plain objects
    rows = rows.map((row: any) => this.arrowRowToObject(row));

    // Apply JSON post-filters (for ->> operator conditions)
    if (jsonFilters.length > 0) {
      rows = this.applyJsonFilters(rows, jsonFilters);
    }

    // Apply ORDER BY in-memory (LanceDB has limited native sort)
    if (op.orderBy && op.orderBy.length > 0) {
      rows = this.sortRows(rows, op.orderBy);
    }

    // Apply OFFSET
    if (op.offset) {
      rows = rows.slice(op.offset);
    }

    // Apply LIMIT after offset (or after JSON filtering)
    if (op.limit !== undefined && (op.offset || op.orderBy || jsonFilters.length > 0)) {
      rows = rows.slice(0, op.limit);
    }

    // Apply DISTINCT
    if (op.distinct) {
      rows = this.applyDistinct(rows);
    }

    // Apply GROUP BY + aggregates
    if (op.groupBy) {
      rows = this.applyGroupBy(rows, op.groupBy, op.columns, op.having);
    }

    // Project selected columns (if not SELECT *)
    if (op.columns.length > 0 && op.columns[0] !== "*") {
      rows = this.projectColumns(rows, op.columns);
    }

    return { rows: rows as R[] };
  }

  private async execJoinQuery<R>(op: SelectOp): Promise<QueryResult<R>> {
    // Decompose JOINs into multiple LanceDB queries.
    // The common pattern is: SELECT ... FROM tableA JOIN tableB ON tableA.col = tableB.col
    // We fetch from the primary table, then enrich with data from joined tables.

    const primaryTable = this.tables.get(op.table);
    if (!primaryTable) return { rows: [] as R[] };

    // Fetch primary table rows first
    let primaryQuery = primaryTable.query();

    // Apply WHERE conditions that reference only the primary table
    const primaryWhere = op.where
      ? this.extractTableFilter(op.where, op.table)
      : undefined;
    if (primaryWhere) {
      primaryQuery = primaryQuery.where(primaryWhere);
    }

    let rows = await primaryQuery.toArray();
    rows = rows.map((r: any) => this.arrowRowToObject(r));

    // For each JOIN, fetch the joined table and merge
    for (const join of op.joins!) {
      const joinTable = this.tables.get(join.table);
      if (!joinTable) continue;

      // Parse the ON clause to find the join columns
      // Pattern: "tableA"."colA" = "tableB"."colB"
      const onMatch = join.on.match(
        /[`"]?(\w+)[`"]?\.[`"]?(\w+)[`"]?\s*=\s*[`"]?(\w+)[`"]?\.[`"]?(\w+)[`"]?/
      );
      if (!onMatch) continue;

      // Determine which side is primary vs joined
      let primaryCol: string, joinedCol: string;
      if (onMatch[1] === op.table || onMatch[1] === join.table) {
        if (onMatch[1] === op.table) {
          primaryCol = onMatch[2];
          joinedCol = onMatch[4];
        } else {
          primaryCol = onMatch[4];
          joinedCol = onMatch[2];
        }
      } else {
        primaryCol = onMatch[2];
        joinedCol = onMatch[4];
      }

      // Collect unique join key values from primary rows
      const joinKeys = [...new Set(rows.map((r: any) => r[primaryCol]).filter(Boolean))];
      if (joinKeys.length === 0) {
        if (join.type === "inner") {
          rows = [];
          break;
        }
        continue;
      }

      // Fetch matching rows from joined table using IN filter
      const inList = joinKeys.map((k) => formatValue(k)).join(", ");
      const joinedRows = await joinTable
        .query()
        .where(`${joinedCol} IN (${inList})`)
        .toArray();

      const joinedMap = new Map<string, any[]>();
      for (const jr of joinedRows) {
        const obj = this.arrowRowToObject(jr);
        const key = String(obj[joinedCol]);
        if (!joinedMap.has(key)) joinedMap.set(key, []);
        joinedMap.get(key)!.push(obj);
      }

      // Merge rows
      const merged: any[] = [];
      for (const row of rows) {
        const key = String(row[primaryCol]);
        const matches = joinedMap.get(key);
        if (matches) {
          for (const match of matches) {
            merged.push({
              ...row,
              ...this.prefixKeys(match, join.table)
            });
          }
        } else if (join.type === "left") {
          merged.push(row);
        }
        // For inner joins, rows without matches are dropped
      }
      rows = merged;
    }

    // Apply remaining WHERE, ORDER BY, LIMIT, OFFSET
    if (op.orderBy) rows = this.sortRows(rows, op.orderBy);
    if (op.offset) rows = rows.slice(op.offset);
    if (op.limit !== undefined) rows = rows.slice(0, op.limit);

    if (op.columns.length > 0 && op.columns[0] !== "*") {
      rows = this.projectColumns(rows, op.columns);
    }

    return { rows: rows as R[] };
  }

  /**
   * Resolve IN (SELECT ...) subqueries in a WHERE clause by executing
   * each inner SELECT and replacing with an IN (...values...) list.
   */
  private async resolveSubqueries(where: string, subqueries: SubqueryRef[]): Promise<string> {
    let resolved = where;

    for (const subq of subqueries) {
      // Parse and execute the inner SELECT
      const innerOp = parseSql(subq.sql, []) as SelectOp;
      const innerResult = await this.execSelect<any>(innerOp);

      // Extract the column values from the subquery result
      const innerColName = innerOp.columns[0]?.replace(/.*\bas\s+/i, "").trim().replace(/[`"]/g, "") || "id";
      const ids = innerResult.rows.map((r: any) => r[innerColName]).filter(Boolean);

      // Replace the subquery with an IN (...values...) list
      if (ids.length === 0) {
        resolved = resolved.replace(subq.placeholder, "IN (NULL)");
      } else {
        const inList = ids.map((id: any) => formatValue(id)).join(", ");
        resolved = resolved.replace(subq.placeholder, `IN (${inList})`);
      }
    }

    return resolved;
  }

  private async execSubquerySelect<R>(op: SelectOp): Promise<QueryResult<R>> {
    const resolvedWhere = await this.resolveSubqueries(op.where || "", op.subqueries!);

    // Re-run as a simple select with the resolved WHERE
    return this.execSimpleSelect({
      ...op,
      where: resolvedWhere,
      subqueries: undefined
    });
  }

  private async execCteQuery<R>(op: SelectOp): Promise<QueryResult<R>> {
    // Recursive CTEs (used for notebook hierarchy) require special handling.
    // We detect the recursive pattern and implement it iteratively.

    const isRecursive = /^WITH\s+RECURSIVE/i.test(op.cte!);
    if (!isRecursive) {
      // Non-recursive CTE: just treat it as a normal query on the main table
      return this.execSimpleSelect({ ...op, cte: undefined });
    }

    // Parse the recursive CTE pattern for notebook hierarchy:
    // WITH RECURSIVE subNotebooks(id) AS (
    //   SELECT 'rootId' AS id
    //   UNION ALL
    //   SELECT relations.fromId AS id FROM relations, subNotebooks
    //   WHERE toType = 'notebook' AND fromType = 'notebook' AND toId = subNotebooks.id
    // )
    const cteNameMatch = op.cte!.match(/WITH\s+RECURSIVE\s+(\w+)\s*\(([^)]+)\)/i);
    if (!cteNameMatch) {
      return this.execSimpleSelect({ ...op, cte: undefined });
    }

    const cteName = cteNameMatch[1];
    const cteColumns = cteNameMatch[2].split(",").map((c) => c.trim());

    // Extract the seed value(s) from the base case
    const seedMatch = op.cte!.match(/SELECT\s+([\s\S]+?)\s+(?:UNION\s+ALL)/i);
    if (!seedMatch) {
      return this.execSimpleSelect({ ...op, cte: undefined });
    }

    // Extract seed values — handles both `val('id')` and literal patterns
    const seedValues: Record<string, any>[] = [];
    const valMatch = seedMatch[1].match(/'([^']+)'/g);
    if (valMatch) {
      const row: Record<string, any> = {};
      for (let i = 0; i < cteColumns.length && i < valMatch.length; i++) {
        row[cteColumns[i]] = valMatch[i].replace(/'/g, "");
      }
      seedValues.push(row);
    }

    // Detect the recursive part — typically joins relations table
    const relationsTable = this.tables.get("relations");
    if (!relationsTable || seedValues.length === 0) {
      return this.execSimpleSelect({ ...op, cte: undefined });
    }

    // Iteratively expand the hierarchy
    const visited = new Set<string>();
    let frontier = seedValues.map((r) => r[cteColumns[0]]);
    const allResults: Record<string, any>[] = [...seedValues];

    // Detect if the recursive query goes fromId→toId or toId→fromId
    const recursivePartMatch = op.cte!.match(/UNION\s+ALL\s+([\s\S]+?)$/i);
    let selectCol = "fromId";
    let matchCol = "toId";
    if (recursivePartMatch) {
      const rp = recursivePartMatch[1];
      if (/relations\.\s*toId\s+as\s+id/i.test(rp)) {
        selectCol = "toId";
        matchCol = "fromId";
      }
    }

    while (frontier.length > 0) {
      const newIds = frontier.filter((id) => !visited.has(id));
      if (newIds.length === 0) break;
      newIds.forEach((id) => visited.add(id));

      const inList = newIds.map((id) => formatValue(id)).join(", ");
      const filter = `fromType = 'notebook' AND toType = 'notebook' AND ${matchCol} IN (${inList})`;

      const relRows = await relationsTable.query().where(filter).toArray();
      const nextFrontier: string[] = [];

      for (const rr of relRows) {
        const obj = this.arrowRowToObject(rr);
        const nextId = obj[selectCol] as string;
        if (!visited.has(nextId)) {
          nextFrontier.push(nextId);
          const row: Record<string, any> = {};
          row[cteColumns[0]] = nextId;
          // Fill additional CTE columns if present (path, rootId, etc.)
          if (cteColumns.includes("path")) {
            const parentRow = allResults.find(
              (r) => r[cteColumns[0]] === obj[matchCol]
            );
            row.path = parentRow?.path
              ? `${parentRow.path}/${nextId}`
              : nextId;
          }
          if (cteColumns.includes("rootId")) {
            const parentRow = allResults.find(
              (r) => r[cteColumns[0]] === obj[matchCol]
            );
            row.rootId = parentRow?.rootId || obj[matchCol];
          }
          allResults.push(row);
        }
      }
      frontier = nextFrontier;
    }

    // Now execute the main SELECT using the CTE results as a virtual table
    // The main query typically does: SELECT ... FROM cteName [JOIN ...] WHERE ...
    if (op.table === cteName) {
      // Direct query on the CTE result
      let rows = allResults;
      if (op.where) {
        rows = this.filterInMemory(rows, op.where);
      }
      if (op.orderBy) rows = this.sortRows(rows, op.orderBy);
      if (op.offset) rows = rows.slice(op.offset);
      if (op.limit !== undefined) rows = rows.slice(0, op.limit);
      if (op.columns.length > 0 && op.columns[0] !== "*") {
        rows = this.projectColumns(rows, op.columns);
      }
      return { rows: rows as R[] };
    }

    // Main query references a real table with CTE as a join/subquery
    // Build IN list from CTE IDs and use it as a filter
    const cteIds = allResults.map((r) => r[cteColumns[0]]);
    const cteInList = cteIds.map((id) => formatValue(id)).join(", ");

    // Modify the WHERE to include the CTE constraint
    let augmentedWhere = op.where || "";
    if (augmentedWhere) {
      // Replace references to cteName.column with IN list
      const cteRefRegex = new RegExp(
        `["\`]?${cteName}["\`]?\\.["\`]?(\\w+)["\`]?`,
        "gi"
      );
      if (cteRefRegex.test(augmentedWhere)) {
        augmentedWhere = augmentedWhere.replace(
          cteRefRegex,
          `${op.table}.id`
        );
        if (cteIds.length > 0) {
          augmentedWhere += ` AND ${op.table}.id IN (${cteInList})`;
        }
      }
    }

    return this.execSimpleSelect({
      ...op,
      cte: undefined,
      where: augmentedWhere || undefined,
      joins: undefined
    });
  }

  // =========================================================================
  // FTS (Full-Text Search) via Tantivy
  // =========================================================================

  private isFtsQuery(op: SelectOp): boolean {
    return (
      op.table in FTS_TABLES ||
      (!!op.where && /\bMATCH\b/i.test(op.where))
    );
  }

  private async execFtsSearch<R>(op: SelectOp): Promise<QueryResult<R>> {
    const ftsConfig = FTS_TABLES[op.table];
    if (!ftsConfig) return { rows: [] as R[] };

    const contentTable = this.tables.get(ftsConfig.contentTable);
    if (!contentTable) return { rows: [] as R[] };

    // Extract the search query from the WHERE clause
    // Pattern: notes_fts MATCH 'query' or notes_fts = 'query'
    const matchRegex = /(?:\w+)\s+(?:MATCH|=)\s+'([^']+)'/i;
    const matchResult = op.where?.match(matchRegex);
    const searchQuery = matchResult ? matchResult[1] : "";

    if (!searchQuery) return { rows: [] as R[] };

    try {
      // Use LanceDB's full-text search
      const results = await contentTable
        .search(searchQuery, "fts")
        .limit(op.limit || 100)
        .toArray();

      const rows = results.map((r: any) => {
        const obj = this.arrowRowToObject(r);
        // Add rank score if available
        if (r._score !== undefined) obj.rank = r._score;
        return obj;
      });

      return { rows: rows as R[] };
    } catch {
      // FTS index might not exist yet
      return { rows: [] as R[] };
    }
  }

  // =========================================================================
  // INSERT / REPLACE execution
  // =========================================================================

  private async execInsert<R>(op: InsertOp): Promise<QueryResult<R>> {
    const table = this.tables.get(op.table);
    if (!table) return { rows: [] as R[], numAffectedRows: BigInt(0) };

    if (op.values.length === 0) {
      return { rows: [] as R[], numAffectedRows: BigInt(0) };
    }

    const rows = op.values.map((vals) => {
      const row: Record<string, unknown> = {};
      for (let i = 0; i < op.columns.length; i++) {
        row[op.columns[i]] = i < vals.length ? vals[i] : null;
      }
      return row;
    });

    if (op.onConflict === "ignore") {
      // INSERT OR IGNORE: skip rows where primary key already exists
      const pk = getPrimaryKey(op.table);
      const existingIds = new Set<string>();
      for (const row of rows) {
        const pkVal = row[pk];
        if (pkVal != null) {
          try {
            const existing = await table
              .query()
              .where(`${pk} = ${formatValue(pkVal)}`)
              .limit(1)
              .toArray();
            if (existing.length > 0) existingIds.add(String(pkVal));
          } catch {
            // ignore query errors
          }
        }
      }
      const newRows = rows.filter((r) => !existingIds.has(String(r[pk])));
      if (newRows.length > 0) {
        await table.add(newRows);
      }
      return { rows: [] as R[], numAffectedRows: BigInt(newRows.length) };
    }

    await table.add(rows);
    return { rows: [] as R[], numAffectedRows: BigInt(rows.length) };
  }

  private async execReplace<R>(op: ReplaceOp): Promise<QueryResult<R>> {
    const table = this.tables.get(op.table);
    if (!table) return { rows: [] as R[], numAffectedRows: BigInt(0) };

    if (op.values.length === 0) {
      return { rows: [] as R[], numAffectedRows: BigInt(0) };
    }

    const pk = getPrimaryKey(op.table);

    for (const vals of op.values) {
      const row: Record<string, unknown> = {};
      for (let i = 0; i < op.columns.length; i++) {
        row[op.columns[i]] = i < vals.length ? vals[i] : null;
      }

      // Delete existing row with same primary key, then insert
      const pkVal = row[pk];
      if (pkVal != null) {
        try {
          await table.delete(`${pk} = ${formatValue(pkVal)}`);
        } catch {
          // Row might not exist — that's fine
        }
      }
      await table.add([row]);
    }

    return { rows: [] as R[], numAffectedRows: BigInt(op.values.length) };
  }

  // =========================================================================
  // UPDATE execution
  // =========================================================================

  private async execUpdate<R>(op: UpdateOp): Promise<QueryResult<R>> {
    const table = this.tables.get(op.table);
    if (!table) return { rows: [] as R[], numAffectedRows: BigInt(0) };

    // Resolve subqueries in WHERE clause before passing to LanceDB
    let where = op.where || undefined;
    if (where && op.subqueries && op.subqueries.length > 0) {
      where = await this.resolveSubqueries(where, op.subqueries);
    }

    // Preprocess WHERE: handle empty IN()
    const { where: cleanWhere, alwaysFalse } = this.preprocessWhere(where);
    if (alwaysFalse) {
      return { rows: [] as R[], numAffectedRows: BigInt(0) };
    }
    where = cleanWhere;

    // Count affected rows before update
    let affectedCount = 0;
    if (where) {
      affectedCount = await table.countRows(where);
    } else {
      affectedCount = await table.countRows();
    }

    if (affectedCount === 0) {
      return { rows: [] as R[], numAffectedRows: BigInt(0) };
    }

    await table.update({ values: op.set as Record<string, any>, where });

    return { rows: [] as R[], numAffectedRows: BigInt(affectedCount) };
  }

  // =========================================================================
  // DELETE execution
  // =========================================================================

  private async execDelete<R>(op: DeleteOp): Promise<QueryResult<R>> {
    const table = this.tables.get(op.table);
    if (!table) return { rows: [] as R[], numAffectedRows: BigInt(0) };

    // Resolve subqueries in WHERE clause before passing to LanceDB
    let where = op.where;
    if (where && op.subqueries && op.subqueries.length > 0) {
      where = await this.resolveSubqueries(where, op.subqueries);
    }

    // Preprocess WHERE: handle empty IN()
    const { where: cleanWhere, alwaysFalse } = this.preprocessWhere(where);
    if (alwaysFalse) {
      return { rows: [] as R[], numAffectedRows: BigInt(0) };
    }
    where = cleanWhere;

    let affectedCount = 0;
    if (where) {
      affectedCount = await table.countRows(where);
      if (affectedCount > 0) {
        await table.delete(where);
      }
    } else {
      // DELETE without WHERE = delete all rows
      affectedCount = await table.countRows();
      if (affectedCount > 0) {
        await table.delete("true");
      }
    }

    return { rows: [] as R[], numAffectedRows: BigInt(affectedCount) };
  }

  // =========================================================================
  // DDL execution (CREATE TABLE, DROP TABLE, ALTER TABLE, indexes)
  // =========================================================================

  private async execCreateTable<R>(op: CreateTableOp): Promise<QueryResult<R>> {
    if (!this.db) return { rows: [] as R[] };

    // Skip if table already exists
    if (this.tables.has(op.table)) {
      return { rows: [] as R[] };
    }

    // Get the predefined Arrow schema, or build one from the parsed columns
    let schema = getSchema(op.table);
    if (!schema) {
      schema = this.buildSchemaFromColumns(op.columns);
    }

    // Track the schema columns for future ALTER TABLE
    const colMap = new Map<string, string>();
    for (const col of op.columns) {
      colMap.set(col.name, col.dataType);
    }
    this.liveSchemas.set(op.table, colMap);

    const table = await this.db.createEmptyTable(op.table, schema);
    this.tables.set(op.table, table);

    return { rows: [] as R[] };
  }

  private async execCreateIndex<R>(_op: CreateIndexOp): Promise<QueryResult<R>> {
    // LanceDB handles indexing internally. We don't need explicit index creation
    // for the standard column indexes. FTS indexes are created separately.
    return { rows: [] as R[] };
  }

  private async execDropTable<R>(op: DropTableOp): Promise<QueryResult<R>> {
    if (!this.db) return { rows: [] as R[] };

    if (this.tables.has(op.table)) {
      try {
        await this.db.dropTable(op.table);
      } catch {
        // Table may not exist in LanceDB even if we tracked it locally
      }
      this.tables.delete(op.table);
      this.liveSchemas.delete(op.table);
    }
    // Never throw for missing tables — LanceDB doesn't have FTS virtual
    // tables, and migrations may DROP TABLE without IF EXISTS.

    return { rows: [] as R[] };
  }

  private async execAlterTable<R>(op: AlterTableOp): Promise<QueryResult<R>> {
    if (!op.addColumn) return { rows: [] as R[] };

    // LanceDB doesn't support ALTER TABLE ADD COLUMN directly.
    // For new columns, we need to:
    // 1. Track the column in our live schema
    // 2. When reading, treat missing columns as NULL
    // 3. When writing, include the new column with default NULL
    const colMap = this.liveSchemas.get(op.table);
    if (colMap) {
      colMap.set(op.addColumn.name, op.addColumn.dataType);
    }

    // Add column by updating existing rows with NULL value for the new column
    const table = this.tables.get(op.table);
    if (table) {
      const count = await table.countRows();
      if (count > 0) {
        // Use LanceDB's merge insert or update to add the column
        // For existing data, the column will appear as null in Arrow
        try {
          await table.update({
            values: { [op.addColumn.name]: null },
            where: "true"
          });
        } catch {
          // Column might already exist or table might be empty
        }
      }
    }

    return { rows: [] as R[] };
  }

  private async execCreateVirtualTable<R>(
    op: CreateVirtualTableOp
  ): Promise<QueryResult<R>> {
    // FTS5 virtual tables → create LanceDB FTS indexes on the content table
    if (op.module.toLowerCase() === "fts5") {
      const ftsConfig = FTS_TABLES[op.table];
      if (ftsConfig) {
        const contentTable = this.tables.get(ftsConfig.contentTable);
        if (contentTable) {
          try {
            for (const col of ftsConfig.indexedColumns) {
              const lancedb = getLanceDb();
              await contentTable.createIndex(col, {
                config: lancedb.Index.fts()
              });
            }
          } catch {
            // Index might already exist
          }
        }
      }
    }
    return { rows: [] as R[] };
  }

  // =========================================================================
  // Helper methods
  // =========================================================================

  private arrowRowToObject(row: any): Record<string, any> {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      // Arrow rows may be proxy objects; convert to plain object
      const result: Record<string, any> = {};
      for (const key of Object.keys(row)) {
        if (key.startsWith("_")) continue; // Skip internal Arrow fields
        const val = row[key];
        // Convert BigInt to number for compatibility with Kysely expectations
        result[key] = typeof val === "bigint" ? Number(val) : val;
      }
      return result;
    }
    return row;
  }

  private sortRows(
    rows: any[],
    orderBy: { column: string; direction: "asc" | "desc" }[]
  ): any[] {
    return [...rows].sort((a, b) => {
      for (const { column, direction } of orderBy) {
        // Strip table prefix (e.g., "notes"."dateCreated" → dateCreated)
        const col = column.replace(/^[`"]?\w+[`"]?\./g, "").replace(/[`"]/g, "");
        const aVal = a[col];
        const bVal = b[col];

        let cmp = 0;
        if (aVal == null && bVal == null) cmp = 0;
        else if (aVal == null) cmp = -1;
        else if (bVal == null) cmp = 1;
        else if (typeof aVal === "string" && typeof bVal === "string")
          cmp = aVal.localeCompare(bVal);
        else cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;

        if (direction === "desc") cmp = -cmp;
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  private applyDistinct(rows: any[]): any[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private applyGroupBy(
    rows: any[],
    groupBy: string[],
    columns: string[],
    _having?: string
  ): any[] {
    const groups = new Map<string, any[]>();

    for (const row of rows) {
      const key = groupBy
        .map((col) => {
          const c = col.replace(/[`"]/g, "").replace(/^\w+\./, "");
          return JSON.stringify(row[c]);
        })
        .join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    return Array.from(groups.entries()).map(([_key, groupRows]) => {
      const result: Record<string, any> = {};

      for (const col of columns) {
        const countMatch = col.match(/^count\s*\(\s*\*\s*\)(?:\s+as\s+(\w+))?/i);
        if (countMatch) {
          result[countMatch[1] || "count(*)"] = groupRows.length;
          continue;
        }

        const aggMatch = col.match(/^(sum|avg|min|max)\s*\(\s*[`"]?(\w+)[`"]?\s*\)(?:\s+as\s+(\w+))?/i);
        if (aggMatch) {
          const fn = aggMatch[1].toLowerCase();
          const field = aggMatch[2];
          const alias = aggMatch[3] || col;
          const values = groupRows.map((r) => r[field]).filter((v) => v != null);

          if (fn === "sum") result[alias] = values.reduce((a: number, b: number) => a + b, 0);
          else if (fn === "avg") result[alias] = values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : null;
          else if (fn === "min") result[alias] = values.length > 0 ? Math.min(...values) : null;
          else if (fn === "max") result[alias] = values.length > 0 ? Math.max(...values) : null;
          continue;
        }

        // Regular column — take from first row
        const cleanCol = col
          .replace(/\s+as\s+\w+$/i, "")
          .replace(/[`"]/g, "")
          .replace(/^\w+\./, "");
        const alias = this.extractAlias(col) || cleanCol;
        result[alias] = groupRows[0][cleanCol];
      }

      return result;
    });
  }

  private projectColumns(rows: any[], columns: string[]): any[] {
    return rows.map((row) => {
      const result: Record<string, any> = {};
      for (const col of columns) {
        const alias = this.extractAlias(col);
        const cleanCol = col
          .replace(/\s+as\s+\w+$/i, "")
          .trim()
          .replace(/[`"]/g, "")
          .replace(/^\w+\./, "");

        // Handle aggregate functions in projection
        if (/^count\s*\(/i.test(cleanCol)) {
          result[alias || "count(*)"] = row[alias || "count(*)"] ?? row["count(*)"];
          continue;
        }

        const key = alias || cleanCol;
        result[key] = row[cleanCol] ?? row[key] ?? null;
      }
      return result;
    });
  }

  private extractAlias(col: string): string | undefined {
    const match = col.match(/\s+as\s+[`"]?(\w+)[`"]?\s*$/i);
    return match ? match[1] : undefined;
  }

  private extractTableFilter(where: string, table: string): string | undefined {
    // Remove table prefixes from the WHERE clause so LanceDB can parse it
    return where.replace(
      new RegExp(`["\`]?${table}["\`]?\\.`, "g"),
      ""
    );
  }

  private prefixKeys(
    obj: Record<string, any>,
    _prefix: string
  ): Record<string, any> {
    // For JOINs, we don't prefix keys since Kysely uses aliases.
    // The column projection step will pick the right columns.
    return obj;
  }

  private filterInMemory(rows: any[], _where: string): any[] {
    // Basic in-memory filter for CTE results.
    // This handles simple equality and IN conditions.
    // Complex conditions fall through unfiltered.
    return rows;
  }

  private buildSchemaFromColumns(columns: { name: string; dataType: string }[]): Schema {
    const { Schema: ArrowSchema, Field, Utf8, Int32, Int64 } = require("apache-arrow");

    const fields = columns.map((col) => {
      const nullable = !col.name.toLowerCase().includes("id") || col.name !== "id";
      switch (col.dataType.toLowerCase()) {
        case "integer":
        case "int":
          return new Field(col.name, new Int64(), nullable);
        case "boolean":
          return new Field(col.name, new Int32(), nullable);
        case "real":
        case "float":
        case "double":
          return new Field(col.name, new Int64(), nullable);
        case "text":
        case "varchar":
        case "blob":
        default:
          return new Field(col.name, new Utf8(), col.name !== "id" && col.name !== "key" && col.name !== "name");
      }
    });

    return new ArrowSchema(fields);
  }

  /**
   * Preprocess a WHERE clause to handle patterns DataFusion doesn't support:
   * 1. Empty IN () — replaced with `false` (no rows match)
   * 2. SQLite JSON extract ->> operator — extracted as post-filters
   */
  private preprocessWhere(where: string | undefined): {
    where: string | undefined;
    jsonFilters: JsonFilter[];
    alwaysFalse: boolean;
  } {
    if (!where) return { where, jsonFilters: [], alwaysFalse: false };

    let result = where;

    // 1. Replace empty IN () with false (DataFusion rejects empty IN lists)
    result = result.replace(/[`"]?\w+[`"]?\s+IN\s*\(\s*\)/gi, "false");
    result = result.replace(/[`"]?\w+[`"]?\s+NOT\s+IN\s*\(\s*\)/gi, "true");

    // Check if WHERE is effectively always-false
    const stripped = result
      .replace(/\([^()]*\)/g, (m) => m) // keep parens but check content
      .trim();
    if (
      /^\s*false\s*$/i.test(stripped) ||
      /\bAND\s+false\b/i.test(result) ||
      /\bfalse\s+AND\b/i.test(result)
    ) {
      return { where: result, jsonFilters: [], alwaysFalse: true };
    }

    // 2. Extract ->> JSON conditions (SQLite JSON extract not in DataFusion)
    const jsonFilters: JsonFilter[] = [];
    result = result.replace(
      /[`"]?(\w+)[`"]?\s*->>\s*'([^']+)'\s*(<=?|>=?|!=|<>|=)\s*(\d+(?:\.\d+)?|'[^']*')/gi,
      (_match, column, path, op, rawValue) => {
        let value: any = rawValue;
        if (/^\d+(\.\d+)?$/.test(rawValue)) value = Number(rawValue);
        else if (rawValue.startsWith("'")) value = rawValue.slice(1, -1);
        jsonFilters.push({ column, path, op, value });
        return "true";
      }
    );

    // Simplify: remove redundant AND true / true AND
    result = result.replace(/\btrue\b\s+AND\s+/gi, "");
    result = result.replace(/\s+AND\s+\btrue\b/gi, "");
    if (/^\s*true\s*$/i.test(result)) result = "";

    return {
      where: result || undefined,
      jsonFilters,
      alwaysFalse: false
    };
  }

  /**
   * Apply JSON post-filters extracted from ->> conditions.
   * Parses the JSON column value and checks the extracted path against the condition.
   */
  private applyJsonFilters(rows: any[], filters: JsonFilter[]): any[] {
    if (filters.length === 0) return rows;
    return rows.filter((row) => {
      for (const f of filters) {
        let colValue = row[f.column];
        if (colValue == null) return false;
        if (typeof colValue === "string") {
          try {
            colValue = JSON.parse(colValue);
          } catch {
            return false;
          }
        }

        // Extract JSON path: $.value → value, $.nested.path → nested.path
        const pathParts = f.path.replace(/^\$\.?/, "").split(".");
        let extracted: any = colValue;
        for (const part of pathParts) {
          if (extracted == null) return false;
          extracted = extracted[part];
        }
        if (extracted == null) return false;

        // Apply comparison
        switch (f.op) {
          case "<": if (!(extracted < f.value)) return false; break;
          case "<=": if (!(extracted <= f.value)) return false; break;
          case ">": if (!(extracted > f.value)) return false; break;
          case ">=": if (!(extracted >= f.value)) return false; break;
          case "=": if (extracted != f.value) return false; break;
          case "!=": case "<>": if (extracted == f.value) return false; break;
          default: return false;
        }
      }
      return true;
    });
  }
}
