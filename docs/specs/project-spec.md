# Project Specification — Notesnook Fork

## Product

Notesnook is an end-to-end encrypted note-taking application that runs on all major platforms (web, desktop, mobile, browser extension). The core differentiator is zero-knowledge encryption — note content is encrypted client-side and the server never has access to plaintext data.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (monorepo) |
| Web Framework | React |
| Mobile Framework | React Native |
| Desktop Framework | Electron |
| Editor | TipTap (ProseMirror) |
| Encryption | libsodium (via packages/sodium) |
| Testing | Vitest (core), Detox (mobile E2E) |
| Build | Custom task runner, Vite, tsup/tsdown |
| Package Manager | Yarn 1.22.22 |
| Node | 22.20.0 (Volta) |
| CI | GitHub Actions (17 workflows) |

## Monorepo Structure

- **6 apps**: web, mobile, desktop, monograph, theme-builder, vericrypt
- **12 packages**: core, editor, editor-mobile, crypto, sodium, common, ui, theme, intl, logger, clipper, streamable-fs
- **1 extension**: web-clipper
- **1 server**: themes

## Quality Goals

1. **All core tests pass** — `npm run test:core` must exit cleanly
2. **Linting clean** — `npm run lint` with no errors
3. **Type-safe** — TypeScript strict mode, no `any` escape hatches in new code
4. **Encrypted by default** — all user data encrypted before leaving the client
5. **Cross-platform parity** — core features available on all platforms

## Development Workflow

1. Make changes in the appropriate package
2. Run `npm run test:core` to verify
3. Commit with `scope: description` format
4. CI validates on push

## Fork Context

This is a personal fork of the upstream [Notesnook](https://github.com/streetwriters/notesnook) repository maintained by Streetwriters. The fork is used for personal development, experimentation, and contributions back to upstream.
