"""
Debug System Agent — Coordinated Node.js/React debugging for Notesnook.

Adapted from RIGGWIRE-EA-LIVE multi_agent_debugging_system/agent.py.
Refactored from GDB/Valgrind/Strace to Node.js/React debugging tools.

Tools:
- analyze_error: Parse and analyze runtime errors
- trace_stack: Deep stack trace analysis
- check_react_renders: Detect unnecessary re-renders
- profile_test_performance: Profile slow tests
- search_for_pattern: Search codebase for error-related patterns
"""

import asyncio
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional
import re

from pydantic_ai import Agent, RunContext

logger = logging.getLogger(__name__)


@dataclass
class DebugDeps:
    """Dependencies for Debug System Agent."""
    project_root: str = "."
    debug_mode: str = "crash"
    target_package: str = "core"
    session_id: Optional[str] = None


SYSTEM_PROMPT = """You are a debugging specialist for the Notesnook TypeScript/React monorepo.

Your debugging toolkit:
1. Error Analysis: Parse stack traces, identify root causes
2. Console Tracing: Add strategic console.log for data flow tracing
3. React Profiler: Identify rendering bottlenecks
4. Heap Snapshots: Memory leak detection in Node.js
5. CPU Profiling: Find hot paths in tests and runtime
6. Network Tracing: Debug sync/API issues
7. Source Maps: Map minified errors to source code

Debugging methodology:
1. REPRODUCE: Understand how to trigger the issue
2. ISOLATE: Narrow down to the specific package/module
3. ANALYZE: Use appropriate tools for the error type
4. DIAGNOSE: Identify the root cause
5. FIX: Propose a minimal, targeted fix
6. VERIFY: Confirm the fix resolves the issue

Notesnook-specific concerns:
- Encryption errors may surface as garbled content (check packages/crypto)
- Sync issues often manifest as missing/duplicate notes (check packages/core/src/api/sync)
- Editor crashes usually trace to TipTap extensions (check packages/editor)
- Mobile crashes may be React Native bridge issues (check apps/mobile)
"""

debug_agent = Agent(
    "anthropic:claude-sonnet-4-5-20250929",
    deps_type=DebugDeps,
    system_prompt=SYSTEM_PROMPT
)


@debug_agent.tool
async def analyze_error(
    ctx: RunContext[DebugDeps],
    error_text: str
) -> str:
    """Parse and analyze a runtime error or stack trace."""
    lines = error_text.strip().split("\n")

    # Extract error type and message
    error_type = "Unknown"
    error_message = ""
    stack_frames = []

    for line in lines:
        line = line.strip()

        # Match error type
        type_match = re.match(r'^(\w+Error):\s*(.*)', line)
        if type_match:
            error_type = type_match.group(1)
            error_message = type_match.group(2)
            continue

        # Match stack frame
        frame_match = re.match(r'at\s+(.+)\s+\((.+):(\d+):(\d+)\)', line)
        if frame_match:
            stack_frames.append({
                "function": frame_match.group(1),
                "file": frame_match.group(2),
                "line": frame_match.group(3),
                "column": frame_match.group(4)
            })

    # Determine likely package
    affected_package = "unknown"
    for frame in stack_frames:
        fp = frame["file"]
        if "packages/core" in fp:
            affected_package = "core"
            break
        elif "packages/editor" in fp:
            affected_package = "editor"
            break
        elif "packages/crypto" in fp:
            affected_package = "crypto"
            break
        elif "apps/mobile" in fp:
            affected_package = "mobile"
            break
        elif "apps/web" in fp:
            affected_package = "web"
            break

    result = f"Error Analysis:\n"
    result += f"  Type: {error_type}\n"
    result += f"  Message: {error_message}\n"
    result += f"  Affected Package: {affected_package}\n"
    result += f"  Stack Depth: {len(stack_frames)} frames\n"

    if stack_frames:
        result += f"\n  Top frames:\n"
        for frame in stack_frames[:5]:
            result += f"    {frame['function']} ({frame['file']}:{frame['line']})\n"

    return result


@debug_agent.tool
async def search_for_pattern(
    ctx: RunContext[DebugDeps],
    pattern: str,
    file_glob: str = "**/*.ts"
) -> str:
    """Search the codebase for a pattern related to the issue."""
    cmd = f"grep -rn '{pattern}' --include='{file_glob}' packages/ apps/ 2>/dev/null | head -20"
    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=30
    )

    if not proc.stdout.strip():
        return f"Pattern '{pattern}' not found in {file_glob}"

    matches = proc.stdout.strip().split("\n")
    return f"Found {len(matches)} matches for '{pattern}':\n" + "\n".join(f"  {m}" for m in matches)


@debug_agent.tool
async def check_test_for_issue(
    ctx: RunContext[DebugDeps],
    test_pattern: str
) -> str:
    """Run a specific test pattern to reproduce an issue."""
    cmd = f"npx vitest run --reporter=verbose '{test_pattern}' 2>&1 || true"
    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=f"{ctx.deps.project_root}/packages/{ctx.deps.target_package}",
        timeout=120
    )

    return f"Test results for '{test_pattern}':\n{proc.stdout[-2000:]}"


@debug_agent.tool
async def list_recent_changes(
    ctx: RunContext[DebugDeps],
    package_name: str = "core"
) -> str:
    """List recent git changes in a package (useful for regression hunting)."""
    cmd = f"git log --oneline -10 -- packages/{package_name}/"
    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root
    )

    return f"Recent changes to packages/{package_name}:\n{proc.stdout}" if proc.stdout else "No recent changes found."


# --- Public API ---

async def debug_issue(
    description: str,
    project_root: str = ".",
    mode: str = "crash"
) -> str:
    """Debug an issue."""
    deps = DebugDeps(project_root=project_root, debug_mode=mode)
    result = await debug_agent.run(description, deps=deps)
    return result.data
