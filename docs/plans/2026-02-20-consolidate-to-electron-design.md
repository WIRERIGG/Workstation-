# Design: Consolidate to Electron-Only Desktop Runtime

**Date:** 2026-02-20
**Status:** Approved
**Decision:** Remove Tauri, keep Electron, port Tauri-only features to Node.js

## Problem

The project maintains two parallel desktop runtimes (Electron + Tauri) with three bridge implementations per capability (Electron tRPC, Tauri invoke, Web stub). This causes:

- Tripled maintenance burden for every native API
- Two separate build systems (esbuild + Cargo)
- 4.6GB Rust target directory
- Broken builds from rebrand mismatches across three code paths
- Confusing dev experience with multiple start commands

## Decision

**Keep Electron. Remove Tauri. Port Tauri-only features to Node.js tRPC routers.**

Approach A was chosen over electron-vite migration (Approach B) and Electron Forge (Approach C) because the existing Electron setup works — tRPC routers, esbuild bundling, and dev script are all proven. The problem was maintaining two runtimes, not the Electron tooling itself.

## What Gets Removed

### Delete Entirely
- `src-tauri/` — all 15 Rust modules, Cargo.toml, tauri.conf.json
- `apps/web/src/common/desktop-bridge/index.tauri.ts` — Tauri invoke bridge
- `apps/web/src/common/sqlite/index.tauri.ts` — Tauri rusqlite bridge

### Simplify
- `apps/web/vite.config.ts` — remove all `isTauri` branches, reduce alias routing from 3-way to 2-way (`desktop` vs `web`)
- Remove `IS_TAURI` global, `PLATFORM=tauri` build mode, `start:tauri`/`build:tauri` scripts from all package.json files
- Remove Tauri-specific fallback logic in views: `git-panel.tsx`, `conversations.tsx`, `workspaces.tsx`, `terminal.tsx`, `file-explorer.tsx`

## New tRPC Routers

Four new routers in `apps/desktop/src/api/`, following the existing pattern:

| Router | Node.js Library | Purpose |
|--------|----------------|---------|
| `ptyRouter` | `node-pty` | Spawn shells, write stdin, resize, stream stdout via tRPC subscription |
| `gitRouter` | `simple-git` | Status, diff, commit, branch, log |
| `filesystemRouter` | Node `fs/promises` + `chokidar` | Read/write/list files, watch directories |
| `highlighterRouter` | `shiki` | Syntax highlight code blocks, return HTML |

Each router is registered in the main `appRouter` (`apps/desktop/src/api/index.ts`) and consumed from the web app via the existing `desktop-bridge/index.desktop.ts` tRPC client.

## Vite Config Simplification

### Before (3-way)
```
isTauri   -> index.tauri.ts
isDesktop -> index.desktop.ts
else      -> index.ts (web stub)
```

### After (2-way)
```
isDesktop -> index.desktop.ts
else      -> index.ts (web stub)
```

### Platform Globals
- **Keep:** `IS_DESKTOP_APP`, `PLATFORM` ("web" | "desktop")
- **Remove:** `IS_TAURI`

### Build Scripts
- **Keep:** `start` (web), `start:desktop` (Electron), `build` (web), `build:desktop` (Electron)
- **Remove:** `start:tauri`, `build:tauri`

## Migration Order

1. **Add Node.js routers** — pty, git, filesystem, highlighter. Test in Electron.
2. **Update frontend views** — wire terminal/git/file-explorer to tRPC instead of Tauri invoke.
3. **Remove Tauri code** — delete `src-tauri/`, Tauri bridge files, Vite config branches.
4. **Clean up** — remove all `IS_TAURI` references, simplify platform detection across codebase.

This order ensures features work in Electron before cutting the Tauri lifeline.

## What Stays the Same

- **Workstation MVP modules** — Dashboard, Agents, Tasks, Calendar, Communications, Spreadsheets (pure web, no native deps)
- **Core packages** — core, editor, crypto, common, etc. (untouched)
- **tRPC architecture** — proven pattern, just gets 4 more routers
- **Existing Electron routers** — compression, safe-storage, window, updater, os-integration, spell-checker, workstation-data, sql-parser (untouched)
- **Web-only mode** — still works in browser with stubs, no native features

## New Dependencies

Added to `apps/desktop/package.json`:
- `node-pty` — terminal emulation
- `simple-git` — Git operations
- `chokidar` — filesystem watching (Node `fs/promises` for read/write)
- `shiki` — syntax highlighting
