# CLAUDE.md — Notesnook Fork

## Project Overview

Personal fork of [Notesnook](https://github.com/streetwriters/notesnook) — an end-to-end encrypted note-taking application. TypeScript/React monorepo with 20 packages across apps, packages, extensions, and servers.

## Session Start

```bash
git log --oneline -10
git status
```

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run test:core` | Run core unit tests (Vitest) — **primary verification** |
| `npm run tx [pkg]:[task]` | Custom task runner (scripts/execute.mjs) |
| `npm run bootstrap` | Bootstrap all packages |
| `npm run prepare` | Husky install + bootstrap |
| `npm run lint` | ESLint across apps/ and packages/ |
| `npm run prettier` | Format all files |

## Project Structure

```
apps/
  desktop/          # Electron desktop app
  mobile/           # React Native mobile app
  monograph/        # Public note sharing app
  theme-builder/    # Theme creation tool
  vericrypt/        # Encryption verification tool
  web/              # React web app
packages/
  clipper/          # Web clipper shared logic
  common/           # Shared utilities
  core/             # Business logic + database (primary test target)
  crypto/           # E2E encryption implementation
  editor/           # Rich text editor (TipTap-based)
  editor-mobile/    # Mobile editor variant
  intl/             # Internationalization
  logger/           # Logging utilities
  sodium/           # libsodium crypto bindings
  streamable-fs/    # Streaming file system
  theme/            # Theme engine
  ui/               # Shared React UI components
extensions/
  web-clipper/      # Browser extension
servers/
  themes/           # Theme distribution server
scripts/            # Build tooling (execute.mjs, bootstrap.mjs, etc.)
docs/
  help/             # User-facing app documentation (do not reorganize)
  architecture/     # System architecture docs
  specs/            # Project specifications
  guides/           # Development guides
  decisions/        # Architecture decision records
  planning/         # Planning documents
  changelogs/       # Session changelogs
  references/       # Reference materials
```

## Rules

1. **TypeScript only** — write `.ts`/`.tsx`, never plain `.js`/`.jsx` for new code
2. **All core tests must pass** — run `npm run test:core` before committing
3. **File organization** — follow monorepo structure; new code goes in the appropriate package
4. **No secrets** — never commit `.env`, credentials, or API keys
5. **Existing docs/help/** — app documentation, exempt from reorganization
6. **Package manager** — Yarn 1.22.22 (via packageManager field), Node 22.20.0 (via Volta)

## Skills

| Skill | Path | Purpose |
|-------|------|---------|
| refine-task | `.claude/skills/refine-task/` | Break down tasks into actionable steps |
| build-and-verify | `.claude/skills/build-and-verify/` | Run tests + file audit |
| commit-changes | `.claude/skills/commit-changes/` | Stage and commit with project conventions |
| file-management | `.claude/skills/file-management/` | File organization and audit |

## Agents

### Reference Guides (Markdown)

| Agent | Path | Purpose |
|-------|------|---------|
| orchestrator | `.claude/agents/orchestrator.md` | Multi-step task coordination |
| build-resolver | `.claude/agents/build-resolver.md` | Build failure diagnosis and resolution |

### Pydantic AI Agents (Python)

| Agent | Path | Purpose |
|-------|------|---------|
| awareness_orchestrator | `.claude/agents/awareness_orchestrator/` | Coordinates all specialized agents |
| typescript_code_agent | `.claude/agents/typescript_code_agent/` | Deep TS/React code analysis |
| eslint_ai_agent | `.claude/agents/eslint_ai_agent/` | ESLint compliance with AI fixes |
| core_reliability_agent | `.claude/agents/core_reliability_agent/` | Encryption correctness, data integrity |
| build_resolver | `.claude/agents/build_resolver/` | Build error resolution with escalation |
| bundle_optimizer | `.claude/agents/bundle_optimizer/` | Bundle size and code splitting |
| debug_system | `.claude/agents/debug_system/` | Node.js/React debugging |
| performance_profiler | `.claude/agents/performance_profiler/` | Runtime and memory profiling |

Shared infrastructure:
- `agent_factory_template.py` — Factory pattern with validation for all agents
- `shared_integration.py` — ESLint + Bundle Optimizer pipeline integration

Reference use-cases: `use-cases/` (Pydantic AI examples, agent factory patterns)

## Commit Convention

Format: `scope: description`

Examples from this repo:
- `mobile: fix toast context in color picker`
- `core: remove .only from note history tests`
- `ci: update build tools version`
- `editor: update test snapshots`

Common scopes: `core`, `mobile`, `web`, `desktop`, `editor`, `ci`, `setup`, `docs`, `misc`, `global`

**Important:** Always use `git commit -s` to add DCO sign-off (required by commitlint). `chore` is NOT a valid scope — use `setup`, `config`, or `misc` instead.

## Key Architecture Notes

- **Zero-knowledge encryption**: all note content encrypted client-side via packages/crypto + packages/sodium
- **Shared core**: packages/core contains business logic consumed by all app targets
- **Custom task runner**: `npm run tx` resolves package dependencies and runs tasks in order
- **Rich text editor**: TipTap-based editor in packages/editor, with mobile variant
