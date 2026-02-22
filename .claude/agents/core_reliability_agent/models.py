"""
Models for Core Reliability Agent — Notesnook monorepo.

Adapted from RIGGWIRE-EA-LIVE mt5_infinite_reliability_agent/models.py.
Refactored from MQL5/FTMO compliance to encryption correctness and data integrity.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class ReliabilityDimension(str, Enum):
    """Dimensions of reliability to check."""
    ENCRYPTION = "encryption"        # E2E encryption correctness
    DATA_INTEGRITY = "data_integrity"  # Data consistency and corruption prevention
    SYNC = "sync"                    # Sync engine reliability
    PERFORMANCE = "performance"      # Core package performance
    MEMORY = "memory"                # Memory leak prevention


class EscalationTier(str, Enum):
    """Escalation tiers for the never-fail strategy."""
    FAST = "fast"          # Quick automated checks
    SMART = "smart"        # AI-assisted analysis
    THOROUGH = "thorough"  # Deep manual review
    EMERGENCY = "emergency"  # Full audit


class ReliabilityCheck(BaseModel):
    """A single reliability check result."""
    name: str
    dimension: ReliabilityDimension
    passed: bool
    message: str
    severity: str = "info"  # critical, high, medium, low, info
    file_path: str = ""
    details: Dict[str, str] = Field(default_factory=dict)


class EncryptionAudit(BaseModel):
    """Audit of encryption implementation correctness."""
    files_audited: List[str] = Field(default_factory=list)
    checks: List[ReliabilityCheck] = Field(default_factory=list)

    # Key areas
    key_derivation_safe: bool = True
    nonce_handling_safe: bool = True
    no_plaintext_leaks: bool = True
    proper_zeroing: bool = True  # Sensitive data zeroed after use
    no_weak_crypto: bool = True  # No MD5, SHA1, Math.random

    summary: str = ""

    @property
    def all_passed(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def critical_failures(self) -> List[ReliabilityCheck]:
        return [c for c in self.checks if not c.passed and c.severity == "critical"]


class DataIntegrityReport(BaseModel):
    """Report on data integrity checks."""
    checks: List[ReliabilityCheck] = Field(default_factory=list)

    # Sync integrity
    sync_conflict_handling: bool = True
    idempotent_operations: bool = True
    atomic_transactions: bool = True

    # Storage integrity
    schema_migrations_safe: bool = True
    no_data_loss_paths: bool = True

    summary: str = ""


class SyncReliabilityReport(BaseModel):
    """Report on sync engine reliability."""
    checks: List[ReliabilityCheck] = Field(default_factory=list)

    # Sync concerns
    handles_network_failure: bool = True
    handles_partial_sync: bool = True
    handles_conflict_resolution: bool = True
    handles_concurrent_edits: bool = True

    summary: str = ""


class CoreTestCoverage(BaseModel):
    """Test coverage metrics for packages/core."""
    total_tests: int = 0
    passing: int = 0
    failing: int = 0
    skipped: int = 0
    coverage_percentage: float = 0.0
    uncovered_critical_paths: List[str] = Field(default_factory=list)
