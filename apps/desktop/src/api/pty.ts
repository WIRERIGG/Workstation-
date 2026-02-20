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

import os from "node:os";
import { randomUUID } from "node:crypto";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import * as pty from "node-pty";

const t = initTRPC.create();

interface PtySession {
  process: pty.IPty;
  pid: number;
}

const sessions = new Map<string, PtySession>();

function getDefaultShell(): string {
  if (os.platform() === "win32") {
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

export const ptyRouter = t.router({
  spawn: t.procedure
    .input(
      z.object({
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
        cwd: z.string().optional()
      })
    )
    .mutation(({ input }) => {
      const { cols, rows, cwd } = input;
      const id = randomUUID();
      const shell = getDefaultShell();

      const proc = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: cwd || os.homedir(),
        env: process.env as Record<string, string>
      });

      sessions.set(id, { process: proc, pid: proc.pid });

      return { id, pid: proc.pid };
    }),

  write: t.procedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: z.string()
      })
    )
    .mutation(({ input }) => {
      const session = sessions.get(input.id);
      if (!session) throw new Error(`PTY session not found: ${input.id}`);
      session.process.write(input.data);
    }),

  resize: t.procedure
    .input(
      z.object({
        id: z.string().uuid(),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
      })
    )
    .mutation(({ input }) => {
      const session = sessions.get(input.id);
      if (!session) throw new Error(`PTY session not found: ${input.id}`);
      session.process.resize(input.cols, input.rows);
    }),

  kill: t.procedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      const session = sessions.get(input.id);
      if (!session) throw new Error(`PTY session not found: ${input.id}`);
      session.process.kill();
      sessions.delete(input.id);
    }),

  onData: t.procedure
    .input(z.object({ id: z.string().uuid() }))
    .subscription(({ input }) => {
      return observable<string>((emit) => {
        const session = sessions.get(input.id);
        if (!session) {
          emit.error(new Error(`PTY session not found: ${input.id}`));
          return;
        }

        const disposable = session.process.onData((data) => {
          emit.next(data);
        });

        return () => {
          disposable.dispose();
        };
      });
    }),

  onExit: t.procedure
    .input(z.object({ id: z.string().uuid() }))
    .subscription(({ input }) => {
      return observable<{ exitCode: number; signal?: number }>((emit) => {
        const session = sessions.get(input.id);
        if (!session) {
          emit.error(new Error(`PTY session not found: ${input.id}`));
          return;
        }

        const disposable = session.process.onExit(({ exitCode, signal }) => {
          sessions.delete(input.id);
          emit.next({ exitCode, signal });
          emit.complete();
        });

        return () => {
          disposable.dispose();
        };
      });
    })
});
