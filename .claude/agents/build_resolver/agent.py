"""
Build Resolver Agent — Intelligent build error resolution for Notesnook.

Adapted from RIGGWIRE-EA-LIVE never_fail_build_resolver/agent.py.
Refactored from CMake/GTest to npm/Yarn/Vite/Vitest.

Escalation strategy:
- FAST tier: Clear caches, reinstall node_modules
- SMART tier: Analyze error patterns, targeted fixes
- THOROUGH tier: Deep dependency analysis, patch-package review
- EMERGENCY tier: Full clean + bootstrap + rebuild

Tools:
- analyze_build_error: Categorize and diagnose build failures
- execute_build_command: Run build commands with error capture
- resolve_dependency_issue: Fix dependency conflicts
- validate_environment: Check Node, Yarn, Volta versions
- clean_and_rebuild: Nuclear option — full clean rebuild
"""

import asyncio
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from pydantic_ai import Agent, RunContext

from .models import BuildProblem, BuildErrorCategory, EscalationTier

logger = logging.getLogger(__name__)


@dataclass
class BuildResolverDeps:
    """Dependencies for Build Resolver Agent."""
    project_root: str = "."
    current_tier: str = "fast"
    max_retries: int = 3
    session_id: Optional[str] = None


SYSTEM_PROMPT = """You are a build resolution specialist for the Notesnook monorepo.

Build system overview:
- Custom task runner: npm run tx [package]:[task] (scripts/execute.mjs)
- Package manager: Yarn 1.22.22 (via packageManager field)
- Node: 22.20.0 (via Volta)
- Builds: tsup/tsdown for packages, Vite for web/desktop, React Native CLI for mobile
- Tests: Vitest for core, Detox for mobile E2E

Escalation strategy (try in order):
1. FAST: Clear .taskcache, rebuild the specific package
2. SMART: Analyze the error, fix the specific issue
3. THOROUGH: Clean node_modules for the affected package, reinstall, rebuild deps
4. EMERGENCY: Full npm run clean && npm run bootstrap && npm run build

Common issues:
- Stale node_modules → npm run clean && npm run bootstrap
- Volta Node mismatch → Check node --version matches 22.20.0
- patch-package failures → Check patches/ for outdated patches
- Build order → Task runner handles deps, but manual runs need correct order
- TypeScript errors → Check tsconfig.json in affected package

Always explain what went wrong and how the fix works.
"""

build_resolver_agent = Agent(
    "anthropic:claude-sonnet-4-5-20250929",
    deps_type=BuildResolverDeps,
    system_prompt=SYSTEM_PROMPT
)


@build_resolver_agent.tool
async def analyze_build_error(
    ctx: RunContext[BuildResolverDeps],
    error_output: str
) -> str:
    """Categorize and diagnose a build error."""
    error_lower = error_output.lower()

    category = BuildErrorCategory.UNKNOWN
    suggestions = []

    if "module not found" in error_lower or "cannot find module" in error_lower:
        category = BuildErrorCategory.MODULE_NOT_FOUND
        suggestions = [
            "npm run bootstrap",
            "npm run tx [package]:build (build the dependency first)"
        ]
    elif "error ts" in error_lower or "type error" in error_lower:
        category = BuildErrorCategory.TYPE_ERROR
        suggestions = ["Check the TypeScript error and fix the type issue"]
    elif "syntaxerror" in error_lower or "unexpected token" in error_lower:
        category = BuildErrorCategory.SYNTAX_ERROR
        suggestions = ["Check the file for syntax errors"]
    elif "enoent" in error_lower or "permission denied" in error_lower:
        category = BuildErrorCategory.PERMISSION
        suggestions = ["Check file permissions", "Verify the path exists"]
    elif "patch" in error_lower and "fail" in error_lower:
        category = BuildErrorCategory.PATCH_FAILURE
        suggestions = ["Check patches/ directory for outdated patches"]
    elif "heap" in error_lower or "out of memory" in error_lower:
        category = BuildErrorCategory.OUT_OF_MEMORY
        suggestions = ["Increase Node memory: NODE_OPTIONS=--max-old-space-size=4096"]
    elif "volta" in error_lower or "node version" in error_lower:
        category = BuildErrorCategory.VOLTA_NODE
        suggestions = ["Ensure Volta is using Node 22.20.0"]

    result = f"Error Category: {category.value}\n"
    result += f"Suggested Tier: {EscalationTier.FAST.value}\n"
    result += f"Suggestions:\n"
    for s in suggestions:
        result += f"  - {s}\n"

    return result


@build_resolver_agent.tool
async def execute_build_command(
    ctx: RunContext[BuildResolverDeps],
    command: str
) -> str:
    """Execute a build command and capture output."""
    # Safety: only allow known safe commands
    allowed_prefixes = ["npm run", "npx", "node --version", "yarn --version"]
    if not any(command.startswith(p) for p in allowed_prefixes):
        return f"Command not allowed: {command}. Only npm/npx/node/yarn commands permitted."

    proc = subprocess.run(
        command, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=300
    )

    status = "SUCCESS" if proc.returncode == 0 else f"FAILED (exit code {proc.returncode})"
    output = proc.stdout[-1500:] if proc.stdout else ""
    errors = proc.stderr[-500:] if proc.stderr else ""

    return f"Command: {command}\nStatus: {status}\n\nOutput:\n{output}\n\nErrors:\n{errors}"


@build_resolver_agent.tool
async def validate_environment(ctx: RunContext[BuildResolverDeps]) -> str:
    """Validate the build environment."""
    checks = []

    # Node version
    proc = subprocess.run("node --version", shell=True, capture_output=True, text=True,
                          cwd=ctx.deps.project_root)
    node_version = proc.stdout.strip()
    expected = "v22.20.0"
    checks.append(f"Node: {node_version} {'OK' if expected in node_version else f'MISMATCH (expected {expected})'}")

    # Yarn version
    proc = subprocess.run("yarn --version", shell=True, capture_output=True, text=True,
                          cwd=ctx.deps.project_root)
    yarn_version = proc.stdout.strip()
    checks.append(f"Yarn: {yarn_version}")

    # Check node_modules exists
    nm_exists = (Path(ctx.deps.project_root) / "node_modules").exists()
    checks.append(f"node_modules: {'exists' if nm_exists else 'MISSING — run npm run bootstrap'}")

    # Check .taskcache
    tc_exists = (Path(ctx.deps.project_root) / ".taskcache").exists()
    checks.append(f".taskcache: {'exists' if tc_exists else 'not present (clean state)'}")

    return "Environment Validation:\n" + "\n".join(f"  {c}" for c in checks)


@build_resolver_agent.tool
async def clean_and_rebuild(ctx: RunContext[BuildResolverDeps]) -> str:
    """Emergency: full clean and rebuild (THOROUGH tier)."""
    steps = [
        ("Clean", "npm run clean"),
        ("Bootstrap", "npm run bootstrap"),
        ("Build", "npm run build"),
    ]

    results = []
    for step_name, cmd in steps:
        proc = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            cwd=ctx.deps.project_root, timeout=600
        )
        status = "OK" if proc.returncode == 0 else "FAILED"
        results.append(f"  {step_name}: {status}")
        if proc.returncode != 0:
            results.append(f"    Error: {proc.stderr[-300:]}")
            break

    return "Clean & Rebuild:\n" + "\n".join(results)


# --- Public API ---

async def resolve_build(
    error_description: str,
    project_root: str = "."
) -> str:
    """Attempt to resolve a build issue."""
    deps = BuildResolverDeps(project_root=project_root)
    result = await build_resolver_agent.run(error_description, deps=deps)
    return result.data
