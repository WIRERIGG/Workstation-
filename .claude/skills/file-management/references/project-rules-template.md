# Project File Organization Rules

## Rule 1: Monorepo Package Boundaries

Every source file belongs in a specific package. The monorepo is organized as:

- `apps/` — Application targets (web, mobile, desktop, etc.)
- `packages/` — Shared libraries consumed by apps
- `extensions/` — Browser extensions
- `servers/` — Backend services
- `scripts/` — Build tooling (`.mjs` files only)
- `docs/` — Documentation

New source code must go in the appropriate package. If unsure, prefer `packages/common/` for shared utilities.

## Rule 2: No Source Files at Root

The repo root is for configuration only. Source files (`.ts`, `.tsx`, `.js`, `.jsx`) do not belong at the root level.

Allowed at root: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `.eslintrc.*`, `CLAUDE.md`, `README.md`, `LICENSE`, etc.

## Rule 3: TypeScript Over JavaScript

- New code: `.ts` / `.tsx`
- Build scripts: `.mjs` (already established convention in `scripts/`)
- Never create new `.js` / `.jsx` files for application or library code

## Rule 4: Same-Family Colocation

Related files stay together:
- A component and its types live in the same directory
- A module and its `.d.ts` declaration live together
- Tests live near their source (e.g., `__tests__/` within the package)

## Rule 5: Documentation Structure

| Path | Purpose | Notes |
|------|---------|-------|
| `docs/help/` | User-facing app docs | **Exempt from reorg** |
| `docs/architecture/` | System architecture | |
| `docs/specs/` | Specifications | |
| `docs/guides/` | Dev guides | |
| `docs/decisions/` | ADRs | |
| `docs/planning/` | Planning docs | |
| `docs/changelogs/` | Session logs | |
| `docs/references/` | Reference material | |

## Rule 6: No Secrets

Never commit:
- `.env` files
- API keys or tokens
- Credentials of any kind
- Private keys

## Rule 7: Naming Conventions

- Files: `kebab-case.ts` (following existing project convention)
- React components: `PascalCase.tsx` (following existing convention)
- Directories: `kebab-case/`
- Constants: `UPPER_SNAKE_CASE`
