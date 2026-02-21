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

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export type Diagnostic = {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  source: "typescript" | "eslint";
  code: string;
};

export type DiagnosticsResult = {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  fileCount: number;
  duration: number;
  error: string | null;
};

/**
 * Find the nearest tsconfig.json from cwd upward.
 */
function findTsConfig(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const tsconfig = path.join(dir, "tsconfig.json");
    if (fs.existsSync(tsconfig)) return tsconfig;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find tsc binary — checks local node_modules first, then PATH.
 */
async function findTsc(cwd: string): Promise<string | null> {
  // Local node_modules
  const localTsc = path.join(cwd, "node_modules", ".bin", "tsc");
  const localTscCmd = localTsc + (process.platform === "win32" ? ".cmd" : "");
  if (fs.existsSync(localTscCmd)) return localTscCmd;

  // Walk up
  let dir = path.dirname(cwd);
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(
      dir,
      "node_modules",
      ".bin",
      "tsc" + (process.platform === "win32" ? ".cmd" : "")
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // PATH
  try {
    await execFileAsync("tsc", ["--version"]);
    return "tsc";
  } catch {
    return null;
  }
}

/**
 * Parse `tsc --noEmit` output.
 * Format: file(line,col): error TSxxxx: message
 */
function parseTscOutput(output: string, cwd: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const pattern =
    /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;

  let match;
  while ((match = pattern.exec(output)) !== null) {
    const filePath = match[1].replace(/\\/g, "/");
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(cwd, filePath).replace(/\\/g, "/")
      : filePath;

    diagnostics.push({
      file: relativePath,
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4] === "error" ? "error" : "warning",
      message: match[6],
      source: "typescript",
      code: match[5]
    });
  }

  return diagnostics;
}

/**
 * Find eslint binary.
 */
async function findEslint(cwd: string): Promise<string | null> {
  const localEslint = path.join(
    cwd,
    "node_modules",
    ".bin",
    "eslint" + (process.platform === "win32" ? ".cmd" : "")
  );
  if (fs.existsSync(localEslint)) return localEslint;

  let dir = path.dirname(cwd);
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(
      dir,
      "node_modules",
      ".bin",
      "eslint" + (process.platform === "win32" ? ".cmd" : "")
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  try {
    await execFileAsync("eslint", ["--version"]);
    return "eslint";
  } catch {
    return null;
  }
}

/**
 * Parse ESLint JSON output.
 */
function parseEslintOutput(output: string, cwd: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  try {
    const results = JSON.parse(output);
    for (const result of results) {
      const filePath = path.isAbsolute(result.filePath)
        ? path.relative(cwd, result.filePath).replace(/\\/g, "/")
        : result.filePath;
      for (const msg of result.messages) {
        diagnostics.push({
          file: filePath,
          line: msg.line || 1,
          column: msg.column || 1,
          endLine: msg.endLine,
          endColumn: msg.endColumn,
          severity:
            msg.severity === 2
              ? "error"
              : msg.severity === 1
                ? "warning"
                : "info",
          message: msg.message,
          source: "eslint",
          code: msg.ruleId || "unknown"
        });
      }
    }
  } catch {
    // malformed output
  }
  return diagnostics;
}

export const diagnosticsRouter = t.router({
  /** Run TypeScript type checking (tsc --noEmit) */
  runTsc: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        tsconfig: z.string().optional()
      })
    )
    .query(async ({ input }): Promise<DiagnosticsResult> => {
      const start = Date.now();
      const tsc = await findTsc(input.cwd);
      if (!tsc) {
        return {
          diagnostics: [],
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          fileCount: 0,
          duration: Date.now() - start,
          error: "TypeScript compiler (tsc) not found"
        };
      }

      const tsconfig = input.tsconfig || findTsConfig(input.cwd);
      const args = ["--noEmit", "--pretty", "false"];
      if (tsconfig) args.push("-p", tsconfig);

      try {
        const { stdout, stderr } = await execFileAsync(tsc, args, {
          cwd: input.cwd,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120000,
          shell: process.platform === "win32"
        });
        const output = stdout + "\n" + stderr;
        const diagnostics = parseTscOutput(output, input.cwd);
        const files = new Set(diagnostics.map((d) => d.file));

        return {
          diagnostics,
          errorCount: diagnostics.filter((d) => d.severity === "error").length,
          warningCount: diagnostics.filter((d) => d.severity === "warning")
            .length,
          infoCount: diagnostics.filter((d) => d.severity === "info").length,
          fileCount: files.size,
          duration: Date.now() - start,
          error: null
        };
      } catch (err: any) {
        // tsc exits with code 2 when there are errors — that's normal
        const output = (err.stdout || "") + "\n" + (err.stderr || "");
        const diagnostics = parseTscOutput(output, input.cwd);
        if (diagnostics.length > 0) {
          const files = new Set(diagnostics.map((d) => d.file));
          return {
            diagnostics,
            errorCount: diagnostics.filter((d) => d.severity === "error")
              .length,
            warningCount: diagnostics.filter((d) => d.severity === "warning")
              .length,
            infoCount: diagnostics.filter((d) => d.severity === "info").length,
            fileCount: files.size,
            duration: Date.now() - start,
            error: null
          };
        }
        return {
          diagnostics: [],
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          fileCount: 0,
          duration: Date.now() - start,
          error: err.message || "tsc failed"
        };
      }
    }),

  /** Run ESLint */
  runEslint: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        paths: z.array(z.string()).default(["."])
      })
    )
    .query(async ({ input }): Promise<DiagnosticsResult> => {
      const start = Date.now();
      const eslint = await findEslint(input.cwd);
      if (!eslint) {
        return {
          diagnostics: [],
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          fileCount: 0,
          duration: Date.now() - start,
          error: "ESLint not found"
        };
      }

      const args = ["--format", "json", "--no-error-on-unmatched-pattern"];
      args.push(...input.paths);

      try {
        const { stdout } = await execFileAsync(eslint, args, {
          cwd: input.cwd,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120000,
          shell: process.platform === "win32"
        });

        const diagnostics = parseEslintOutput(stdout, input.cwd);
        const files = new Set(diagnostics.map((d) => d.file));

        return {
          diagnostics,
          errorCount: diagnostics.filter((d) => d.severity === "error").length,
          warningCount: diagnostics.filter((d) => d.severity === "warning")
            .length,
          infoCount: diagnostics.filter((d) => d.severity === "info").length,
          fileCount: files.size,
          duration: Date.now() - start,
          error: null
        };
      } catch (err: any) {
        // ESLint exits with code 1 when there are lint errors
        const stdout = err.stdout || "";
        const diagnostics = parseEslintOutput(stdout, input.cwd);
        if (diagnostics.length > 0) {
          const files = new Set(diagnostics.map((d) => d.file));
          return {
            diagnostics,
            errorCount: diagnostics.filter((d) => d.severity === "error")
              .length,
            warningCount: diagnostics.filter((d) => d.severity === "warning")
              .length,
            infoCount: diagnostics.filter((d) => d.severity === "info").length,
            fileCount: files.size,
            duration: Date.now() - start,
            error: null
          };
        }
        return {
          diagnostics: [],
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          fileCount: 0,
          duration: Date.now() - start,
          error: err.message || "ESLint failed"
        };
      }
    }),

  /** Run both tsc + eslint and merge results */
  runAll: t.procedure
    .input(
      z.object({
        cwd: z.string(),
        tsconfig: z.string().optional(),
        eslintPaths: z.array(z.string()).default(["."])
      })
    )
    .query(async ({ input }): Promise<DiagnosticsResult> => {
      const start = Date.now();
      const allDiagnostics: Diagnostic[] = [];
      const errors: string[] = [];

      // Run tsc
      const tsc = await findTsc(input.cwd);
      if (tsc) {
        const tsconfig = input.tsconfig || findTsConfig(input.cwd);
        const args = ["--noEmit", "--pretty", "false"];
        if (tsconfig) args.push("-p", tsconfig);
        try {
          const { stdout, stderr } = await execFileAsync(tsc, args, {
            cwd: input.cwd,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120000,
            shell: process.platform === "win32"
          });
          allDiagnostics.push(
            ...parseTscOutput(stdout + "\n" + stderr, input.cwd)
          );
        } catch (err: any) {
          const output = (err.stdout || "") + "\n" + (err.stderr || "");
          const parsed = parseTscOutput(output, input.cwd);
          if (parsed.length > 0) {
            allDiagnostics.push(...parsed);
          } else {
            errors.push(`tsc: ${err.message}`);
          }
        }
      }

      // Run eslint
      const eslint = await findEslint(input.cwd);
      if (eslint) {
        const args = [
          "--format",
          "json",
          "--no-error-on-unmatched-pattern",
          ...input.eslintPaths
        ];
        try {
          const { stdout } = await execFileAsync(eslint, args, {
            cwd: input.cwd,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120000,
            shell: process.platform === "win32"
          });
          allDiagnostics.push(...parseEslintOutput(stdout, input.cwd));
        } catch (err: any) {
          const parsed = parseEslintOutput(err.stdout || "", input.cwd);
          if (parsed.length > 0) {
            allDiagnostics.push(...parsed);
          } else {
            errors.push(`eslint: ${err.message}`);
          }
        }
      }

      const files = new Set(allDiagnostics.map((d) => d.file));
      return {
        diagnostics: allDiagnostics,
        errorCount: allDiagnostics.filter((d) => d.severity === "error").length,
        warningCount: allDiagnostics.filter((d) => d.severity === "warning")
          .length,
        infoCount: allDiagnostics.filter((d) => d.severity === "info").length,
        fileCount: files.size,
        duration: Date.now() - start,
        error: errors.length > 0 ? errors.join("; ") : null
      };
    })
});
