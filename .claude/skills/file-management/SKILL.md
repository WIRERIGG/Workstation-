# Skill: File Management

## Purpose

Ensure files are organized correctly within the monorepo structure and follow naming/placement conventions.

## When to Use

- When creating new files
- When the file audit reports warnings
- When reorganizing code

## Monorepo Structure Rules

### Rule 1: Package Boundaries

New code must go in the appropriate package:

| Directory | Contains |
|-----------|----------|
| `apps/web/` | React web application |
| `apps/mobile/` | React Native mobile app |
| `apps/desktop/` | Electron desktop app |
| `apps/monograph/` | Public note sharing |
| `apps/theme-builder/` | Theme creation tool |
| `apps/vericrypt/` | Encryption verification |
| `packages/core/` | Business logic, database, models |
| `packages/editor/` | Rich text editor (TipTap) |
| `packages/editor-mobile/` | Mobile editor variant |
| `packages/crypto/` | E2E encryption |
| `packages/sodium/` | libsodium bindings |
| `packages/common/` | Shared utilities |
| `packages/ui/` | Shared React components |
| `packages/theme/` | Theme engine |
| `packages/intl/` | Internationalization |
| `packages/logger/` | Logging |
| `packages/clipper/` | Web clipper logic |
| `packages/streamable-fs/` | Streaming file system |
| `extensions/web-clipper/` | Browser extension |
| `servers/themes/` | Theme server |
| `scripts/` | Build tooling only |
| `docs/` | Documentation (see Rule 4) |

### Rule 2: No Orphan Files at Root

The repo root should only contain config files (`package.json`, `tsconfig.json`, etc.) and documentation (`README.md`, `CLAUDE.md`, etc.). No source code at root level.

### Rule 3: Documentation Placement

| Path | Content |
|------|---------|
| `docs/help/` | **User-facing app docs — DO NOT reorganize** |
| `docs/architecture/` | System architecture |
| `docs/specs/` | Project specifications |
| `docs/guides/` | Development guides |
| `docs/decisions/` | Architecture decision records |
| `docs/planning/` | Planning documents |
| `docs/changelogs/` | Session changelogs |
| `docs/references/` | Reference materials |

### Rule 4: File Extensions

| Extension | Usage |
|-----------|-------|
| `.ts` | TypeScript source |
| `.tsx` | TypeScript + JSX (React components) |
| `.mts` | TypeScript ES module |
| `.d.ts` | TypeScript declarations |
| `.js` | Legacy JavaScript (avoid for new code) |
| `.jsx` | Legacy JSX (avoid for new code) |
| `.mjs` | JavaScript ES module (scripts only) |
| `.json` | Configuration, data |
| `.md` | Documentation |
| `.sh` | Shell scripts |

### Rule 5: Same-Family Files

Related files should live together. Same-family sets:
- TypeScript: `.ts`, `.tsx`, `.d.ts`, `.mts`, `.cts`
- JavaScript: `.js`, `.jsx`, `.mjs`, `.cjs`

A `.ts` file and its `.d.ts` declaration should be in the same directory.

## File Audit

Run the audit script to check for organizational issues:

```bash
bash .claude/skills/file-management/scripts/file-audit.sh .
```

### Exempt Paths

The following paths are exempt from audit warnings:
- `docs/help/` — user-facing app documentation
- `__fixtures__/` — test fixtures
- `__mocks__/` — test mocks
- `_include/` — template includes

## Reference

See `.claude/skills/file-management/references/project-rules-template.md` for the full rules template.
