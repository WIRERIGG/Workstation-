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
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);
const t = initTRPC.create();

type SearchMatch = {
  file: string;
  line: number;
  column: number;
  text: string;
  beforeContext: string[];
  afterContext: string[];
};

type SearchResult = {
  matches: SearchMatch[];
  fileCount: number;
  matchCount: number;
  truncated: boolean;
  duration: number;
  error: string | null;
};

/**
 * Find ripgrep binary. Checks: PATH, common install locations.
 */
async function findRipgrep(): Promise<string | null> {
  // Try PATH first
  try {
    await execFileAsync("rg", ["--version"]);
    return "rg";
  } catch {
    // not in PATH
  }

  // Common locations on Windows
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft",
      "WinGet",
      "Packages",
      "BurntSushi.ripgrep.MSVC_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "ripgrep-*-x86_64-pc-windows-msvc",
      "rg.exe"
    ),
    path.join(process.env.ProgramFiles || "", "ripgrep", "rg.exe"),
    path.join(
      process.env.USERPROFILE || "",
      "scoop",
      "apps",
      "ripgrep",
      "current",
      "rg.exe"
    ),
    path.join(
      process.env.USERPROFILE || "",
      ".cargo",
      "bin",
      "rg.exe"
    )
  ];

  for (const candidate of candidates) {
    // Handle glob patterns
    if (candidate.includes("*")) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Parse ripgrep JSON output into structured matches.
 */
function parseRipgrepJson(stdout: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lines = stdout.trim().split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "match") {
        const data = obj.data;
        matches.push({
          file: data.path?.text || "",
          line: data.line_number || 0,
          column: data.submatches?.[0]?.start || 0,
          text: data.lines?.text?.replace(/\n$/, "") || "",
          beforeContext: [],
          afterContext: []
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  return matches;
}

/**
 * Fallback: recursive file search using Node.js fs + regex.
 */
async function fallbackSearch(
  cwd: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
  includeGlob: string,
  maxResults: number
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  const pattern = isRegex
    ? new RegExp(query, caseSensitive ? "g" : "gi")
    : new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        caseSensitive ? "g" : "gi"
      );

  const extensions = includeGlob
    ? includeGlob
        .split(",")
        .map((g) => g.trim().replace(/^\*\./, "."))
        .filter(Boolean)
    : [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".css",
        ".html",
        ".md",
        ".rs",
        ".toml"
      ];

  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    "__pycache__",
    ".cache",
    "coverage"
  ]);

  async function walk(dir: string): Promise<void> {
    if (matches.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= maxResults) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!extensions.includes(ext)) continue;
        try {
          const content = await fs.promises.readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) return;
            if (pattern.test(lines[i])) {
              pattern.lastIndex = 0;
              const match = pattern.exec(lines[i]);
              matches.push({
                file: path.relative(cwd, fullPath).replace(/\\/g, "/"),
                line: i + 1,
                column: match ? match.index : 0,
                text: lines[i],
                beforeContext: lines
                  .slice(Math.max(0, i - 2), i)
                  .map((l) => l),
                afterContext: lines.slice(i + 1, i + 3).map((l) => l)
              });
              pattern.lastIndex = 0;
            }
          }
        } catch {
          // skip binary / unreadable files
        }
      }
    }
  }

  await walk(cwd);
  return matches;
}

export const codeSearchRouter = t.router({
  search: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        query: z.string().min(1),
        isRegex: z.boolean().default(false),
        caseSensitive: z.boolean().default(false),
        wholeWord: z.boolean().default(false),
        includeGlob: z.string().default(""),
        excludeGlob: z.string().default(""),
        maxResults: z.number().default(500),
        contextLines: z.number().default(2)
      })
    )
    .query(async ({ input }): Promise<SearchResult> => {
      const start = Date.now();
      const rgPath = await findRipgrep();

      if (rgPath) {
        // Use ripgrep
        const args: string[] = [
          "--json",
          "--max-filesize",
          "1M"
        ];

        if (!input.caseSensitive) args.push("-i");
        if (input.wholeWord) args.push("-w");
        if (!input.isRegex) args.push("-F");
        if (input.contextLines > 0) {
          args.push("-C", String(input.contextLines));
        }
        if (input.includeGlob) {
          for (const glob of input.includeGlob.split(",")) {
            args.push("-g", glob.trim());
          }
        }
        if (input.excludeGlob) {
          for (const glob of input.excludeGlob.split(",")) {
            args.push("-g", `!${glob.trim()}`);
          }
        }

        args.push("--", input.query, ".");

        try {
          const { stdout } = await execFileAsync(rgPath, args, {
            cwd: input.cwd,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000
          });

          const matches = parseRipgrepJson(stdout);
          const truncated = matches.length >= input.maxResults;
          const trimmed = matches.slice(0, input.maxResults);
          const files = new Set(trimmed.map((m) => m.file));

          return {
            matches: trimmed,
            fileCount: files.size,
            matchCount: trimmed.length,
            truncated,
            duration: Date.now() - start,
            error: null
          };
        } catch (err: any) {
          // rg exit code 1 = no matches (not an error)
          if (err.code === 1) {
            return {
              matches: [],
              fileCount: 0,
              matchCount: 0,
              truncated: false,
              duration: Date.now() - start,
              error: null
            };
          }
          // rg exit code 2 = actual error
          return {
            matches: [],
            fileCount: 0,
            matchCount: 0,
            truncated: false,
            duration: Date.now() - start,
            error: err.stderr || err.message || "ripgrep error"
          };
        }
      } else {
        // Fallback to Node.js search
        try {
          const matches = await fallbackSearch(
            input.cwd,
            input.query,
            input.isRegex,
            input.caseSensitive,
            input.includeGlob,
            input.maxResults
          );
          const files = new Set(matches.map((m) => m.file));

          return {
            matches,
            fileCount: files.size,
            matchCount: matches.length,
            truncated: matches.length >= input.maxResults,
            duration: Date.now() - start,
            error: null
          };
        } catch (err: any) {
          return {
            matches: [],
            fileCount: 0,
            matchCount: 0,
            truncated: false,
            duration: Date.now() - start,
            error: err.message || "Search failed"
          };
        }
      }
    }),

  /** List available file types for filtering */
  fileTypes: t.procedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const types: Record<string, number> = {};
      const SKIP = new Set([
        "node_modules",
        ".git",
        "dist",
        "build",
        "target"
      ]);

      async function scan(dir: string, depth: number): Promise<void> {
        if (depth > 4) return;
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.isDirectory() && !SKIP.has(entry.name)) {
            await scan(path.join(dir, entry.name), depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (ext) types[ext] = (types[ext] || 0) + 1;
          }
        }
      }

      await scan(input.cwd, 0);
      return Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([ext, count]) => ({ ext, count }));
    })
});
