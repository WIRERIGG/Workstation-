"""
Bundle Optimizer Agent — Bundle size and React performance optimization.

Adapted from RIGGWIRE-EA-LIVE blitzfire_cpp_optimizer/agent.py.
Refactored from C++ SIMD/cache optimization to Vite/React bundle optimization.

Tools:
- analyze_bundle_size: Measure bundle size for a package
- find_unused_exports: Detect tree-shaking opportunities
- find_barrel_files: Detect problematic barrel (index.ts) re-exports
- suggest_code_splitting: Find dynamic import opportunities
- check_dependency_size: Analyze large dependencies
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
class BundleOptimizerDeps:
    """Dependencies for Bundle Optimizer Agent."""
    project_root: str = "."
    target_package: str = "web"
    optimization_level: str = "standard"
    session_id: Optional[str] = None


SYSTEM_PROMPT = """You are a bundle optimization specialist for the Notesnook monorepo.

Notesnook build system:
- Vite for web (apps/web) and desktop (apps/desktop)
- React Native for mobile (apps/mobile) — no bundle splitting
- tsup/tsdown for library packages
- Shared packages are consumed by all apps

Optimization areas:
1. Tree-shaking: Identify unused exports, side-effect imports, barrel files
2. Code splitting: Dynamic imports for route-level and feature-level splitting
3. Dependency analysis: Large deps, duplicate deps, lighter alternatives
4. React performance: Lazy components, Suspense boundaries, memo optimization
5. Asset optimization: Image compression, font subsetting

Key packages affecting bundle size:
- packages/editor (TipTap — largest package)
- packages/crypto + packages/sodium (libsodium — crypto operations)
- packages/ui (shared components — affects all web-based apps)
- packages/core (business logic — used everywhere)

When recommending optimizations:
- Estimate impact in KB where possible
- Provide before/after code examples
- Consider all platforms (web change shouldn't break mobile)
- Never suggest removing encryption-related code
"""

bundle_optimizer_agent = Agent(
    "anthropic:claude-sonnet-4-5-20250929",
    deps_type=BundleOptimizerDeps,
    system_prompt=SYSTEM_PROMPT
)


@bundle_optimizer_agent.tool
async def find_barrel_files(
    ctx: RunContext[BundleOptimizerDeps],
    package_path: str = "packages"
) -> str:
    """Find barrel (index.ts) files that may hurt tree-shaking."""
    target = Path(ctx.deps.project_root) / package_path
    if not target.exists():
        return f"Path not found: {package_path}"

    barrel_files = []
    for index_file in target.rglob("index.ts"):
        code = index_file.read_text(encoding="utf-8", errors="ignore")
        export_count = code.count("export ")
        re_export_count = len(re.findall(r'export\s+\{.*\}\s+from', code)) + len(re.findall(r'export\s+\*\s+from', code))

        if re_export_count > 5:
            rel_path = str(index_file.relative_to(ctx.deps.project_root))
            barrel_files.append(f"  {rel_path}: {re_export_count} re-exports, {export_count} total exports")

    if not barrel_files:
        return "No problematic barrel files found."

    return f"Barrel files with many re-exports (potential tree-shaking issues):\n" + "\n".join(barrel_files)


@bundle_optimizer_agent.tool
async def check_dependency_sizes(
    ctx: RunContext[BundleOptimizerDeps],
    package_name: str = "web"
) -> str:
    """Check for large dependencies in a package."""
    pkg_json = Path(ctx.deps.project_root) / "apps" / package_name / "package.json"
    if not pkg_json.exists():
        pkg_json = Path(ctx.deps.project_root) / "packages" / package_name / "package.json"
    if not pkg_json.exists():
        return f"package.json not found for {package_name}"

    import json
    data = json.loads(pkg_json.read_text())
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}

    # Known large packages
    large_packages = {
        "moment": "Consider dayjs or date-fns (much smaller)",
        "lodash": "Use lodash-es or individual imports",
        "rxjs": "Large — ensure tree-shaking works",
        "@tiptap": "Expected — core editor dependency",
        "libsodium": "Expected — encryption dependency",
    }

    findings = []
    for dep_name in deps:
        for known, advice in large_packages.items():
            if known in dep_name:
                findings.append(f"  {dep_name}: {advice}")

    total_deps = len(deps)
    result = f"Dependencies for {package_name}: {total_deps} total\n"

    if findings:
        result += f"\nNotable large dependencies:\n" + "\n".join(findings)
    else:
        result += "No known large-package concerns."

    return result


@bundle_optimizer_agent.tool
async def find_dynamic_import_opportunities(
    ctx: RunContext[BundleOptimizerDeps],
    app_path: str = "apps/web/src"
) -> str:
    """Find opportunities for dynamic imports (code splitting)."""
    target = Path(ctx.deps.project_root) / app_path
    if not target.exists():
        return f"Path not found: {app_path}"

    opportunities = []

    for ts_file in target.rglob("*.tsx"):
        code = ts_file.read_text(encoding="utf-8", errors="ignore")
        rel_path = str(ts_file.relative_to(ctx.deps.project_root))

        # Large static imports that could be lazy
        static_imports = re.findall(r'import\s+.*\s+from\s+["\']([^"\']+)["\']', code)

        # Check for route-level components that aren't lazy
        if "Route" in code or "route" in rel_path.lower():
            lazy_imports = "React.lazy" in code or "lazy(" in code
            if not lazy_imports and len(static_imports) > 5:
                opportunities.append(f"  {rel_path}: Route component with {len(static_imports)} static imports — consider React.lazy")

        # Check for large component files
        line_count = len(code.split("\n"))
        if line_count > 500 and "React.lazy" not in code:
            opportunities.append(f"  {rel_path}: Large component ({line_count} lines) — consider splitting")

    if not opportunities:
        return "No obvious code splitting opportunities found."

    return "Dynamic import opportunities:\n" + "\n".join(opportunities[:15])


# --- Public API ---

async def optimize_bundle(
    description: str,
    project_root: str = ".",
    target_package: str = "web"
) -> str:
    """Run bundle optimization analysis."""
    deps = BundleOptimizerDeps(
        project_root=project_root,
        target_package=target_package
    )
    result = await bundle_optimizer_agent.run(description, deps=deps)
    return result.data
