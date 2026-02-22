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
import { z } from "zod";
import simpleGit from "simple-git";

const t = initTRPC.create();

function getGit(cwd: string) {
  return simpleGit(cwd);
}

export const gitRouter = t.router({
  status: t.procedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.status();
    }),

  log: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        maxCount: z.number().default(20)
      })
    )
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.log({ maxCount: input.maxCount });
    }),

  diff: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        staged: z.boolean().default(false)
      })
    )
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      if (input.staged) {
        return await git.diff(["--cached"]);
      }
      return await git.diff();
    }),

  add: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        files: z.array(z.string())
      })
    )
    .mutation(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.add(input.files);
    }),

  commit: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        message: z.string()
      })
    )
    .mutation(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.commit(input.message);
    }),

  branches: t.procedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.branchLocal();
    }),

  checkout: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        branch: z.string()
      })
    )
    .mutation(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.checkout(input.branch);
    }),

  isRepo: t.procedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.checkIsRepo();
    })
});
