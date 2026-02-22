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
 * Lightweight SQL parser for translating Kysely-generated SQLite SQL
 * into LanceDB API operations. Not a full SQL parser — handles only
 * the specific patterns Kysely produces.
 */

export type SqlOp =
  | SelectOp
  | InsertOp
  | ReplaceOp
  | UpdateOp
  | DeleteOp
  | CreateTableOp
  | CreateIndexOp
  | DropTableOp
  | AlterTableOp
  | CreateVirtualTableOp
  | CreateTriggerOp
  | PragmaOp
  | TransactionOp
  | NoOp;

export interface SelectOp {
  type: "select";
  table: string;
  columns: string[];
  where?: string;
  orderBy?: OrderByClause[];
  limit?: number;
  offset?: number;
  joins?: JoinClause[];
  subqueries?: SubqueryRef[];
  groupBy?: string[];
  having?: string;
  cte?: string;
  distinct?: boolean;
  unionAll?: SelectOp[];
  rawSql: string;
}

export interface InsertOp {
  type: "insert";
  table: string;
  columns: string[];
  values: unknown[][];
  onConflict?: "ignore" | "replace";
}

export interface ReplaceOp {
  type: "replace";
  table: string;
  columns: string[];
  values: unknown[][];
}

export interface UpdateOp {
  type: "update";
  table: string;
  set: Record<string, unknown>;
  where?: string;
  subqueries?: SubqueryRef[];
}

export interface DeleteOp {
  type: "delete";
  table: string;
  where?: string;
  subqueries?: SubqueryRef[];
}

export interface CreateTableOp {
  type: "create_table";
  table: string;
  columns: ColumnDef[];
  withoutRowid: boolean;
  ifNotExists: boolean;
}

export interface CreateIndexOp {
  type: "create_index";
  name: string;
  table: string;
  columns: string[];
  where?: string;
  unique: boolean;
  expression?: string;
}

export interface DropTableOp {
  type: "drop_table";
  table: string;
  ifExists: boolean;
}

export interface AlterTableOp {
  type: "alter_table";
  table: string;
  addColumn?: ColumnDef;
}

export interface CreateVirtualTableOp {
  type: "create_virtual_table";
  table: string;
  module: string;
  args: string;
  raw: string;
}

export interface CreateTriggerOp {
  type: "create_trigger";
  raw: string;
}

export interface PragmaOp {
  type: "pragma";
  name: string;
  value?: string;
  raw: string;
}

export interface TransactionOp {
  type: "transaction";
  action: "begin" | "commit" | "rollback";
}

export interface NoOp {
  type: "noop";
  raw: string;
}

export interface ColumnDef {
  name: string;
  dataType: string;
  primaryKey: boolean;
  unique: boolean;
  notNull: boolean;
  collate?: string;
}

export interface OrderByClause {
  column: string;
  direction: "asc" | "desc";
}

export interface JoinClause {
  type: "inner" | "left" | "right" | "cross";
  table: string;
  on: string;
}

export interface SubqueryRef {
  placeholder: string;
  sql: string;
}

/**
 * Parse a SQL statement and bind parameters, returning a structured
 * operation descriptor for the LanceDB driver to execute.
 */
export function parseSql(sql: string, params: unknown[] = []): SqlOp {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  // Transaction control
  if (upper === "BEGIN" || upper === "BEGIN TRANSACTION")
    return { type: "transaction", action: "begin" };
  if (upper === "COMMIT" || upper === "END" || upper === "END TRANSACTION")
    return { type: "transaction", action: "commit" };
  if (upper === "ROLLBACK")
    return { type: "transaction", action: "rollback" };

  // PRAGMAs
  if (upper.startsWith("PRAGMA")) return parsePragma(trimmed);

  // DDL
  if (upper.startsWith("CREATE VIRTUAL TABLE"))
    return parseCreateVirtualTable(trimmed);
  if (upper.startsWith("CREATE TRIGGER"))
    return { type: "create_trigger", raw: trimmed };
  if (upper.startsWith("CREATE TABLE"))
    return parseCreateTable(trimmed);
  if (upper.startsWith("CREATE INDEX") || upper.startsWith("CREATE UNIQUE INDEX"))
    return parseCreateIndex(trimmed);
  if (upper.startsWith("DROP TABLE")) return parseDropTable(trimmed);
  if (upper.startsWith("ALTER TABLE")) return parseAlterTable(trimmed);

  // DML
  if (upper.startsWith("REPLACE INTO") || upper.startsWith("INSERT OR REPLACE"))
    return parseInsertOrReplace(trimmed, params, true);
  if (upper.startsWith("INSERT INTO") || upper.startsWith("INSERT OR IGNORE"))
    return parseInsertOrReplace(trimmed, params, false);
  if (upper.startsWith("SELECT") || upper.startsWith("WITH"))
    return parseSelect(trimmed, params);
  if (upper.startsWith("UPDATE")) return parseUpdate(trimmed, params);
  if (upper.startsWith("DELETE")) return parseDelete(trimmed, params);

  return { type: "noop", raw: trimmed };
}

/**
 * Bind positional `?` parameters into a SQL fragment, producing a
 * DataFusion-compatible filter string.
 */
export function bindParams(
  fragment: string,
  params: unknown[],
  startIndex: number = 0
): { bound: string; consumed: number } {
  let idx = startIndex;
  let result = "";
  let i = 0;

  while (i < fragment.length) {
    if (fragment[i] === "?") {
      if (idx >= params.length) {
        result += "?";
      } else {
        result += formatValue(params[idx]);
        idx++;
      }
      i++;
    } else if (fragment[i] === "'" && !isParamPlaceholder(fragment, i)) {
      // Skip over string literals
      const end = findClosingQuote(fragment, i);
      result += fragment.substring(i, end + 1);
      i = end + 1;
    } else {
      result += fragment[i];
      i++;
    }
  }

  return { bound: result, consumed: idx - startIndex };
}

function isParamPlaceholder(_sql: string, _pos: number): boolean {
  return false;
}

function findClosingQuote(s: string, start: number): number {
  const quote = s[start];
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === quote) {
      if (i + 1 < s.length && s[i + 1] === quote) {
        i += 2; // escaped quote
      } else {
        return i;
      }
    } else {
      i++;
    }
  }
  return s.length - 1;
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (value instanceof Uint8Array)
    return `X'${Buffer.from(value).toString("hex")}'`;
  if (Array.isArray(value)) return `'${JSON.stringify(value)}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---- Individual parsers ----

function parsePragma(sql: string): PragmaOp {
  const match = sql.match(/^PRAGMA\s+(\w+)(?:\s*=\s*(.+))?$/i);
  if (!match) return { type: "pragma", name: "unknown", raw: sql };
  return {
    type: "pragma",
    name: match[1],
    value: match[2]?.replace(/['"`;]/g, "").trim(),
    raw: sql
  };
}

function parseCreateVirtualTable(sql: string): CreateVirtualTableOp {
  const match = sql.match(
    /^CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+USING\s+(\w+)\s*\(([\s\S]+)\)$/i
  );
  if (!match)
    return { type: "create_virtual_table", table: "", module: "", args: "", raw: sql };
  return {
    type: "create_virtual_table",
    table: match[1],
    module: match[2],
    args: match[3].trim(),
    raw: sql
  };
}

function parseCreateTable(sql: string): CreateTableOp {
  const withoutRowid = /without\s+rowid/i.test(sql);
  const ifNotExists = /if\s+not\s+exists/i.test(sql);

  const nameMatch = sql.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/i
  );
  const tableName = nameMatch ? nameMatch[1] : "";

  // Extract column definitions between the outermost parentheses
  const parenStart = sql.indexOf("(");
  const parenEnd = sql.lastIndexOf(")");
  const body =
    parenStart >= 0 && parenEnd > parenStart
      ? sql.substring(parenStart + 1, parenEnd)
      : "";

  const columns = parseColumnDefs(body);

  return {
    type: "create_table",
    table: tableName,
    columns,
    withoutRowid,
    ifNotExists
  };
}

function parseColumnDefs(body: string): ColumnDef[] {
  const columns: ColumnDef[] = [];
  const parts = splitTopLevel(body, ",");

  for (const part of parts) {
    const trimmed = part.trim();
    const upper = trimmed.toUpperCase();

    // Skip table constraints (PRIMARY KEY(...), UNIQUE(...), etc.)
    if (
      upper.startsWith("PRIMARY KEY") ||
      upper.startsWith("UNIQUE") ||
      upper.startsWith("CHECK") ||
      upper.startsWith("FOREIGN KEY") ||
      upper.startsWith("CONSTRAINT")
    )
      continue;

    const tokens = trimmed.match(/^[`"]?(\w+)[`"]?\s+(\w+)(.*)$/i);
    if (!tokens) continue;

    const name = tokens[1];
    const dataType = tokens[2].toLowerCase();
    const rest = tokens[3].toUpperCase();

    columns.push({
      name,
      dataType,
      primaryKey: rest.includes("PRIMARY KEY"),
      unique: rest.includes("UNIQUE"),
      notNull: rest.includes("NOT NULL"),
      collate: rest.includes("COLLATE NOCASE") ? "nocase" : undefined
    });
  }

  return columns;
}

function parseCreateIndex(sql: string): CreateIndexOp {
  const unique = /^CREATE\s+UNIQUE/i.test(sql);
  const nameMatch = sql.match(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i
  );
  const tableMatch = sql.match(/\bON\s+[`"]?(\w+)[`"]?\s*\(/i);

  const name = nameMatch ? nameMatch[1] : "";
  const table = tableMatch ? tableMatch[1] : "";

  // Extract columns between ON table(...)
  const onParenMatch = sql.match(/\bON\s+[`"]?\w+[`"]?\s*\(([^)]+)\)/i);
  const columns = onParenMatch
    ? onParenMatch[1].split(",").map((c) => c.trim().replace(/[`"]/g, ""))
    : [];

  // Extract WHERE clause
  const whereMatch = sql.match(/\bWHERE\s+(.+)$/i);
  const where = whereMatch ? whereMatch[1].replace(/;$/, "").trim() : undefined;

  // Check for expression index
  const exprMatch = sql.match(/\bON\s+[`"]?\w+[`"]?\s*\(\s*(.+?)\s*\)\s*(?:WHERE|$)/i);
  const expression =
    exprMatch && exprMatch[1].includes(">>")
      ? exprMatch[1].trim()
      : undefined;

  return { type: "create_index", name, table, columns, where, unique, expression };
}

function parseDropTable(sql: string): DropTableOp {
  const ifExists = /if\s+exists/i.test(sql);
  const match = sql.match(
    /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i
  );
  return {
    type: "drop_table",
    table: match ? match[1] : "",
    ifExists
  };
}

function parseAlterTable(sql: string): AlterTableOp {
  const tableMatch = sql.match(/^ALTER\s+TABLE\s+[`"]?(\w+)[`"]?/i);
  const table = tableMatch ? tableMatch[1] : "";

  const addColMatch = sql.match(
    /ADD\s+COLUMN\s+[`"]?(\w+)[`"]?\s+(\w+)(.*)/i
  );
  if (addColMatch) {
    const rest = addColMatch[3].toUpperCase();
    return {
      type: "alter_table",
      table,
      addColumn: {
        name: addColMatch[1],
        dataType: addColMatch[2].toLowerCase(),
        primaryKey: false,
        unique: rest.includes("UNIQUE"),
        notNull: rest.includes("NOT NULL"),
        collate: rest.includes("COLLATE NOCASE") ? "nocase" : undefined
      }
    };
  }

  return { type: "alter_table", table };
}

function parseInsertOrReplace(
  sql: string,
  params: unknown[],
  isReplace: boolean
): InsertOp | ReplaceOp {
  const onConflictIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);

  // Extract table name
  const tableMatch = sql.match(
    /(?:INSERT\s+(?:OR\s+(?:REPLACE|IGNORE)\s+)?INTO|REPLACE\s+INTO)\s+[`"]?(\w+)[`"]?/i
  );
  const table = tableMatch ? tableMatch[1] : "";

  // Extract column names
  const colMatch = sql.match(/\([`"]?[\w`",\s]+[`"]?\)\s+(?:VALUES|SELECT)/i);
  let columns: string[] = [];
  if (colMatch) {
    const colStr = colMatch[0].replace(/\)\s+(?:VALUES|SELECT)$/i, "").replace(/^\(/, "");
    columns = colStr.split(",").map((c) => c.trim().replace(/[`"]/g, ""));
  }

  // Extract VALUES placeholders and substitute params
  const valuesMatch = sql.match(/VALUES\s*(\(.+\))$/i);
  const values: unknown[][] = [];
  if (valuesMatch) {
    const valuesStr = valuesMatch[1];
    // Split multiple value groups: (?,?),(?,?)
    const groups = splitValueGroups(valuesStr);
    let paramIdx = 0;
    for (const group of groups) {
      const placeholders = splitTopLevel(group, ",");
      const row: unknown[] = [];
      for (const ph of placeholders) {
        const trimmedPh = ph.trim();
        if (trimmedPh === "?") {
          row.push(paramIdx < params.length ? params[paramIdx++] : null);
        } else {
          // Literal value
          row.push(parseLiteralValue(trimmedPh));
        }
      }
      values.push(row);
    }
  }

  // Handle INSERT ... SELECT (for FTS population)
  if (!valuesMatch && /\bSELECT\b/i.test(sql)) {
    // This is an INSERT INTO ... SELECT pattern (e.g., FTS rebuild)
    // Return as-is — the driver will handle it specially
    if (isReplace) {
      return { type: "replace", table, columns, values: [] };
    }
    return {
      type: "insert",
      table,
      columns,
      values: [],
      onConflict: onConflictIgnore ? "ignore" : undefined
    };
  }

  if (isReplace) {
    return { type: "replace", table, columns, values };
  }

  return {
    type: "insert",
    table,
    columns,
    values,
    onConflict: onConflictIgnore ? "ignore" : undefined
  };
}

function parseSelect(sql: string, params: unknown[]): SelectOp {
  const { bound } = bindParams(sql, params);

  // Detect CTE (WITH ... AS ...)
  let cte: string | undefined;
  let mainSql = bound;
  const withMatch = bound.match(/^(WITH\s+(?:RECURSIVE\s+)?[\s\S]+?\)\s*)(?=SELECT)/i);
  if (withMatch) {
    cte = withMatch[1].trim();
    mainSql = bound.substring(withMatch[0].length);
  }

  // Detect UNION ALL — split at top-level UNION ALL boundaries
  const unionParts = splitTopLevelUnion(mainSql);
  if (unionParts.length > 1) {
    // Parse first part as the primary SELECT
    const primary = parseSingleSelect(unionParts[0].trim(), sql, cte);
    // Parse remaining parts as UNION ALL components
    primary.unionAll = unionParts.slice(1).map((part) =>
      parseSingleSelect(part.trim(), sql, undefined)
    );
    return primary;
  }

  return parseSingleSelect(mainSql, sql, cte);
}

function parseSingleSelect(mainSql: string, rawSql: string, cte?: string): SelectOp {
  // Detect DISTINCT
  const distinct = /^SELECT\s+DISTINCT\b/i.test(mainSql);

  // Extract column list
  const colMatch = mainSql.match(/^SELECT\s+(?:DISTINCT\s+)?([\s\S]+?)\s+FROM\s/i);
  const columns = colMatch
    ? splitTopLevel(colMatch[1], ",").map((c) => c.trim())
    : ["*"];

  // Extract table name (first FROM clause)
  const fromMatch = mainSql.match(/\bFROM\s+[`"]?(\w+)[`"]?/i);
  const table = fromMatch ? fromMatch[1] : "";

  // Extract JOINs
  const joins: JoinClause[] = [];
  const joinRegex =
    /\b(INNER|LEFT|RIGHT|CROSS)?\s*JOIN\s+[`"]?(\w+)[`"]?\s+ON\s+([\s\S]+?)(?=(?:INNER|LEFT|RIGHT|CROSS)?\s*JOIN|\bWHERE\b|\bORDER\b|\bLIMIT\b|\bGROUP\b|\bHAVING\b|$)/gi;
  let joinMatch;
  while ((joinMatch = joinRegex.exec(mainSql)) !== null) {
    joins.push({
      type: (joinMatch[1]?.toLowerCase() || "inner") as JoinClause["type"],
      table: joinMatch[2],
      on: joinMatch[3].trim()
    });
  }

  // Extract WHERE clause
  const whereMatch = mainSql.match(
    /\bWHERE\s+([\s\S]+?)(?=\bORDER\b|\bLIMIT\b|\bGROUP\b|\bHAVING\b|$)/i
  );
  const where = whereMatch ? whereMatch[1].trim() : undefined;

  // Extract GROUP BY
  const groupByMatch = mainSql.match(
    /\bGROUP\s+BY\s+([\s\S]+?)(?=\bHAVING\b|\bORDER\b|\bLIMIT\b|$)/i
  );
  const groupBy = groupByMatch
    ? groupByMatch[1].split(",").map((c) => c.trim())
    : undefined;

  // Extract HAVING
  const havingMatch = mainSql.match(
    /\bHAVING\s+([\s\S]+?)(?=\bORDER\b|\bLIMIT\b|$)/i
  );
  const having = havingMatch ? havingMatch[1].trim() : undefined;

  // Extract ORDER BY
  const orderByMatch = mainSql.match(
    /\bORDER\s+BY\s+([\s\S]+?)(?=\bLIMIT\b|$)/i
  );
  const orderBy: OrderByClause[] | undefined = orderByMatch
    ? orderByMatch[1].split(",").map((part) => {
        const t = part.trim();
        const desc = /\bDESC\b/i.test(t);
        const col = t.replace(/\b(ASC|DESC)\b/gi, "").trim();
        return { column: col, direction: desc ? "desc" : "asc" };
      })
    : undefined;

  // Extract LIMIT / OFFSET
  const limitMatch = mainSql.match(/\bLIMIT\s+(\d+)/i);
  const limit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;

  const offsetMatch = mainSql.match(/\bOFFSET\s+(\d+)/i);
  const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : undefined;

  // Detect subqueries in WHERE (for IN (...SELECT...))
  // Uses balanced-paren extraction instead of regex to handle nested parens
  const subqueries: SubqueryRef[] = [];
  if (where) {
    const extracted = extractSubqueries(where);
    for (const sq of extracted) {
      subqueries.push(sq);
    }
  }

  return {
    type: "select",
    table,
    columns,
    where,
    orderBy,
    limit,
    offset,
    joins: joins.length > 0 ? joins : undefined,
    subqueries: subqueries.length > 0 ? subqueries : undefined,
    groupBy,
    having,
    cte,
    distinct,
    rawSql: rawSql
  };
}

function parseUpdate(sql: string, params: unknown[]): UpdateOp {
  const { bound } = bindParams(sql, params);

  const tableMatch = bound.match(/^UPDATE\s+[`"]?(\w+)[`"]?/i);
  const table = tableMatch ? tableMatch[1] : "";

  // Extract SET clause
  const setMatch = bound.match(/\bSET\s+([\s\S]+?)(?=\bWHERE\b|$)/i);
  const set: Record<string, unknown> = {};
  if (setMatch) {
    const assignments = splitTopLevel(setMatch[1], ",");
    for (const assignment of assignments) {
      const eqIdx = assignment.indexOf("=");
      if (eqIdx < 0) continue;
      const col = assignment.substring(0, eqIdx).trim().replace(/[`"]/g, "");
      const val = assignment.substring(eqIdx + 1).trim();
      set[col] = parseBoundValue(val);
    }
  }

  // Extract WHERE clause
  const whereMatch = bound.match(/\bWHERE\s+([\s\S]+)$/i);
  const where = whereMatch ? whereMatch[1].trim() : undefined;

  // Detect subqueries in WHERE (for IN (...SELECT...))
  const subqueries: SubqueryRef[] = [];
  if (where) {
    const extracted = extractSubqueries(where);
    for (const sq of extracted) {
      subqueries.push(sq);
    }
  }

  return { type: "update", table, set, where, subqueries: subqueries.length > 0 ? subqueries : undefined };
}

function parseDelete(sql: string, params: unknown[]): DeleteOp {
  const { bound } = bindParams(sql, params);

  const tableMatch = bound.match(/^DELETE\s+FROM\s+[`"]?(\w+)[`"]?/i);
  const table = tableMatch ? tableMatch[1] : "";

  const whereMatch = bound.match(/\bWHERE\s+([\s\S]+)$/i);
  const where = whereMatch ? whereMatch[1].trim() : undefined;

  // Detect subqueries in WHERE (for IN (...SELECT...))
  const subqueries: SubqueryRef[] = [];
  if (where) {
    const extracted = extractSubqueries(where);
    for (const sq of extracted) {
      subqueries.push(sq);
    }
  }

  return { type: "delete", table, where, subqueries: subqueries.length > 0 ? subqueries : undefined };
}

// ---- Utility helpers ----

/**
 * Split a string at a delimiter, respecting parentheses and quotes.
 */
function splitTopLevel(s: string, delimiter: string): string[] {
  const results: string[] = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }

    if (
      !inSingleQuote &&
      !inDoubleQuote &&
      depth === 0 &&
      s.substring(i, i + delimiter.length) === delimiter
    ) {
      results.push(current);
      current = "";
      i += delimiter.length - 1;
    } else {
      current += ch;
    }
  }

  if (current.length > 0) results.push(current);
  return results;
}

/**
 * Split a SQL string at top-level UNION ALL boundaries,
 * respecting parentheses and quotes.
 */
function splitTopLevelUnion(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  const upper = sql.toUpperCase();

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }

    // Check for "UNION ALL" at top level
    if (
      !inSingleQuote &&
      !inDoubleQuote &&
      depth === 0 &&
      upper.startsWith("UNION ALL", i)
    ) {
      // Verify word boundary before "UNION"
      const charBefore = i > 0 ? sql[i - 1] : " ";
      if (!/\w/.test(charBefore)) {
        parts.push(current);
        current = "";
        i += "UNION ALL".length - 1; // skip "UNION ALL"
        continue;
      }
    }

    // Also check for "UNION" (without ALL) at top level
    if (
      !inSingleQuote &&
      !inDoubleQuote &&
      depth === 0 &&
      upper.startsWith("UNION", i) &&
      !upper.startsWith("UNION ALL", i)
    ) {
      const charBefore = i > 0 ? sql[i - 1] : " ";
      const charAfter = i + 5 < sql.length ? sql[i + 5] : " ";
      if (!/\w/.test(charBefore) && !/\w/.test(charAfter)) {
        parts.push(current);
        current = "";
        i += "UNION".length - 1;
        continue;
      }
    }

    current += ch;
  }

  if (current.trim().length > 0) parts.push(current);
  return parts;
}

function splitValueGroups(s: string): string[] {
  // Split "(a,b),(c,d)" into ["a,b", "c,d"]
  const groups: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of s) {
    if (ch === "(") {
      if (depth === 0) {
        current = "";
        depth++;
        continue;
      }
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        groups.push(current);
        current = "";
        continue;
      }
    }

    if (depth > 0) current += ch;
  }

  return groups;
}

function parseLiteralValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed.toUpperCase() === "NULL") return null;
  if (trimmed.toUpperCase() === "TRUE") return 1;
  if (trimmed.toUpperCase() === "FALSE") return 0;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function parseBoundValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed.toUpperCase() === "NULL") return null;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

/**
 * Extract IN (SELECT ...) subqueries from a WHERE clause using
 * balanced-parenthesis counting. Regex-based extraction fails when
 * the inner SELECT contains nested parens (e.g., WHERE conditions
 * with grouped OR/AND expressions).
 *
 * Returns an array of SubqueryRef with:
 *   - placeholder: the full "IN (SELECT ...)" fragment (for string replacement)
 *   - sql: just the inner "SELECT ..." statement
 */
function extractSubqueries(where: string): SubqueryRef[] {
  const results: SubqueryRef[] = [];
  const upperWhere = where.toUpperCase();
  let searchFrom = 0;

  while (searchFrom < where.length) {
    // Find next "IN" keyword followed by "(" and "SELECT"
    const inIdx = upperWhere.indexOf("IN", searchFrom);
    if (inIdx < 0) break;

    // Make sure "IN" is a keyword boundary (not part of another word like "JOIN")
    const charBefore = inIdx > 0 ? where[inIdx - 1] : " ";
    const charAfter = inIdx + 2 < where.length ? where[inIdx + 2] : " ";
    if (/\w/.test(charBefore) || /\w/.test(charAfter)) {
      searchFrom = inIdx + 2;
      continue;
    }

    // Skip whitespace after IN to find opening paren
    let parenStart = inIdx + 2;
    while (parenStart < where.length && /\s/.test(where[parenStart])) {
      parenStart++;
    }

    if (parenStart >= where.length || where[parenStart] !== "(") {
      searchFrom = inIdx + 2;
      continue;
    }

    // Check if what follows the paren (after whitespace) is SELECT
    let afterParen = parenStart + 1;
    while (afterParen < where.length && /\s/.test(where[afterParen])) {
      afterParen++;
    }

    if (!upperWhere.startsWith("SELECT", afterParen)) {
      searchFrom = parenStart + 1;
      continue;
    }

    // Found "IN (SELECT" — now find the matching closing paren using
    // balanced-parenthesis counting
    let depth = 1;
    let i = parenStart + 1;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    while (i < where.length && depth > 0) {
      const ch = where[i];
      if (ch === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (!inSingleQuote && !inDoubleQuote) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      if (depth > 0) i++;
    }

    if (depth !== 0) {
      // Unbalanced parens — skip this match
      searchFrom = parenStart + 1;
      continue;
    }

    // i now points to the matching closing paren
    const fullMatch = where.substring(inIdx, i + 1); // "IN (SELECT ... )"
    const innerSql = where.substring(parenStart + 1, i).trim(); // "SELECT ..."

    results.push({
      placeholder: fullMatch,
      sql: innerSql
    });

    searchFrom = i + 1;
  }

  return results;
}
