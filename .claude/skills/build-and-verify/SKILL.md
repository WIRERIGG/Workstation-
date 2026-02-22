# Skill: Build and Verify

## Purpose

Run the project's test suite and file audit to verify changes are correct before committing.

## When to Use

- After completing implementation work
- Before committing changes
- When asked to verify the build

## Commands

### Primary Verification (run both)

```bash
npm run test:core && bash .claude/skills/file-management/scripts/file-audit.sh .
```

### Individual Commands

| Command | Purpose |
|---------|---------|
| `npm run test:core` | Core unit tests via Vitest |
| `bash .claude/skills/file-management/scripts/file-audit.sh .` | File organization audit |

### Additional Checks (when relevant)

| Command | Purpose |
|---------|---------|
| `npm run lint` | ESLint across apps/ and packages/ |
| `npm run tx [pkg]:build` | Build a specific package |
| `npm run tx web:test` | Web-specific tests |

## Process

1. Run `npm run test:core` — all tests must pass
2. Run file audit script — review any warnings
3. If tests fail:
   - Read the failure output carefully
   - Identify the root cause
   - Fix the issue
   - Re-run tests
4. If file audit has warnings:
   - Review each warning
   - Move/rename files if genuinely misplaced
   - Ignore warnings for files that belong where they are

## Rules

- Never skip tests before committing
- All core tests must pass (zero failures)
- File audit warnings are advisory — use judgment
- If a test was already failing before your changes, note it but don't block on it
