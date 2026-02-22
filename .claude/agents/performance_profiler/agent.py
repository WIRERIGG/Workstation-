"""
Performance Profiler Agent — Node.js runtime and memory profiling for Notesnook.

Adapted from RIGGWIRE-EA-LIVE valgrind_pydantic_tool/agent.py.
Refactored from Valgrind C++ memory analysis to Node.js/V8 profiling.

Tools:
- check_memory_patterns: Static analysis for common memory leak patterns
- analyze_event_listeners: Find potential event listener leaks
- check_unbounded_caches: Find caches without size limits
- find_heavy_computations: Detect expensive operations in hot paths
- analyze_react_renders: Static analysis for render performance
"""

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional
import re

from pydantic_ai import Agent, RunContext

logger = logging.getLogger(__name__)


@dataclass
class ProfilerDeps:
    """Dependencies for Performance Profiler Agent."""
    project_root: str = "."
    target_package: str = "core"
    session_id: Optional[str] = None


SYSTEM_PROMPT = """You are a performance profiling specialist for the Notesnook monorepo.

Your focus areas:
1. Memory: Leak detection, unbounded growth, closure retention
2. CPU: Hot paths, expensive computations, blocking operations
3. React: Unnecessary re-renders, missing memoization, large component trees
4. I/O: Database query optimization, network request batching

Notesnook performance considerations:
- Encryption/decryption in packages/crypto is CPU-intensive — must be efficient
- Editor (TipTap) rendering must be smooth for large documents
- Sync operations should not block the UI thread
- SQLite operations in packages/core must be optimized
- Mobile (React Native) has stricter performance requirements

Analysis methodology:
1. Static analysis for common anti-patterns
2. Identify potential runtime issues from code patterns
3. Recommend profiling tools for runtime verification
4. Suggest targeted optimizations

Always provide:
- File path and line number
- Estimated impact (low, medium, high)
- Specific fix recommendation
"""

profiler_agent = Agent(
    "anthropic:claude-sonnet-4-5-20250929",
    deps_type=ProfilerDeps,
    system_prompt=SYSTEM_PROMPT
)


@profiler_agent.tool
async def check_memory_patterns(
    ctx: RunContext[ProfilerDeps],
    package_path: str = "packages/core"
) -> str:
    """Check for common memory leak patterns in TypeScript code."""
    target = Path(ctx.deps.project_root) / package_path
    if not target.exists():
        return f"Path not found: {package_path}"

    findings = []

    for ts_file in target.rglob("*.ts"):
        code = ts_file.read_text(encoding="utf-8", errors="ignore")
        rel_path = str(ts_file.relative_to(ctx.deps.project_root))

        # Unbounded array push without clear
        if ".push(" in code and "length = 0" not in code and ".splice(" not in code:
            arrays_pushed = len(re.findall(r'\.\s*push\s*\(', code))
            if arrays_pushed > 3:
                findings.append(f"  {rel_path}: {arrays_pushed} array push() calls — check for unbounded growth")

        # setInterval without clearInterval
        if "setInterval(" in code and "clearInterval" not in code:
            findings.append(f"  {rel_path}: setInterval without clearInterval — potential leak")

        # addEventListener without removeEventListener
        if "addEventListener(" in code and "removeEventListener" not in code:
            findings.append(f"  {rel_path}: addEventListener without removeEventListener")

        # Large Map/Set without eviction
        if re.search(r'new\s+(Map|Set)\s*\(\)', code):
            if "delete(" not in code and ".clear()" not in code:
                findings.append(f"  {rel_path}: Map/Set without delete/clear — check for unbounded growth")

    summary = f"Memory pattern analysis: {package_path}\n"
    if findings:
        summary += f"Found {len(findings)} potential issues:\n" + "\n".join(findings[:20])
    else:
        summary += "No common memory leak patterns detected."

    return summary


@profiler_agent.tool
async def find_heavy_computations(
    ctx: RunContext[ProfilerDeps],
    package_path: str = "packages/core"
) -> str:
    """Detect potentially expensive operations in hot paths."""
    target = Path(ctx.deps.project_root) / package_path
    if not target.exists():
        return f"Path not found: {package_path}"

    findings = []

    for ts_file in target.rglob("*.ts"):
        code = ts_file.read_text(encoding="utf-8", errors="ignore")
        rel_path = str(ts_file.relative_to(ctx.deps.project_root))
        lines = code.split("\n")

        # Nested loops (O(n^2) or worse)
        for i, line in enumerate(lines, 1):
            if re.search(r'\bfor\s*\(', line) or re.search(r'\.forEach\s*\(', line):
                # Check next few lines for nested loop
                next_lines = "\n".join(lines[i:min(i+10, len(lines))])
                if re.search(r'\bfor\s*\(', next_lines) or re.search(r'\.forEach\s*\(', next_lines):
                    findings.append(f"  {rel_path}:{i}: Nested iteration — potential O(n^2)")

        # JSON.parse/stringify in loops
        for i, line in enumerate(lines, 1):
            if ("JSON.parse" in line or "JSON.stringify" in line):
                # Check if inside a loop
                context = "\n".join(lines[max(0, i-5):i])
                if re.search(r'\bfor\s*\(|\.forEach\(|\.map\(|\.reduce\(', context):
                    findings.append(f"  {rel_path}:{i}: JSON.parse/stringify inside loop — expensive")

        # Regex compilation inside loops
        for i, line in enumerate(lines, 1):
            if "new RegExp(" in line:
                context = "\n".join(lines[max(0, i-5):i])
                if re.search(r'\bfor\s*\(|\.forEach\(|\.map\(', context):
                    findings.append(f"  {rel_path}:{i}: RegExp construction inside loop — compile once outside")

    summary = f"Heavy computation analysis: {package_path}\n"
    if findings:
        summary += f"Found {len(findings)} potential hotspots:\n" + "\n".join(findings[:20])
    else:
        summary += "No obvious heavy computation patterns detected."

    return summary


@profiler_agent.tool
async def analyze_react_renders(
    ctx: RunContext[ProfilerDeps],
    component_path: str = "packages/ui/src"
) -> str:
    """Static analysis for React render performance issues."""
    target = Path(ctx.deps.project_root) / component_path
    if not target.exists():
        return f"Path not found: {component_path}"

    findings = []

    for tsx_file in target.rglob("*.tsx"):
        code = tsx_file.read_text(encoding="utf-8", errors="ignore")
        rel_path = str(tsx_file.relative_to(ctx.deps.project_root))

        # Object/array literals in JSX (new reference each render)
        inline_objects = len(re.findall(r'=\{\{', code))
        if inline_objects > 3:
            findings.append(f"  {rel_path}: {inline_objects} inline object literals in JSX — causes re-renders")

        # Inline arrow functions in JSX
        inline_arrows = len(re.findall(r'on\w+=\{[^}]*=>', code))
        if inline_arrows > 3:
            findings.append(f"  {rel_path}: {inline_arrows} inline arrow functions — extract with useCallback")

        # Component without memo
        if re.search(r'export\s+(default\s+)?function\s+\w+', code):
            if "memo(" not in code and "React.memo" not in code:
                # Only flag if component has props
                if re.search(r'function\s+\w+\s*\(\s*\{', code) or re.search(r'function\s+\w+\s*\(\s*props', code):
                    findings.append(f"  {rel_path}: Component with props but not wrapped in memo()")

        # Large useEffect dependencies
        effects = re.findall(r'useEffect\([^)]*,\s*\[([^\]]*)\]', code, re.DOTALL)
        for i, deps in enumerate(effects):
            dep_count = len([d for d in deps.split(",") if d.strip()])
            if dep_count > 5:
                findings.append(f"  {rel_path}: useEffect with {dep_count} deps — consider splitting")

    summary = f"React render analysis: {component_path}\n"
    if findings:
        summary += f"Found {len(findings)} render performance issues:\n" + "\n".join(findings[:20])
    else:
        summary += "No render performance issues detected."

    return summary


# --- Public API ---

async def profile_performance(
    description: str,
    project_root: str = ".",
    target_package: str = "core"
) -> str:
    """Run performance profiling analysis."""
    deps = ProfilerDeps(project_root=project_root, target_package=target_package)
    result = await profiler_agent.run(description, deps=deps)
    return result.data
