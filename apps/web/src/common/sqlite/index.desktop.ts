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
import { desktop } from "../desktop-bridge";
import Worker from "./sqlite.worker.desktop.ts?worker";
import type { DesktopDbWorker } from "./sqlite.worker.desktop";
import { wrap, Remote } from "comlink";
import { Mutex } from "async-mutex";
import { DialectOptions } from ".";

class DesktopDriver implements Driver {
  connection?: DatabaseConnection;
  private connectionMutex = new Mutex();
  worker: Remote<DesktopDbWorker> = wrap<DesktopDbWorker>(new Worker());
  constructor(private readonly config: { name: string }) {}

  async init(): Promise<void> {
    const path = await desktop!.integration.resolvePath.query({
      filePath: `userData/${this.config.name}.sql`
    });
    await this.worker.open(path);
    this.connection = new DesktopWorkerConnection(this.worker);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.connection) throw new Error("Driver not initialized.");

    // Single connection with mutex — applies to both SQLite and LanceDB.
    await this.connectionMutex.waitForUnlock();
    await this.connectionMutex.acquire();
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    // LanceDB: no-op (transactions not supported, but the driver handles it)
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
    await this.worker.close();
  }

  async delete() {
    const path = await desktop!.integration.resolvePath.query({
      filePath: `userData/${this.config.name}.sql`
    });
    await this.worker.delete(path);
  }
}

class DesktopWorkerConnection implements DatabaseConnection {
  constructor(private readonly worker: Remote<DesktopDbWorker>) {}

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("desktop driver doesn't support streaming");
  }

  async executeQuery<R>(
    compiledQuery: CompiledQuery<unknown>
  ): Promise<QueryResult<R>> {
    const { parameters, sql } = compiledQuery;
    return this.worker.run(sql, parameters as any) as unknown as QueryResult<R>;
  }
}

export const createDialect = (options: DialectOptions): Dialect => {
  return {
    createDriver: () =>
      new DesktopDriver({
        name: options.name
      }),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    // Keep SqliteQueryCompiler — LanceDB driver parses the SQLite SQL it produces
    createQueryCompiler: () => new SqliteQueryCompiler()
  };
};
