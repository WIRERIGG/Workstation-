# Skill: Commit Changes

## Purpose

Stage and commit changes following the project's commit conventions.

## When to Use

- After changes have been verified (tests pass, file audit clean)
- When the user asks to commit

## Commit Message Format

This project uses `scope: description` format:

```
scope: short description of what changed
```

### Scopes

| Scope | When to use |
|-------|-------------|
| `core` | packages/core changes |
| `editor` | packages/editor or editor-mobile changes |
| `crypto` | packages/crypto or sodium changes |
| `mobile` | apps/mobile changes |
| `web` | apps/web changes |
| `desktop` | apps/desktop changes |
| `ui` | packages/ui changes |
| `theme` | packages/theme or theme-builder changes |
| `ci` | GitHub Actions / CI changes |
| `docs` | Documentation changes |
| `setup` | Tooling, config, project setup |
| `config` | Configuration file changes |
| `misc` | Miscellaneous changes |
| `common` | packages/common changes |
| `global` | Cross-cutting changes across many packages |
| `refactor` | Code refactoring |
| `fs` | packages/streamable-fs changes |
| `clipper` | packages/clipper changes |
| `server` | servers/ changes |
| `logger` | packages/logger changes |
| `intl` | packages/intl changes |
| `themebuilder` | apps/theme-builder changes |
| `webclipper` | extensions/web-clipper changes |
| `vericrypt` | apps/vericrypt changes |
| `monograph` | apps/monograph changes |

### Examples (from git log)

```
mobile: fix toast context in color picker
core: remove .only from note history tests
ci: update build tools version
editor: update test snapshots
setup: apply Claude Workflow Standard
```

## Process

1. Run `git status` to see what changed
2. Run `git diff` to review changes
3. Stage specific files — **never use `git add -A` or `git add .`**
4. Choose the appropriate scope based on what changed
5. Write a concise description (imperative mood, lowercase)
6. Commit with the format above

## Rules

- **Never `git add -A`** — always stage specific files
- **Never commit `.env` files** or credentials
- **Never amend** unless explicitly asked
- **Never force push** unless explicitly asked
- Run tests before committing (use build-and-verify skill)
- The repo uses Husky + commitlint — commits must pass hooks
- **Always use `git commit -s`** to add DCO sign-off (required — user email is not in AUTHORS file)
- If a pre-commit hook fails, fix the issue and create a **new** commit (don't amend)

## Multi-Scope Changes

If changes span multiple scopes, use the most significant scope or `global` for cross-cutting changes.

**Note:** `chore` is NOT a valid commitlint scope in this project. Use `setup`, `config`, `misc`, or `global` instead.
