# Notesnook Architecture

## System Overview

Notesnook is an end-to-end encrypted note-taking application available on all major platforms. The codebase is a TypeScript monorepo containing 6 apps, 12 shared packages, 1 browser extension, and 1 server.

## High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                   Applications                   │
│  ┌─────┐ ┌──────┐ ┌───────┐ ┌─────┐ ┌───────┐  │
│  │ Web │ │Mobile│ │Desktop│ │Mono-│ │Veri-  │  │
│  │     │ │      │ │       │ │graph│ │crypt  │  │
│  └──┬──┘ └──┬───┘ └──┬────┘ └──┬──┘ └──┬────┘  │
│     │       │        │         │       │        │
│  ┌──┴───────┴────────┴─────────┴───────┴─────┐  │
│  │              packages/ui                   │  │
│  └──────────────────┬────────────────────────┘  │
│                     │                            │
│  ┌──────────────────┴────────────────────────┐  │
│  │             packages/editor                │  │
│  └──────────────────┬────────────────────────┘  │
│                     │                            │
│  ┌──────────────────┴────────────────────────┐  │
│  │              packages/core                 │  │
│  │    (business logic, database, models)      │  │
│  └──────────────────┬────────────────────────┘  │
│                     │                            │
│  ┌──────────────────┴────────────────────────┐  │
│  │            packages/crypto                 │  │
│  │      (E2E encryption, zero-knowledge)      │  │
│  └──────────────────┬────────────────────────┘  │
│                     │                            │
│  ┌──────────────────┴────────────────────────┐  │
│  │            packages/sodium                 │  │
│  │         (libsodium crypto bindings)        │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Key Components

### packages/core

The heart of Notesnook. Contains:
- **Database layer**: Note storage, indexing, and queries
- **Business logic**: Note operations, notebook management, tags, favorites
- **Sync engine**: Encrypted data synchronization
- **Models**: Data types for notes, notebooks, attachments, etc.

This is the primary test target (`npm run test:core`).

### packages/editor

Rich text editor built on TipTap (ProseMirror). Supports:
- Markdown-like editing
- Tables, checklists, code blocks
- Image and attachment embedding
- Mobile variant in `packages/editor-mobile`

### packages/crypto

End-to-end encryption implementation:
- Zero-knowledge architecture (server never sees plaintext)
- Key derivation and management
- Encryption/decryption of note content and attachments
- Built on `packages/sodium` (libsodium bindings)

### packages/ui

Shared React component library used by all web-based apps (web, desktop, theme-builder). Contains:
- Common UI components (dialogs, menus, buttons)
- Theme-aware styling
- Layout components

### packages/common

Shared utilities used across packages:
- Date formatting
- String utilities
- Platform detection

## Platform Strategy

| Platform | Technology | Package |
|----------|-----------|---------|
| Web | React + Vite | `apps/web` |
| Desktop | Electron + React | `apps/desktop` |
| Mobile | React Native | `apps/mobile` |
| Browser Extension | Web Extension API | `extensions/web-clipper` |

All platforms share `packages/core` for business logic and `packages/crypto` for encryption. Platform-specific code lives in the respective `apps/` directory.

## Build System

### Custom Task Runner

`npm run tx` (`scripts/execute.mjs`) is a custom task runner that:
1. Reads `taskRunner` config from root `package.json`
2. Resolves package dependency graph
3. Builds dependencies first, then the target package
4. Runs the specified task (build, test, start, etc.)

### Build Tools

- **Vite**: Web and desktop app bundling
- **React Native CLI**: Mobile app building
- **tsup/tsdown**: Package building
- **Vitest**: Core unit testing

### Dependency Management

- **Yarn 1.22.22**: Package manager (via `packageManager` field)
- **Volta**: Node version management (pins Node 22.20.0)
- **patch-package**: Patches for upstream dependencies
- **Husky**: Git hooks (pre-commit linting)
- **commitlint**: Commit message format enforcement

## Data Flow

```
User Input → Editor → Core (encrypt via Crypto) → Sync → Server
Server → Sync → Core (decrypt via Crypto) → Editor → Display
```

All encryption/decryption happens client-side. The server only stores encrypted blobs.
