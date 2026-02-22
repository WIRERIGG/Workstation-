# Consolidate to Electron-Only Desktop Runtime — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Tauri, keep Electron as the sole desktop runtime, and port Tauri-only features (PTY, Git, Filesystem, Syntax Highlighting) to Node.js tRPC routers.

**Architecture:** Four new tRPC routers (`pty`, `git`, `filesystem`, `highlighter`) added to `apps/desktop/src/api/` following the existing pattern (initTRPC + zod input validation). Frontend views rewired from Tauri `invoke()` to tRPC calls via `desktop-bridge/index.desktop.ts`. Vite config simplified from 3-way to 2-way platform routing.

**Tech Stack:** Node.js (`node-pty`, `simple-git`, `chokidar`, `shiki`), tRPC v10, Electron, Vite

**Design Doc:** `docs/plans/2026-02-20-consolidate-to-electron-design.md`

---

## Phase 1: Add Node.js tRPC Routers

### Task 1: Install Dependencies

**Files:**
- Modify: `apps/desktop/package.json`

**Step 1: Install new packages**

```bash
cd apps/desktop
npm install node-pty simple-git chokidar shiki
```

**Step 2: Add node-pty to esbuild externals**

In `apps/desktop/package.json`, the `bundle` script uses esbuild with `--external:`. Add `node-pty` to the external list since it's a native module that can't be bundled.

Check `apps/desktop/scripts/build.mjs` for the externals list and add `node-pty` there.

**Step 3: Commit**

```bash
git add apps/desktop/package.json apps/desktop/package-lock.json
git commit -s -m "desktop: add node-pty, simple-git, chokidar, shiki dependencies"
```

---

### Task 2: Create PTY Router

**Files:**
- Create: `apps/desktop/src/api/pty.ts`
- Modify: `apps/desktop/src/api/index.ts:20-41` — register router

**Step 1: Create `apps/desktop/src/api/pty.ts`**

Follow the pattern from `compression.ts` (initTRPC + zod). The router must support:
- `spawn` — start a shell process, return a session ID
- `write` — send stdin data to a session
- `resize` — resize the terminal (cols, rows)
- `kill` — kill a session

For stdout streaming, use tRPC subscriptions via `observable()`.

```typescript
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { observable } from "@trpc/server/observable";
import * as pty from "node-pty";
import os from "node:os";

const t = initTRPC.create();

const sessions = new Map<string, pty.IPty>();
let sessionCounter = 0;

function getShell(): string {
  return os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash";
}

export const ptyRouter = t.router({
  spawn: t.procedure
    .input(z.object({
      cols: z.number().default(80),
      rows: z.number().default(24),
      cwd: z.string().optional()
    }))
    .mutation(({ input }) => {
      const id = `pty-${++sessionCounter}`;
      const shell = getShell();
      const proc = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: input.cols,
        rows: input.rows,
        cwd: input.cwd || os.homedir(),
        env: process.env as Record<string, string>
      });
      sessions.set(id, proc);
      return { id, pid: proc.pid };
    }),

  write: t.procedure
    .input(z.object({ id: z.string(), data: z.string() }))
    .mutation(({ input }) => {
      const proc = sessions.get(input.id);
      if (!proc) throw new Error(`No PTY session: ${input.id}`);
      proc.write(input.data);
    }),

  resize: t.procedure
    .input(z.object({ id: z.string(), cols: z.number(), rows: z.number() }))
    .mutation(({ input }) => {
      const proc = sessions.get(input.id);
      if (!proc) throw new Error(`No PTY session: ${input.id}`);
      proc.resize(input.cols, input.rows);
    }),

  kill: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const proc = sessions.get(input.id);
      if (!proc) return;
      proc.kill();
      sessions.delete(input.id);
    }),

  onData: t.procedure
    .input(z.object({ id: z.string() }))
    .subscription(({ input }) => {
      return observable<string>((emit) => {
        const proc = sessions.get(input.id);
        if (!proc) {
          emit.error(new Error(`No PTY session: ${input.id}`));
          return;
        }
        const disposable = proc.onData((data) => emit.next(data));
        proc.onExit(() => emit.complete());
        return () => { disposable.dispose(); };
      });
    }),

  onExit: t.procedure
    .input(z.object({ id: z.string() }))
    .subscription(({ input }) => {
      return observable<{ exitCode: number }>((emit) => {
        const proc = sessions.get(input.id);
        if (!proc) {
          emit.error(new Error(`No PTY session: ${input.id}`));
          return;
        }
        proc.onExit(({ exitCode }) => {
          sessions.delete(input.id);
          emit.next({ exitCode });
          emit.complete();
        });
        return () => {};
      });
    })
});
```

**Step 2: Register in `apps/desktop/src/api/index.ts`**

Add import and router entry:

```typescript
import { ptyRouter } from "./pty";

export const router = t.router({
  compress: compressionRouter,
  integration: osIntegrationRouter,
  spellChecker: spellCheckerRouter,
  updater: updaterRouter,
  bridge: bridgeRouter,
  safeStorage: safeStorageRouter,
  window: windowRouter,
  workstationData: workstationDataRouter,
  pty: ptyRouter
});
```

**Step 3: Verify Electron starts without errors**

```bash
cd apps/desktop && npm start
```

Expected: Electron opens without crash. New router registered but no frontend consumer yet.

**Step 4: Commit**

```bash
git add apps/desktop/src/api/pty.ts apps/desktop/src/api/index.ts
git commit -s -m "desktop: add PTY tRPC router with node-pty"
```

---

### Task 3: Create Git Router

**Files:**
- Create: `apps/desktop/src/api/git.ts`
- Modify: `apps/desktop/src/api/index.ts` — register router

**Step 1: Create `apps/desktop/src/api/git.ts`**

```typescript
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import simpleGit, { SimpleGit } from "simple-git";

const t = initTRPC.create();

function getGit(cwd: string): SimpleGit {
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
    .input(z.object({
      cwd: z.string(),
      maxCount: z.number().default(20)
    }))
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.log({ maxCount: input.maxCount });
    }),

  diff: t.procedure
    .input(z.object({
      cwd: z.string(),
      staged: z.boolean().default(false)
    }))
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      return input.staged ? await git.diff(["--cached"]) : await git.diff();
    }),

  add: t.procedure
    .input(z.object({ cwd: z.string(), files: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const git = getGit(input.cwd);
      await git.add(input.files);
    }),

  commit: t.procedure
    .input(z.object({ cwd: z.string(), message: z.string() }))
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
    .input(z.object({ cwd: z.string(), branch: z.string() }))
    .mutation(async ({ input }) => {
      const git = getGit(input.cwd);
      await git.checkout(input.branch);
    }),

  isRepo: t.procedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const git = getGit(input.cwd);
      return await git.checkIsRepo();
    })
});
```

**Step 2: Register in `apps/desktop/src/api/index.ts`**

Add `import { gitRouter } from "./git";` and `git: gitRouter` to the router object.

**Step 3: Commit**

```bash
git add apps/desktop/src/api/git.ts apps/desktop/src/api/index.ts
git commit -s -m "desktop: add Git tRPC router with simple-git"
```

---

### Task 4: Create Filesystem Router

**Files:**
- Create: `apps/desktop/src/api/filesystem.ts`
- Modify: `apps/desktop/src/api/index.ts` — register router

**Step 1: Create `apps/desktop/src/api/filesystem.ts`**

```typescript
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { observable } from "@trpc/server/observable";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import chokidar from "chokidar";

const t = initTRPC.create();

export const filesystemRouter = t.router({
  homeDir: t.procedure.query(() => os.homedir()),

  listDir: t.procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      const entries = await fs.readdir(input.path, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: path.join(input.path, e.name),
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        isSymlink: e.isSymbolicLink()
      }));
    }),

  readFile: t.procedure
    .input(z.object({ path: z.string(), encoding: z.string().default("utf-8") }))
    .query(async ({ input }) => {
      return await fs.readFile(input.path, { encoding: input.encoding as BufferEncoding });
    }),

  writeFile: t.procedure
    .input(z.object({ path: z.string(), content: z.string() }))
    .mutation(async ({ input }) => {
      await fs.writeFile(input.path, input.content, "utf-8");
    }),

  fileInfo: t.procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      const stat = await fs.stat(input.path);
      return {
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString()
      };
    }),

  exists: t.procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      try { await fs.access(input.path); return true; }
      catch { return false; }
    }),

  mkdir: t.procedure
    .input(z.object({ path: z.string(), recursive: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      await fs.mkdir(input.path, { recursive: input.recursive });
    }),

  remove: t.procedure
    .input(z.object({ path: z.string(), recursive: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      await fs.rm(input.path, { recursive: input.recursive });
    }),

  watch: t.procedure
    .input(z.object({ path: z.string() }))
    .subscription(({ input }) => {
      return observable<{ event: string; path: string }>((emit) => {
        const watcher = chokidar.watch(input.path, {
          ignoreInitial: true,
          depth: 1
        });
        watcher.on("add", (p) => emit.next({ event: "add", path: p }));
        watcher.on("change", (p) => emit.next({ event: "change", path: p }));
        watcher.on("unlink", (p) => emit.next({ event: "unlink", path: p }));
        watcher.on("addDir", (p) => emit.next({ event: "addDir", path: p }));
        watcher.on("unlinkDir", (p) => emit.next({ event: "unlinkDir", path: p }));
        return () => { watcher.close(); };
      });
    })
});
```

**Step 2: Register in `apps/desktop/src/api/index.ts`**

Add `import { filesystemRouter } from "./filesystem";` and `filesystem: filesystemRouter` to the router object.

**Step 3: Commit**

```bash
git add apps/desktop/src/api/filesystem.ts apps/desktop/src/api/index.ts
git commit -s -m "desktop: add Filesystem tRPC router with chokidar"
```

---

### Task 5: Create Highlighter Router

**Files:**
- Create: `apps/desktop/src/api/highlighter.ts`
- Modify: `apps/desktop/src/api/index.ts` — register router

**Step 1: Create `apps/desktop/src/api/highlighter.ts`**

```typescript
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
        "javascript", "typescript", "json", "html", "css",
        "python", "rust", "go", "bash", "markdown", "yaml", "sql"
      ]
    });
  }
  return highlighterInstance;
}

export const highlighterRouter = t.router({
  highlight: t.procedure
    .input(z.object({
      code: z.string(),
      lang: z.string().default("typescript"),
      theme: z.string().default("github-dark")
    }))
    .query(async ({ input }) => {
      const highlighter = await getHighlighter();
      return highlighter.codeToHtml(input.code, {
        lang: input.lang,
        theme: input.theme
      });
    }),

  languages: t.procedure.query(async () => {
    const highlighter = await getHighlighter();
    return highlighter.getLoadedLanguages();
  })
});
```

**Step 2: Register in `apps/desktop/src/api/index.ts`**

Add `import { highlighterRouter } from "./highlighter";` and `highlighter: highlighterRouter` to the router object.

**Step 3: Verify all 12 routers load**

```bash
cd apps/desktop && npm start
```

Expected: Electron opens. Console should show no import errors.

**Step 4: Commit**

```bash
git add apps/desktop/src/api/highlighter.ts apps/desktop/src/api/index.ts
git commit -s -m "desktop: add Highlighter tRPC router with shiki"
```

---

## Phase 2: Rewire Frontend Views

### Task 6: Update `desktop-bridge/index.desktop.ts` to Expose New Routers

**Files:**
- Modify: `apps/web/src/common/desktop-bridge/index.desktop.ts`

The tRPC proxy client in `index.desktop.ts` already has access to all routers via the `AppRouter` type. The frontend views need to call the tRPC client's new router methods. Since the client is type-safe and auto-discovers routers from the `AppRouter` type export, no changes are needed to the bridge file itself — the new `pty`, `git`, `filesystem`, and `highlighter` methods will be available automatically via `desktop.pty.spawn.mutate(...)` etc.

**Step 1: Verify the tRPC client type includes new routers**

Read `apps/web/src/common/desktop-bridge/index.desktop.ts` and confirm the `createTRPCProxyClient<AppRouter>` call. Since `AppRouter` is re-exported from the desktop api/index.ts (which now includes all 12 routers), the proxy client auto-exposes them.

**Step 2: No code change needed — commit not required**

---

### Task 7: Rewire Terminal View

**Files:**
- Modify: `apps/web/src/views/terminal.tsx`

**Step 1: Replace Tauri invoke calls with tRPC calls**

The current `terminal.tsx` has two implementations:
- `PtyTerminal` (lines 38-281): Uses `invoke("pty_spawn")`, `invoke("pty_write")`, etc.
- `MockTerminal` (lines 325-541): Web fallback

Replace the IS_TAURI guard + PtyTerminal with an IS_DESKTOP_APP guard that calls the tRPC pty router:

- Replace `invoke("pty_spawn", ...)` with `desktop.pty.spawn.mutate(...)`
- Replace `invoke("pty_write", ...)` with `desktop.pty.write.mutate(...)`
- Replace `invoke("pty_resize", ...)` with `desktop.pty.resize.mutate(...)`
- Replace `invoke("pty_kill", ...)` with `desktop.pty.kill.mutate(...)`
- Replace `listen("pty-output", ...)` with `desktop.pty.onData.subscribe(...)` (tRPC subscription)
- Replace `listen("pty-exit", ...)` with `desktop.pty.onExit.subscribe(...)`
- Remove all `@tauri-apps/api` imports
- Change guard from `IS_TAURI` to `IS_DESKTOP_APP`

**Step 2: Remove MockTerminal web fallback toggle**

Keep MockTerminal for web-only mode, but the guard becomes `IS_DESKTOP_APP ? <ElectronTerminal /> : <MockTerminal />`.

**Step 3: Test in Electron**

```bash
cd apps/desktop && npm start
```

Navigate to terminal view. Expected: shell spawns, can type commands, output displays.

**Step 4: Commit**

```bash
git add apps/web/src/views/terminal.tsx
git commit -s -m "web: rewire terminal view from Tauri invoke to Electron tRPC"
```

---

### Task 8: Rewire Git Panel View

**Files:**
- Modify: `apps/web/src/views/git-panel.tsx`

**Step 1: Replace Tauri invoke calls with tRPC calls**

- Replace `invoke("git_status", { cwd })` with `desktop.git.status.query({ cwd })`
- Replace `invoke("git_log", { cwd, max_count })` with `desktop.git.log.query({ cwd, maxCount })`
- Replace `invoke("git_diff", { cwd, staged })` with `desktop.git.diff.query({ cwd, staged })`
- Replace `invoke("git_add", { cwd, files })` with `desktop.git.add.mutate({ cwd, files })`
- Replace `invoke("git_commit", { cwd, message })` with `desktop.git.commit.mutate({ cwd, message })`
- Replace `invoke("git_branches", { cwd })` with `desktop.git.branches.query({ cwd })`
- Replace `invoke("git_checkout", { cwd, branch })` with `desktop.git.checkout.mutate({ cwd, branch })`
- Remove all `@tauri-apps/api` imports
- Change guard from `IS_TAURI` to `IS_DESKTOP_APP`

**Step 2: Adapt response shapes**

`simple-git` returns slightly different shapes than the Tauri git2 wrapper. Map the response objects as needed. Key differences:
- `simple-git` status: `{ modified: string[], created: string[], deleted: string[], ... }`
- `simple-git` log: `{ all: Array<{ hash, date, message, author_name, ... }> }`

**Step 3: Test in Electron**

Open Git panel. Expected: shows status of current repo, commit log, diff.

**Step 4: Commit**

```bash
git add apps/web/src/views/git-panel.tsx
git commit -s -m "web: rewire git panel from Tauri invoke to Electron tRPC"
```

---

### Task 9: Rewire File Explorer View

**Files:**
- Modify: `apps/web/src/views/file-explorer.tsx`

**Step 1: Replace Tauri invoke calls with tRPC calls**

- Replace `invoke("fs_get_home_dir")` with `desktop.filesystem.homeDir.query()`
- Replace `invoke("fs_list_dir", { path })` with `desktop.filesystem.listDir.query({ path })`
- Replace `invoke("fs_read_file", { path })` with `desktop.filesystem.readFile.query({ path })`
- Replace `invoke("fs_file_info", { path })` with `desktop.filesystem.fileInfo.query({ path })`
- Remove all `@tauri-apps/api` imports
- Change guard from `IS_TAURI` to `IS_DESKTOP_APP`

**Step 2: Test in Electron**

Open File Explorer. Expected: shows home directory, can navigate folders, open files.

**Step 3: Commit**

```bash
git add apps/web/src/views/file-explorer.tsx
git commit -s -m "web: rewire file explorer from Tauri invoke to Electron tRPC"
```

---

### Task 10: Rewire Conversations and Workspaces Views

**Files:**
- Modify: `apps/web/src/views/conversations.tsx`
- Modify: `apps/web/src/views/workspaces.tsx`

**Step 1: Change IS_TAURI guards to IS_DESKTOP_APP**

These views use IS_TAURI to toggle between a "Real" component and a fallback. Change the guard to IS_DESKTOP_APP. If the "Real" components use Tauri invoke internally, rewire to appropriate tRPC calls (likely filesystem or workstationData router).

**Step 2: Remove @tauri-apps imports**

**Step 3: Commit**

```bash
git add apps/web/src/views/conversations.tsx apps/web/src/views/workspaces.tsx
git commit -s -m "web: rewire conversations and workspaces from Tauri to Electron"
```

---

## Phase 3: Remove Tauri Code

### Task 11: Delete `src-tauri/` Directory

**Files:**
- Delete: `src-tauri/` (entire directory)

**Step 1: Delete**

```bash
rm -rf src-tauri/
```

**Step 2: Remove Tauri scripts from root `package.json`**

Remove `start:tauri` and `build:tauri` scripts.

**Step 3: Commit**

```bash
git add -A
git commit -s -m "global: remove src-tauri/ directory and Tauri build scripts"
```

---

### Task 12: Delete Tauri Bridge Files

**Files:**
- Delete: `apps/web/src/common/desktop-bridge/index.tauri.ts`
- Delete: `apps/web/src/common/sqlite/index.tauri.ts`

**Step 1: Delete files**

```bash
rm apps/web/src/common/desktop-bridge/index.tauri.ts
rm apps/web/src/common/sqlite/index.tauri.ts
```

**Step 2: Remove Tauri scripts from `apps/web/package.json`**

Remove `start:tauri` and `build:tauri` scripts.

**Step 3: Commit**

```bash
git add -A
git commit -s -m "web: remove Tauri bridge and SQLite driver files"
```

---

### Task 13: Simplify Vite Config

**Files:**
- Modify: `apps/web/vite.config.ts:44-46` — remove isTauri
- Modify: `apps/web/vite.config.ts:100-102` — remove IS_TAURI define
- Modify: `apps/web/vite.config.ts:121-138` — simplify alias routing
- Modify: `apps/web/vite.config.ts:165,181-186` — remove @tauri-apps externalization

**Step 1: Remove `isTauri` variable**

Change:
```typescript
const isDesktop = process.env.PLATFORM === "desktop";
const isTauri = process.env.PLATFORM === "tauri";
const isDesktopLike = isDesktop || isTauri;
```

To:
```typescript
const isDesktop = process.env.PLATFORM === "desktop";
```

Then replace all `isDesktopLike` references with `isDesktop`.

**Step 2: Remove IS_TAURI from `define`**

Remove `IS_TAURI: isTauri` from the `define` block.

**Step 3: Simplify alias routing from 3-way to 2-way**

Change:
```typescript
{
  find: /\/desktop-bridge$/gm,
  replacement: isTauri
    ? "/desktop-bridge/index.tauri"
    : isDesktop
      ? "/desktop-bridge/index.desktop"
      : "/desktop-bridge/index"
}
```

To:
```typescript
{
  find: /\/desktop-bridge$/gm,
  replacement: isDesktop
    ? "/desktop-bridge/index.desktop"
    : "/desktop-bridge/index"
}
```

Same for the sqlite alias.

**Step 4: Remove @tauri-apps esbuild externalization**

Remove the esbuild plugin or condition that externalizes `@tauri-apps/*` packages.

**Step 5: Build and verify**

```bash
cd apps/web && npm run build
```

Expected: Build succeeds with no Tauri-related errors.

**Step 6: Commit**

```bash
git add apps/web/vite.config.ts
git commit -s -m "web: simplify vite config to 2-way platform routing (remove Tauri)"
```

---

## Phase 4: Clean Up IS_TAURI References

### Task 14: Remove IS_TAURI from All Source Files

**Files (9 files):**
- Modify: `apps/web/src/views/terminal.tsx` — already done in Task 7
- Modify: `apps/web/src/views/git-panel.tsx` — already done in Task 8
- Modify: `apps/web/src/views/file-explorer.tsx` — already done in Task 9
- Modify: `apps/web/src/views/workspaces.tsx` — already done in Task 10
- Modify: `apps/web/src/views/conversations.tsx` — already done in Task 10
- Modify: `apps/web/src/components/navigation-menu/index.tsx:140-141,659` — remove isTauri variable, change conditions to IS_DESKTOP_APP
- Modify: `apps/web/src/components/command-bar/index.tsx:26,83,95,230,243,256` — remove IS_TAURI references, change to IS_DESKTOP_APP
- Modify: `apps/web/src/common/db.ts:81` — change `IS_TAURI ? "DELETE" : "WAL"` to just `"WAL"` (Electron uses WAL)
- Modify: `apps/web/src/utils/logger.ts:42` — same journalMode fix

**Step 1: Fix navigation-menu**

Remove `const isTauri = IS_TAURI;` and replace usage with `IS_DESKTOP_APP`.

**Step 2: Fix command-bar**

Remove all IS_TAURI conditionals. If a command was Tauri-only, make it IS_DESKTOP_APP.

**Step 3: Fix db.ts and logger.ts**

Change `IS_TAURI ? "DELETE" : "WAL"` to `"WAL"` (Electron always uses WAL mode).

**Step 4: Remove IS_TAURI from global.d.ts**

Check `apps/web/src/global.d.ts` for the `declare const IS_TAURI: boolean;` declaration and remove it.

**Step 5: Verify build**

```bash
cd apps/web && npm run build
cd apps/web && npm run build:desktop
```

Expected: Both builds succeed. No references to IS_TAURI remain.

**Step 6: Full grep to confirm cleanup**

```bash
grep -rn "IS_TAURI\|isTauri\|@tauri-apps\|tauri-plugin\|PLATFORM.*tauri" apps/web/src/ --include="*.ts" --include="*.tsx"
```

Expected: Zero results.

**Step 7: Commit**

```bash
git add -A
git commit -s -m "web: remove all IS_TAURI references, simplify to Electron-only desktop"
```

---

### Task 15: Remove Tauri Dependencies from package.json Files

**Files:**
- Modify: `apps/web/package.json` — remove any `@tauri-apps/*` dependencies
- Modify: Root `package.json` — remove Tauri scripts

**Step 1: Check and remove @tauri-apps packages**

```bash
grep -n "@tauri-apps" apps/web/package.json
```

Remove any found. Run `npm install` to clean lock file.

**Step 2: Commit**

```bash
git add -A
git commit -s -m "global: remove @tauri-apps dependencies and Tauri references"
```

---

### Task 16: Final Verification

**Step 1: Clean build from scratch**

```bash
# Rebuild all packages
for pkg in packages/logger packages/sodium packages/crypto packages/intl packages/theme packages/streamable-fs packages/common packages/core packages/ui packages/clipper packages/editor; do
  (cd "$pkg" && npm run build)
done

# Build web
cd apps/web && npm run build

# Build desktop
cd apps/web && npm run build:desktop
```

Expected: All builds succeed.

**Step 2: Start Electron desktop app**

```bash
cd apps/desktop && npm start
```

Expected: App opens. Navigate to Dashboard, Terminal, Git Panel, File Explorer. All work.

**Step 3: Start web-only**

```bash
cd apps/web && npm start
```

Expected: App opens in browser. Terminal/Git/File Explorer show web fallbacks. No console errors about Tauri.

**Step 4: Final commit**

```bash
git add -A
git commit -s -m "global: consolidate to Electron-only — Tauri removal complete"
```
