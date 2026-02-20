"""
TypeScript Code Agent — Deep TS/React code analysis for Notesnook.

Adapted from RIGGWIRE-EA-LIVE blitzfire_code_agent/agent.py.
Refactored from C++ performance to TypeScript/React analysis.

Tools:
- analyze_typescript_code: General TS quality analysis
- analyze_react_component: React-specific analysis
- check_type_safety: Type coverage and any-type detection
- find_unused_exports: Tree-shaking opportunities
- review_encryption_code: Crypto-specific review
"""

import asyncio
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Any, Optional

from pydantic_ai import Agent, RunContext

logger = logging.getLogger(__name__)


@dataclass
class TypeScriptAgentDeps:
    """Dependencies for the TypeScript Code Agent."""
    project_root: str = "."
    target_package: str = "core"
    analysis_mode: str = "general"
    session_id: Optional[str] = None


# System prompt
SYSTEM_PROMPT = """You are a TypeScript/React code analysis specialist for the Notesnook monorepo.

Notesnook is an E2E encrypted note-taking app with:
- 6 apps (web, mobile, desktop, monograph, theme-builder, vericrypt)
- 12 shared packages (core, editor, crypto, sodium, ui, common, etc.)
- TipTap-based rich text editor
- Zero-knowledge encryption via libsodium

Your analysis capabilities:
1. TypeScript quality: type safety, unused imports, dead code, complexity
2. React performance: unnecessary re-renders, missing memoization, effect deps
3. Bundle optimization: tree-shaking, code splitting, lazy loading
4. Security review: encryption patterns, data exposure, XSS prevention
5. Architecture: package boundaries, circular dependencies, layering

Always provide actionable findings with file paths and line numbers.
Categorize issues by severity: critical, high, medium, low, info.
"""


# Create the agent (lazy model loading for import safety)
def _create_agent():
    try:
        from .providers import get_llm_model
        return Agent(
            get_llm_model(),
            deps_type=TypeScriptAgentDeps,
            system_prompt=SYSTEM_PROMPT
        )
    except Exception:
        # Fallback: create without model (for import-time safety)
        return None


typescript_agent = None  # Lazy init


def _get_agent():
    global typescript_agent
    if typescript_agent is None:
        from ..awareness_orchestrator.providers import get_llm_model
        typescript_agent = Agent(
            get_llm_model(),
            deps_type=TypeScriptAgentDeps,
            system_prompt=SYSTEM_PROMPT
        )
    return typescript_agent


# --- Tools ---

def _register_tools(agent: Agent):
    """Register tools on the agent."""

    @agent.tool
    async def analyze_typescript_code(
        ctx: RunContext[TypeScriptAgentDeps],
        file_path: str,
        focus: str = "general"
    ) -> str:
        """
        Analyze a TypeScript file for quality issues.

        Args:
            file_path: Path to the .ts/.tsx file
            focus: Analysis focus (general, performance, security, types)
        """
        full_path = Path(ctx.deps.project_root) / file_path
        if not full_path.exists():
            return f"File not found: {file_path}"

        code = full_path.read_text(encoding="utf-8")
        lines = code.split("\n")

        findings = []

        # Check for 'any' types
        for i, line in enumerate(lines, 1):
            if ": any" in line or "as any" in line:
                findings.append(f"  Line {i}: 'any' type detected — reduces type safety")

        # Check for console.log
        for i, line in enumerate(lines, 1):
            if "console.log" in line and not line.strip().startswith("//"):
                findings.append(f"  Line {i}: console.log found — remove before commit")

        # Check for TODO/FIXME
        for i, line in enumerate(lines, 1):
            if "TODO" in line or "FIXME" in line:
                findings.append(f"  Line {i}: {line.strip()}")

        summary = f"Analyzed: {file_path} ({len(lines)} lines)\n"
        summary += f"Issues found: {len(findings)}\n"
        if findings:
            summary += "\n".join(findings[:20])  # Cap at 20
        else:
            summary += "No issues detected."

        return summary

    @agent.tool
    async def analyze_react_component(
        ctx: RunContext[TypeScriptAgentDeps],
        file_path: str
    ) -> str:
        """Analyze a React component for performance issues."""
        full_path = Path(ctx.deps.project_root) / file_path
        if not full_path.exists():
            return f"File not found: {file_path}"

        code = full_path.read_text(encoding="utf-8")

        analysis = []

        # Check for React.memo
        if "React.memo" in code or "memo(" in code:
            analysis.append("Uses memoization (good)")
        elif "export default function" in code or "export function" in code:
            analysis.append("WARNING: Component not memoized — may re-render unnecessarily")

        # Check for useCallback/useMemo
        if "useCallback" in code:
            analysis.append("Uses useCallback for callback stability")
        if "useMemo" in code:
            analysis.append("Uses useMemo for computed values")

        # Check useEffect dependencies
        import re
        effects = re.findall(r'useEffect\([^)]*,\s*\[(.*?)\]', code, re.DOTALL)
        for i, deps in enumerate(effects):
            if not deps.strip():
                analysis.append(f"useEffect #{i+1}: Empty dependency array (runs once)")
            else:
                dep_count = len(deps.split(","))
                if dep_count > 5:
                    analysis.append(f"useEffect #{i+1}: {dep_count} dependencies — consider splitting")

        # Check for inline functions in JSX
        inline_handlers = len(re.findall(r'on\w+=\{[^}]*=>', code))
        if inline_handlers > 3:
            analysis.append(f"WARNING: {inline_handlers} inline arrow functions in JSX — extract with useCallback")

        return f"React Analysis: {file_path}\n" + "\n".join(analysis) if analysis else "No React-specific issues."

    @agent.tool
    async def check_type_safety(
        ctx: RunContext[TypeScriptAgentDeps],
        package_name: str = "core"
    ) -> str:
        """Run TypeScript compiler in check mode for a package."""
        cmd = f"npx tsc --noEmit --project packages/{package_name}/tsconfig.json 2>&1 || true"
        proc = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            cwd=ctx.deps.project_root, timeout=120
        )

        output = proc.stdout
        error_count = output.count("error TS")

        if error_count == 0:
            return f"Type check passed for packages/{package_name}"
        else:
            return f"Type check: {error_count} errors in packages/{package_name}\n{output[-1500:]}"

    @agent.tool
    async def review_encryption_code(
        ctx: RunContext[TypeScriptAgentDeps],
        file_path: str
    ) -> str:
        """Review encryption-related code for security concerns."""
        full_path = Path(ctx.deps.project_root) / file_path
        if not full_path.exists():
            return f"File not found: {file_path}"

        code = full_path.read_text(encoding="utf-8")
        findings = []

        # Check for hardcoded keys/secrets
        import re
        if re.search(r'(key|secret|password|token)\s*=\s*["\'][^"\']+["\']', code, re.IGNORECASE):
            findings.append("CRITICAL: Possible hardcoded secret detected")

        # Check for proper nonce handling
        if "nonce" in code.lower():
            if "random" not in code.lower() and "generate" not in code.lower():
                findings.append("WARNING: Nonce usage without apparent randomness")

        # Check for deprecated crypto
        if "Math.random" in code:
            findings.append("CRITICAL: Math.random used — not cryptographically secure")

        if "md5" in code.lower() or "sha1" in code.lower():
            findings.append("WARNING: Weak hash algorithm (MD5/SHA1) detected")

        if not findings:
            return f"Encryption review of {file_path}: No concerns found."
        return f"Encryption review of {file_path}:\n" + "\n".join(findings)

    return agent


# --- Public API ---

async def analyze_typescript(
    description: str,
    project_root: str = ".",
    target_package: str = "core",
    mode: str = "general"
) -> str:
    """Run TypeScript analysis."""
    agent = _get_agent()
    _register_tools(agent)
    deps = TypeScriptAgentDeps(
        project_root=project_root,
        target_package=target_package,
        analysis_mode=mode
    )
    result = await agent.run(description, deps=deps)
    return result.data


def analyze_typescript_sync(
    description: str,
    project_root: str = ".",
    target_package: str = "core"
) -> str:
    """Synchronous wrapper."""
    return asyncio.run(analyze_typescript(description, project_root, target_package))
