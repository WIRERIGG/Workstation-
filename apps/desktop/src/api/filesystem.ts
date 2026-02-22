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

import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import os from "node:os";
import {
  readdir,
  readFile,
  writeFile,
  stat,
  access,
  mkdir,
  rm
} from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";

const t = initTRPC.create();

export const filesystemRouter = t.router({
  homeDir: t.procedure.query(() => {
    return os.homedir();
  }),

  listDir: t.procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      const entries = await readdir(input.path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        path: path.join(input.path, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymlink: entry.isSymbolicLink()
      }));
    }),

  readFile: t.procedure
    .input(
      z.object({
        path: z.string(),
        encoding: z.string().default("utf-8")
      })
    )
    .query(async ({ input }) => {
      return await readFile(input.path, {
        encoding: input.encoding as BufferEncoding
      });
    }),

  writeFile: t.procedure
    .input(
      z.object({
        path: z.string(),
        content: z.string()
      })
    )
    .mutation(async ({ input }) => {
      const dir = path.dirname(input.path);
      await mkdir(dir, { recursive: true });
      await writeFile(input.path, input.content, { encoding: "utf-8" });
    }),

  fileInfo: t.procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      const stats = await stat(input.path);
      return {
        size: stats.size,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString()
      };
    }),

  exists: t.procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      try {
        await access(input.path);
        return true;
      } catch {
        return false;
      }
    }),

  mkdir: t.procedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(true)
      })
    )
    .mutation(async ({ input }) => {
      await mkdir(input.path, { recursive: input.recursive });
    }),

  remove: t.procedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(false)
      })
    )
    .mutation(async ({ input }) => {
      await rm(input.path, { recursive: input.recursive });
    }),

  watch: t.procedure
    .input(z.object({ path: z.string() }))
    .subscription(({ input }) => {
      return observable<{ event: string; path: string }>((emit) => {
        const watcher = chokidar.watch(input.path, {
          ignoreInitial: true,
          depth: 1
        });

        watcher.on("all", (event: string, filePath: string) => {
          emit.next({ event, path: filePath });
        });

        return () => {
          watcher.close();
        };
      });
    })
});
