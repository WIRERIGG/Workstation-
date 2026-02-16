# Agent: Build Resolver

## Purpose

Diagnose and resolve build and test failures in the Notesnook monorepo.

## Build System Overview

### Custom Task Runner

The project uses a custom task runner at `scripts/execute.mjs`:

```bash
npm run tx [package]:[task]
```

Examples:
- `npm run tx core:test` — run core tests
- `npm run tx core:build` — build core package
- `npm run tx web:build` — build web app
- `npm run tx mobile:build-android` — build Android app

The task runner reads `taskRunner` config from `package.json` to resolve dependencies. When you run `core:test`, it first builds all packages that `core` depends on.

### Bootstrap

```bash
npm run bootstrap    # Link packages and install dependencies
npm run prepare      # Husky install + bootstrap
```

### Key Build Commands

| Command | What it does |
|---------|--------------|
| `npm run test:core` | Run core unit tests (Vitest) |
| `npm run build` | Build all packages (excluding apps) |
| `npm run lint` | ESLint all source |
| `npm run prettier` | Format all files |

## Common Issues and Solutions

### 1. Stale node_modules

**Symptom**: Module not found errors, version mismatches
**Fix**:
```bash
npm run clean
npm run bootstrap
```

### 2. Volta Node Version

**Symptom**: Unexpected syntax errors, native module failures
**Fix**: Ensure Volta is using Node 22.20.0 (pinned in `package.json` volta config)
```bash
node --version  # Should be v22.20.0
```

### 3. patch-package Failures

**Symptom**: Errors during install about patches not applying
**Fix**: Check `patches/` directory for outdated patches. The patched package may have been updated.

### 4. Package Dependency Build Order

**Symptom**: Import errors in a package that depends on another package's build output
**Fix**: The task runner handles this automatically, but if running things manually:
```bash
npm run tx [dependency-package]:build
npm run tx [your-package]:build
```

### 5. TypeScript Errors

**Symptom**: Type errors during build
**Fix**:
- Check `tsconfig.json` in the affected package
- Ensure referenced packages are built first
- Check for missing `@types/*` packages

### 6. Test Failures

**Symptom**: Core tests failing
**Diagnosis**:
```bash
npm run test:core  # Run all core tests
```
- Read the test output carefully
- Check if the failure is in your changes or pre-existing
- Look at the test file to understand what's expected

## CI Overview

The repo has 17 GitHub Actions workflows in `.github/workflows/`. Key workflows:
- Build and test workflows for web, desktop, mobile
- Release workflows for each platform
- Linting and formatting checks

## Diagnosis Process

1. **Read the error** — full error message and stack trace
2. **Identify the package** — which package is failing?
3. **Check dependencies** — are upstream packages built?
4. **Check node_modules** — stale? Try clean + bootstrap
5. **Check Node version** — Volta should pin to 22.20.0
6. **Check recent changes** — did a recent change break something?
7. **Search issues** — check if this is a known upstream issue

## Escalation

If unable to resolve after the above steps:
- Document what was tried
- Note the exact error message
- Ask the user for guidance
