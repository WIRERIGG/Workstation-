"""
Core Reliability Agent — Encryption correctness and data integrity for Notesnook.

Adapted from RIGGWIRE-EA-LIVE mt5_infinite_reliability_agent/agent.py.
Refactored from MQL5/FTMO compliance to Notesnook encryption and sync reliability.

Sub-agents (conceptual):
1. CryptoAuditor - Encryption implementation review
2. SyncValidator - Sync engine reliability checks
3. DataIntegrityChecker - Data consistency validation
4. TestCoverageAnalyzer - Critical path test coverage

Tools:
- audit_encryption: Review crypto code for security issues
- validate_sync_logic: Check sync conflict resolution
- check_data_integrity: Verify data handling patterns
- run_core_tests: Execute core test suite
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
class ReliabilityDeps:
    """Dependencies for Core Reliability Agent."""
    project_root: str = "."
    target_dimension: str = "encryption"  # encryption, sync, data_integrity
    session_id: Optional[str] = None


SYSTEM_PROMPT = """You are a reliability specialist for the Notesnook monorepo, focused on
encryption correctness and data integrity.

Notesnook uses zero-knowledge encryption:
- All note content encrypted client-side before sync
- packages/crypto: E2E encryption implementation
- packages/sodium: libsodium bindings
- packages/core: Business logic, sync engine, database

Critical areas to verify:
1. ENCRYPTION: Key derivation, nonce handling, no plaintext leaks, proper zeroing
2. SYNC: Conflict resolution, partial sync recovery, idempotent operations
3. DATA INTEGRITY: Schema migrations, atomic transactions, no data loss paths
4. TEST COVERAGE: Critical encryption/sync paths must have test coverage

Escalation tiers:
- FAST: Automated pattern checks (regex, AST patterns)
- SMART: AI analysis of code logic
- THOROUGH: Deep cross-file analysis
- EMERGENCY: Full security audit recommendation

Always flag CRITICAL issues that could lead to:
- Plaintext data exposure
- Data loss during sync
- Encryption key leakage
- Silent data corruption
"""

reliability_agent = Agent(
    "anthropic:claude-sonnet-4-5-20250929",
    deps_type=ReliabilityDeps,
    system_prompt=SYSTEM_PROMPT
)


@reliability_agent.tool
async def audit_encryption(
    ctx: RunContext[ReliabilityDeps],
    file_path: str = "packages/crypto"
) -> str:
    """Audit encryption code for security issues."""
    target = Path(ctx.deps.project_root) / file_path
    if not target.exists():
        return f"Path not found: {file_path}"

    findings = []

    # Collect all TS files
    if target.is_dir():
        ts_files = list(target.rglob("*.ts")) + list(target.rglob("*.tsx"))
    else:
        ts_files = [target]

    for ts_file in ts_files:
        code = ts_file.read_text(encoding="utf-8", errors="ignore")
        rel_path = str(ts_file.relative_to(ctx.deps.project_root))

        # Check for Math.random (not crypto-safe)
        if "Math.random" in code:
            findings.append(f"CRITICAL [{rel_path}]: Math.random used — not cryptographically secure")

        # Check for hardcoded keys
        if re.search(r'(secret|key|password)\s*[:=]\s*["\'][A-Za-z0-9+/=]{16,}["\']', code, re.IGNORECASE):
            findings.append(f"CRITICAL [{rel_path}]: Possible hardcoded secret/key")

        # Check for weak hashing
        if re.search(r'\b(md5|sha1)\b', code, re.IGNORECASE):
            findings.append(f"HIGH [{rel_path}]: Weak hash algorithm (MD5/SHA1)")

        # Check for eval() — code injection risk
        if "eval(" in code:
            findings.append(f"CRITICAL [{rel_path}]: eval() usage — code injection risk")

        # Check for Buffer/ArrayBuffer zeroing
        if "sodium" in rel_path.lower() or "crypto" in rel_path.lower():
            if "zero" not in code.lower() and "wipe" not in code.lower() and "clear" not in code.lower():
                if "key" in code.lower() or "secret" in code.lower():
                    findings.append(f"MEDIUM [{rel_path}]: No apparent memory zeroing of sensitive data")

    summary = f"Encryption Audit: {len(ts_files)} files scanned\n"
    summary += f"Findings: {len(findings)}\n\n"
    if findings:
        summary += "\n".join(findings)
    else:
        summary += "No encryption concerns found."

    return summary


@reliability_agent.tool
async def validate_sync_logic(
    ctx: RunContext[ReliabilityDeps],
    file_path: str = "packages/core/src/api/sync"
) -> str:
    """Validate sync engine reliability patterns."""
    target = Path(ctx.deps.project_root) / file_path
    if not target.exists():
        return f"Path not found: {file_path}"

    findings = []

    ts_files = list(target.rglob("*.ts")) if target.is_dir() else [target]

    for ts_file in ts_files:
        code = ts_file.read_text(encoding="utf-8", errors="ignore")
        rel_path = str(ts_file.relative_to(ctx.deps.project_root))

        # Check for try/catch around network operations
        if "fetch(" in code or "axios" in code or "request(" in code:
            if "catch" not in code and "try" not in code:
                findings.append(f"HIGH [{rel_path}]: Network call without error handling")

        # Check for timeout handling
        if "fetch(" in code and "timeout" not in code.lower() and "AbortController" not in code:
            findings.append(f"MEDIUM [{rel_path}]: Network call without timeout/abort handling")

        # Check for retry logic
        if "sync" in rel_path.lower() and "retry" not in code.lower():
            findings.append(f"LOW [{rel_path}]: Sync operation without apparent retry logic")

    summary = f"Sync Logic Validation: {len(ts_files)} files checked\n"
    summary += f"Findings: {len(findings)}\n\n"
    summary += "\n".join(findings) if findings else "No sync reliability concerns found."

    return summary


@reliability_agent.tool
async def run_core_tests(ctx: RunContext[ReliabilityDeps]) -> str:
    """Run core tests to verify reliability."""
    cmd = "npm run test:core"
    proc = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=ctx.deps.project_root, timeout=300
    )

    status = "PASSED" if proc.returncode == 0 else "FAILED"
    return f"Core tests: {status}\n{proc.stdout[-1500:]}"


# --- Public API ---

async def check_reliability(
    description: str,
    project_root: str = ".",
    dimension: str = "encryption"
) -> str:
    """Run reliability checks."""
    deps = ReliabilityDeps(
        project_root=project_root,
        target_dimension=dimension
    )
    result = await reliability_agent.run(description, deps=deps)
    return result.data
