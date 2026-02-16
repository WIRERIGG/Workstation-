# Skill: Refine Task

## Purpose

Break down a user request into clear, actionable implementation steps before writing any code.

## When to Use

- At the start of any non-trivial task
- When a request is ambiguous or has multiple possible approaches
- Before making changes that touch multiple files or packages

## Process

1. **Understand the request** — Restate what the user wants in your own words
2. **Identify scope** — Which packages/apps are affected?
3. **Check existing patterns** — How does the codebase already handle similar cases?
4. **List concrete steps** — Number each step; each should be independently verifiable
5. **Flag risks** — Note anything that could break tests or affect other packages
6. **Confirm with user** — Present the plan and wait for approval before proceeding

## Output Format

```
## Task: [brief description]

### Scope
- Packages affected: [list]
- Files likely changed: [list]

### Steps
1. [step]
2. [step]
...

### Risks
- [risk or "None identified"]
```

## Rules

- Never start coding before the plan is approved
- Keep steps small enough to verify individually
- Reference specific files and line numbers where possible
- If a step requires research, say so explicitly
