/*
This file is part of the Workstation project.

SQLite bridge via Tauri invoke — replaces the Comlink worker + LanceDB driver.
Uses rusqlite with bundled-sqlcipher on the Rust side, called through Tauri IPC.
*/

import {
  Dialect,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  DatabaseConnection,
  QueryResult,
  CompiledQuery,
  Driver
} from "@streetwriters/kysely";
import { Mutex } from "async-mutex";
import { DialectOptions } from ".";

/**
 * Wait for Tauri runtime to be injected, then return the invoke function.
 * Tauri's webview may load the page before __TAURI_INTERNALS__ is available.
 */
async function waitForTauriInvoke(): Promise<typeof import("@tauri-apps/api/core").invoke> {
  // Fast path: runtime already available
  if ((window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  }
  // Poll until Tauri injects the runtime (up to 5s)
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const interval = 50;
    const maxWait = 5000;
    const timer = setInterval(async () => {
      elapsed += interval;
      if ((window as any).__TAURI_INTERNALS__) {
        clearInterval(timer);
        const { invoke } = await import("@tauri-apps/api/core");
        resolve(invoke);
      } else if (elapsed >= maxWait) {
        clearInterval(timer);
        reject(new Error("Tauri runtime not available after 5s"));
      }
    }, interval);
  });
}

let _invoke: typeof import("@tauri-apps/api/core").invoke | null = null;

async function getTauriInvoke() {
  if (!_invoke) {
    _invoke = await waitForTauriInvoke();
  }
  return _invoke;
}

class TauriDriver implements Driver {
  connection?: DatabaseConnection;
  private connectionMutex = new Mutex();
  constructor(private readonly config: { name: string }) {}

  async init(): Promise<void> {
    const invoke = await getTauriInvoke();
    await invoke("db_open", { name: this.config.name });
    this.connection = new TauriConnection(this.config.name);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.connection) throw new Error("Driver not initialized.");
    await this.connectionMutex.waitForUnlock();
    await this.connectionMutex.acquire();
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("begin"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection(): Promise<void> {
    this.connectionMutex.release();
  }

  async destroy(): Promise<void> {
    const invoke = await getTauriInvoke();
    await invoke("db_close", { name: this.config.name });
  }

  async delete() {
    const invoke = await getTauriInvoke();
    await invoke("db_delete", { name: this.config.name });
  }
}

class TauriConnection implements DatabaseConnection {
  constructor(private readonly dbName: string) {}

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("Tauri driver doesn't support streaming");
  }

  async executeQuery<R>(
    compiledQuery: CompiledQuery<unknown>
  ): Promise<QueryResult<R>> {
    const invoke = await getTauriInvoke();
    const { parameters, sql } = compiledQuery;
    const result = await invoke<{
      rows: R[];
      numAffectedRows: number | null;
      insertId: number | null;
    }>("db_exec", {
      name: this.dbName,
      sql,
      parameters: parameters as any[]
    });

    return {
      rows: result.rows as R[],
      numAffectedRows:
        result.numAffectedRows != null
          ? BigInt(result.numAffectedRows)
          : undefined,
      insertId:
        result.insertId != null ? BigInt(result.insertId) : undefined
    } as QueryResult<R>;
  }
}

export const createDialect = (options: DialectOptions): Dialect => {
  return {
    createDriver: () =>
      new TauriDriver({
        name: options.name
      }),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler()
  };
};
