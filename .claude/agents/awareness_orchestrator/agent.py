"""
Awareness Orchestrator Agent — Notesnook TypeScript/React monorepo.

Central orchestrator that coordinates all specialized agents for comprehensive
TypeScript/React code analysis. Adapted from RIGGWIRE-EA-LIVE.

Internal sub-agents:
- AnalysisAgent: TypeScript/React code quality
- ArchitectureAgent: Package boundary and dependency analysis
- ValidationAgent: Build, test, and lint validation

External agent integrations:
- TypeScriptCodeAgent: Deep TS analysis and performance
- ESLintAIAgent: Lint compliance with AI fixes
- BundleOptimizer: Bundle size and code splitting
- CoreReliabilityAgent: Encryption correctness
- DebugSystem: Node.js/React debugging
- BuildResolver: Build failure resolution
- PerformanceProfiler: Runtime profiling
"""

import asyncio
import logging
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

from pydantic_ai import Agent, RunContext

from .models import (
    AgentType, Severity, Finding, AgentFindings,
    OrchestrationContext, OrchestrationResult,
    BuildResult, TestResult
)
from .dependencies import OrchestrationDeps
from .prompts import (
    ANALYSIS_AGENT_PROMPT, ARCHITECTURE_AGENT_PROMPT,
    VALIDATION_AGENT_PROMPT, ORCHESTRATOR_PROMPT,
    NOTESNOOK_ORCHESTRATOR_PROMPT,
    detect_code_type, get_routing_prompt
)
from .providers import get_llm_model
from .settings import load_settings

logger = logging.getLogger(__name__)


# --- Internal Sub-Agents ---

analysis_agent = Agent(
    get_llm_model(),
    deps_type=OrchestrationDeps,
    system_prompt=ANALYSIS_AGENT_PROMPT
)

architecture_agent = Agent(
    get_llm_model(),
    deps_type=OrchestrationDeps,
    system_prompt=ARCHITECTURE_AGENT_PROMPT
)

validation_agent = Agent(
    get_llm_model(),
    deps_type=OrchestrationDeps,
    system_prompt=VALIDATION_AGENT_PROMPT
)

# --- Main Orchestrator Agent ---

orchestrator_agent = Agent(
    get_llm_model(),
    deps_type=OrchestrationDeps,
    system_prompt=NOTESNOOK_ORCHESTRATOR_PROMPT
)


# --- Orchestrator Tools ---

@orchestrator_agent.tool
async def run_agent_chain(
    ctx: RunContext[OrchestrationDeps],
    agent_types: str,
    target_description: str
) -> str:
    """
    Run a chain of analysis agents on the target code.

    Args:
        agent_types: Comma-separated agent types (typescript_code, eslint_ai, etc.)
        target_description: Description of what to analyze
    """
    agents_to_run = [a.strip() for a in agent_types.split(",")]
    results = []

    for agent_type in agents_to_run:
        ctx.deps.progress_reporter.report(
            "agent_chain",
            f"Running {agent_type} agent...",
            len(results) / len(agents_to_run)
        )

        if agent_type == "analysis":
            result = await analysis_agent.run(target_description, deps=ctx.deps)
            results.append(f"[Analysis] {result.data}")
        elif agent_type == "architecture":
            result = await architecture_agent.run(target_description, deps=ctx.deps)
            results.append(f"[Architecture] {result.data}")
        elif agent_type == "validation":
            result = await validation_agent.run(target_description, deps=ctx.deps)
            results.append(f"[Validation] {result.data}")
        else:
            results.append(f"[{agent_type}] Agent not directly available — use external integration")

    return "\n\n".join(results)


@orchestrator_agent.tool
async def run_core_tests(ctx: RunContext[OrchestrationDeps]) -> str:
    """Run the core test suite (npm run test:core)."""
    settings = load_settings()
    cmd = settings.primary_test_command

    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=300
    )

    test_result = TestResult(
        success=proc.returncode == 0,
        package="core"
    )

    # Parse Vitest output for counts
    output = proc.stdout
    if "passed" in output:
        # Try to extract test counts from Vitest summary
        for line in output.split("\n"):
            if "Tests" in line:
                if "failed" in line:
                    try:
                        parts = line.split("|")
                        for part in parts:
                            if "failed" in part:
                                test_result.failed = int(''.join(filter(str.isdigit, part.split("failed")[0])))
                            if "passed" in part:
                                test_result.passed = int(''.join(filter(str.isdigit, part.split("passed")[0])))
                    except (ValueError, IndexError):
                        pass

    status = "PASSED" if test_result.success else "FAILED"
    return f"Core tests {status}: {test_result.passed} passed, {test_result.failed} failed\n{output[-1000:]}"


@orchestrator_agent.tool
async def run_lint_check(ctx: RunContext[OrchestrationDeps]) -> str:
    """Run ESLint across the project."""
    settings = load_settings()
    cmd = settings.lint_command

    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=120
    )

    status = "CLEAN" if proc.returncode == 0 else "ISSUES FOUND"
    output = proc.stdout[-1500:] if proc.stdout else proc.stderr[-1500:]
    return f"Lint check: {status}\n{output}"


@orchestrator_agent.tool
async def analyze_changed_files(ctx: RunContext[OrchestrationDeps]) -> str:
    """Analyze which files have changed and determine routing."""
    # Get changed files from git
    proc = subprocess.run(
        "git diff --name-only HEAD~1",
        shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root
    )

    changed_files = [f.strip() for f in proc.stdout.strip().split("\n") if f.strip()]

    if not changed_files:
        # Try unstaged changes
        proc = subprocess.run(
            "git diff --name-only",
            shell=True, capture_output=True, text=True,
            cwd=ctx.deps.project_root
        )
        changed_files = [f.strip() for f in proc.stdout.strip().split("\n") if f.strip()]

    if not changed_files:
        return "No changed files detected."

    ctx.deps.changed_files = changed_files

    # Categorize files
    categories: Dict[str, List[str]] = {}
    for f in changed_files:
        code_type = detect_code_type(f)
        categories.setdefault(code_type, []).append(f)

    # Determine routing
    routing = get_routing_prompt(changed_files)

    summary = f"Changed files: {len(changed_files)}\n"
    for cat, files in categories.items():
        summary += f"  {cat}: {len(files)} files\n"
    summary += f"\n{routing}"

    return summary


@orchestrator_agent.tool
async def get_dashboard(ctx: RunContext[OrchestrationDeps]) -> str:
    """Get the current metrics dashboard."""
    metrics = ctx.deps.metrics_dashboard.get_summary()
    if not metrics:
        return "No metrics recorded yet. Run analysis first."

    lines = ["Metrics Dashboard:"]
    for name, data in metrics.items():
        lines.append(f"  {name}: {data['value']} {data.get('unit', '')}")
    return "\n".join(lines)


@orchestrator_agent.tool
async def record_finding(
    ctx: RunContext[OrchestrationDeps],
    title: str,
    description: str,
    severity: str,
    file_path: str = "",
    category: str = "general"
) -> str:
    """Record an analysis finding."""
    finding = Finding(
        title=title,
        description=description,
        severity=Severity(severity) if severity in [s.value for s in Severity] else Severity.MEDIUM,
        file_path=file_path,
        category=category,
        agent_source="orchestrator"
    )

    # Store in session metadata
    findings = ctx.deps.session_metadata.setdefault("findings", [])
    findings.append({
        "title": finding.title,
        "severity": finding.severity.value,
        "file": finding.file_path,
        "category": finding.category
    })

    return f"Finding recorded: [{finding.severity.value}] {finding.title}"


# --- Public API ---

async def orchestrate(
    description: str,
    project_root: str = ".",
    target_packages: Optional[List[str]] = None
) -> str:
    """
    Run the orchestrator on a given description.

    Args:
        description: What to analyze or do
        project_root: Path to Notesnook monorepo root
        target_packages: Specific packages to focus on

    Returns:
        Orchestrator response string
    """
    deps = OrchestrationDeps.create_default(project_root)
    if target_packages:
        deps.target_packages = target_packages

    result = await orchestrator_agent.run(description, deps=deps)
    return result.data


def orchestrate_sync(
    description: str,
    project_root: str = ".",
    target_packages: Optional[List[str]] = None
) -> str:
    """Synchronous wrapper for orchestrate."""
    return asyncio.run(orchestrate(description, project_root, target_packages))
