"""
ESLint AI Agent — Lint compliance with AI-powered fix recommendations.

Adapted from RIGGWIRE-EA-LIVE clang_tidy_ai_agent/agent.py.
Refactored from Clang-Tidy C++ to ESLint TypeScript/React.

Tools:
- discover_lint_issues: Run ESLint and parse results
- suggest_fix: AI-powered fix suggestions for complex issues
- apply_auto_fixes: Run ESLint --fix for auto-fixable issues
- analyze_rule_patterns: Find most common rule violations
"""

import asyncio
import json
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Any, Optional

from pydantic_ai import Agent, RunContext

from .models import ESLintIssue, ESLintSeverity, ESLintAnalysisResult

logger = logging.getLogger(__name__)


@dataclass
class ESLintAgentDeps:
    """Dependencies for ESLint AI Agent."""
    project_root: str = "."
    target_paths: List[str] = field(default_factory=lambda: ["./apps/", "./packages/"])
    fix_mode: bool = False
    session_id: Optional[str] = None


SYSTEM_PROMPT = """You are an ESLint specialist for the Notesnook TypeScript/React monorepo.

Your capabilities:
1. Discover and categorize ESLint issues across the codebase
2. Suggest intelligent fixes for complex lint issues that --fix can't handle
3. Apply auto-fixes safely
4. Analyze rule violation patterns to identify systemic issues

Notesnook lint setup:
- ESLint with TypeScript parser (@typescript-eslint)
- React and React Hooks plugins
- Unused imports plugin
- License header plugin
- Config: .eslintrc.js at root

When suggesting fixes:
- Preserve existing functionality
- Maintain type safety
- Consider React rendering implications
- Never introduce new lint errors
"""


eslint_agent = Agent(
    "anthropic:claude-sonnet-4-5-20250929",
    deps_type=ESLintAgentDeps,
    system_prompt=SYSTEM_PROMPT
)


@eslint_agent.tool
async def discover_lint_issues(
    ctx: RunContext[ESLintAgentDeps],
    target: str = "./apps/ ./packages/"
) -> str:
    """Run ESLint and discover all issues."""
    cmd = f"npx eslint {target} --format json 2>/dev/null || true"
    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=120
    )

    try:
        results = json.loads(proc.stdout) if proc.stdout.strip() else []
    except json.JSONDecodeError:
        return f"Failed to parse ESLint output. Raw: {proc.stdout[:500]}"

    total_errors = sum(f.get("errorCount", 0) for f in results)
    total_warnings = sum(f.get("warningCount", 0) for f in results)
    total_fixable = sum(f.get("fixableErrorCount", 0) + f.get("fixableWarningCount", 0) for f in results)
    files_with_issues = len([f for f in results if f.get("errorCount", 0) + f.get("warningCount", 0) > 0])

    # Top rules
    rule_counts: Dict[str, int] = {}
    for file_result in results:
        for msg in file_result.get("messages", []):
            rule = msg.get("ruleId", "unknown")
            rule_counts[rule] = rule_counts.get(rule, 0) + 1

    top_rules = sorted(rule_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    summary = f"ESLint Results:\n"
    summary += f"  Files analyzed: {len(results)}\n"
    summary += f"  Files with issues: {files_with_issues}\n"
    summary += f"  Errors: {total_errors}\n"
    summary += f"  Warnings: {total_warnings}\n"
    summary += f"  Auto-fixable: {total_fixable}\n"
    summary += f"\nTop violated rules:\n"
    for rule, count in top_rules:
        summary += f"  {rule}: {count}\n"

    return summary


@eslint_agent.tool
async def apply_auto_fixes(
    ctx: RunContext[ESLintAgentDeps],
    target: str = "./apps/ ./packages/"
) -> str:
    """Apply ESLint auto-fixes."""
    cmd = f"npx eslint {target} --fix 2>&1 || true"
    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=120
    )

    # Check what changed
    diff_proc = subprocess.run(
        "git diff --stat",
        shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root
    )

    files_changed = diff_proc.stdout.count("|") if diff_proc.stdout else 0

    return f"Auto-fix applied. Files modified: {files_changed}\n{diff_proc.stdout[-500:]}"


@eslint_agent.tool
async def analyze_file_issues(
    ctx: RunContext[ESLintAgentDeps],
    file_path: str
) -> str:
    """Analyze ESLint issues in a specific file."""
    cmd = f"npx eslint {file_path} --format json 2>/dev/null || true"
    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=30
    )

    try:
        results = json.loads(proc.stdout) if proc.stdout.strip() else []
    except json.JSONDecodeError:
        return f"Failed to parse ESLint output for {file_path}"

    if not results or not results[0].get("messages"):
        return f"No ESLint issues in {file_path}"

    messages = results[0]["messages"]
    output = f"ESLint issues in {file_path}: {len(messages)}\n\n"

    for msg in messages[:20]:
        severity = "ERROR" if msg.get("severity", 0) == 2 else "WARN"
        line = msg.get("line", 0)
        rule = msg.get("ruleId", "unknown")
        text = msg.get("message", "")
        fixable = " [fixable]" if msg.get("fix") else ""
        output += f"  [{severity}] Line {line}: {text} ({rule}){fixable}\n"

    return output


# --- Public API ---

async def analyze_lint(
    description: str,
    project_root: str = "."
) -> str:
    """Run ESLint analysis."""
    deps = ESLintAgentDeps(project_root=project_root)
    result = await eslint_agent.run(description, deps=deps)
    return result.data
