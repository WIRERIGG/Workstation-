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

const t = initTRPC.create();

let highlighterInstance: any = null;

async function getHighlighter() {
  if (!highlighterInstance) {
    const { createHighlighter } = await import("shiki");
    highlighterInstance = await createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [
        "javascript",
        "typescript",
        "json",
        "html",
        "css",
        "python",
        "rust",
        "go",
        "bash",
        "markdown",
        "yaml",
        "sql"
      ]
    });
  }
  return highlighterInstance;
}

export const highlighterRouter = t.router({
  highlight: t.procedure
    .input(
      z.object({
        code: z.string(),
        lang: z.string().default("typescript"),
        theme: z.string().default("github-dark")
      })
    )
    .query(async ({ input }) => {
      const { code, lang, theme } = input;
      const highlighter = await getHighlighter();
      return highlighter.codeToHtml(code, { lang, theme }) as string;
    }),
  languages: t.procedure.query(async () => {
    const highlighter = await getHighlighter();
    return highlighter.getLoadedLanguages() as string[];
  })
});
