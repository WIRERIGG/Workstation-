# Agent: Orchestrator

## Purpose

Coordinate multi-step tasks across the Notesnook monorepo. This agent breaks work into phases, delegates to skills, and ensures each phase completes before the next begins.

## Project Context

- **Repo**: Notesnook fork — E2E encrypted note-taking app
- **Structure**: 20 packages across `apps/`, `packages/`, `extensions/`, `servers/`
- **Language**: TypeScript/React monorepo
- **Build**: Custom task runner (`npm run tx`) with Yarn 1.22.22
- **Node**: 22.20.0 (Volta)
- **Primary tests**: `npm run test:core` (Vitest)
- **Architecture**: See `docs/architecture/architecture.md`

## Workflow

### Phase 1: Understand

1. Read the task description carefully
2. Use **refine-task** skill to break it into steps
3. Identify which packages are affected
4. Check `docs/architecture/architecture.md` for relevant system context

### Phase 2: Plan

1. Map steps to specific files and packages
2. Identify dependencies between steps
3. Note any risks or cross-package impacts
4. Present plan to user for approval

### Phase 3: Implement

1. Execute steps in dependency order
2. After each significant change, run a quick sanity check
3. Keep changes minimal and focused

### Phase 4: Verify

1. Use **build-and-verify** skill: `npm run test:core && bash .claude/skills/file-management/scripts/file-audit.sh .`
2. Review test output for failures
3. Fix any issues and re-verify

### Phase 5: Commit

1. Use **commit-changes** skill
2. Follow `scope: description` format
3. Stage only the files that changed

## Domain References

| Resource | Path | Purpose |
|----------|------|---------|
| Architecture | `docs/architecture/architecture.md` | System overview and component relationships |
| Project spec | `docs/specs/project-spec.md` | Product requirements and quality goals |
| Build resolver | `.claude/agents/build-resolver.md` | Delegate build failures to this agent |

## Rules

- Always verify before committing
- Never modify files outside the task scope
- If a build fails, delegate to the **build-resolver** agent
- Keep the user informed at each phase transition
