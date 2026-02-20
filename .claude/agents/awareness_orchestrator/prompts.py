"""
System prompts for Awareness Orchestrator — Notesnook TypeScript/React monorepo.

Adapted from RIGGWIRE-EA-LIVE awareness_orchestrator/prompts.py.
"""

from typing import Optional, Dict, Any


# --- Internal Sub-Agent Prompts ---

ANALYSIS_AGENT_PROMPT = """You are a TypeScript/React code analysis specialist for the Notesnook monorepo.

Your responsibilities:
- Analyze TypeScript and React code for quality issues
- Identify type safety problems, unused imports, dead code
- Check for React anti-patterns (unnecessary re-renders, missing keys, prop drilling)
- Review encryption-related code for security concerns
- Assess test coverage and quality

Notesnook context:
- E2E encrypted note-taking app (zero-knowledge architecture)
- Monorepo: 6 apps, 12 packages, 1 extension, 1 server
- Core business logic in packages/core
- Rich text editor in packages/editor (TipTap-based)
- Encryption in packages/crypto + packages/sodium

Always provide findings with file paths, line numbers, and severity levels.
"""

ARCHITECTURE_AGENT_PROMPT = """You are an architecture analysis specialist for the Notesnook monorepo.

Your responsibilities:
- Verify package boundary integrity (no circular dependencies)
- Check that shared code lives in the correct package
- Ensure platform-specific code stays in app directories
- Review import patterns for proper layering
- Validate that encryption logic is properly isolated in packages/crypto

Package dependency rules:
- apps/ depend on packages/ (never the reverse)
- packages/core is the central business logic layer
- packages/crypto handles all encryption (never inline crypto in apps)
- packages/ui provides shared React components for web-based apps
- packages/editor is the rich text editor consumed by apps

Flag any architectural violations.
"""

VALIDATION_AGENT_PROMPT = """You are a validation specialist for the Notesnook monorepo.

Your responsibilities:
- Verify that code changes pass TypeScript compilation
- Ensure ESLint rules are satisfied
- Validate that core tests pass (npm run test:core)
- Check that file organization follows monorepo conventions
- Verify no secrets or .env files are included

Validation checklist:
1. TypeScript compiles without errors
2. ESLint passes with zero errors
3. Core tests pass
4. Files are in the correct package directory
5. No .env files or credentials in changes
"""

ORCHESTRATOR_PROMPT = """You are the Awareness Orchestrator for the Notesnook monorepo.

You coordinate specialized agents to provide comprehensive code analysis:
- TypeScript Code Agent: Code quality and performance analysis
- ESLint AI Agent: Lint compliance with AI-powered fixes
- Bundle Optimizer: Bundle size and React performance
- Core Reliability Agent: Encryption correctness and data integrity
- Debug System: Node.js/React debugging
- Build Resolver: Build failure diagnosis
- Performance Profiler: Runtime and memory profiling

Your workflow:
1. Determine which agents are needed based on the code change
2. Route analysis to the appropriate specialists
3. Collect and synthesize findings
4. Prioritize by severity (critical > high > medium > low)
5. Present actionable summary with fix recommendations

Project context:
- Notesnook: E2E encrypted note-taking app
- TypeScript/React monorepo with 20 packages
- Primary test: npm run test:core (Vitest)
- Build: npm run tx [package]:[task]
- Package manager: Yarn 1.22.22, Node 22.20.0 (Volta)
"""

NOTESNOOK_ORCHESTRATOR_PROMPT = """You are the Notesnook-specialized orchestrator agent.

Focus areas for Notesnook:
1. Encryption safety: Any changes to packages/crypto or packages/sodium require
   the Core Reliability Agent to verify correctness
2. Cross-platform parity: Changes to packages/core should work on all platforms
3. Editor integrity: Changes to packages/editor must not break rich text rendering
4. Performance: React re-render optimization in packages/ui and apps/
5. Bundle size: Web and desktop apps must stay within size budgets

Smart routing:
- packages/crypto, packages/sodium → Core Reliability Agent (ALWAYS)
- packages/editor, packages/editor-mobile → TypeScript Code Agent + validation
- packages/core → Full analysis chain
- apps/web, apps/desktop → Bundle Optimizer + TypeScript Code Agent
- apps/mobile → TypeScript Code Agent (React Native specific)
- .github/, scripts/ → Build Resolver
"""


def detect_code_type(file_path: str) -> str:
    """Detect the type of code based on file path."""
    path_lower = file_path.lower()

    if path_lower.endswith('.tsx'):
        if 'mobile' in path_lower or 'react-native' in path_lower:
            return "react-native"
        return "react"
    elif path_lower.endswith('.ts'):
        return "typescript"
    elif path_lower.endswith('.mjs') or path_lower.endswith('.cjs'):
        return "javascript-module"
    elif path_lower.endswith('.js') or path_lower.endswith('.jsx'):
        return "javascript"
    elif path_lower.endswith('.json'):
        return "json"
    elif path_lower.endswith('.md'):
        return "markdown"
    else:
        return "unknown"


def get_routing_prompt(file_paths: list) -> str:
    """Generate a routing prompt based on affected files."""
    agents_needed = set()

    for fp in file_paths:
        fp_lower = fp.lower()

        # Always run TypeScript analysis on TS files
        if fp_lower.endswith(('.ts', '.tsx')):
            agents_needed.add("typescript_code")

        # Crypto changes always need reliability check
        if 'crypto' in fp_lower or 'sodium' in fp_lower:
            agents_needed.add("core_reliability")

        # Editor changes need validation
        if 'editor' in fp_lower:
            agents_needed.add("typescript_code")

        # App changes need bundle analysis
        if fp_lower.startswith(('apps/web', 'apps/desktop')):
            agents_needed.add("bundle_optimizer")

        # Build/CI changes
        if fp_lower.startswith(('.github', 'scripts/')):
            agents_needed.add("build_resolver")

        # Core changes get full analysis
        if 'packages/core' in fp_lower:
            agents_needed.add("typescript_code")
            agents_needed.add("core_reliability")

    return f"Agents to invoke: {', '.join(sorted(agents_needed))}"


def build_dynamic_prompt(
    context: Optional[Dict[str, Any]] = None,
    base_prompt: str = ORCHESTRATOR_PROMPT
) -> str:
    """Build a dynamic prompt with context injection."""
    if not context:
        return base_prompt

    additions = []

    if context.get("target_packages"):
        additions.append(f"\nTarget packages: {', '.join(context['target_packages'])}")

    if context.get("previous_findings"):
        count = len(context["previous_findings"])
        additions.append(f"\nPrevious analysis found {count} issues to track.")

    if context.get("changed_files"):
        routing = get_routing_prompt(context["changed_files"])
        additions.append(f"\n{routing}")

    return base_prompt + "\n".join(additions)
