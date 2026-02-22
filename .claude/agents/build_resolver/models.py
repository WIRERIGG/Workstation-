"""
Models for Build Resolver Agent — Notesnook monorepo.

Adapted from RIGGWIRE-EA-LIVE never_fail_build_resolver/models.py.
Refactored from CMake/GTest to npm/Yarn/Vite/Vitest.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class EscalationTier(str, Enum):
    """Escalation tiers for build resolution."""
    FAST = "fast"          # Clear cache, reinstall
    SMART = "smart"        # Analyze error, targeted fix
    THOROUGH = "thorough"  # Deep dependency analysis
    EMERGENCY = "emergency"  # Full clean rebuild


class BuildErrorCategory(str, Enum):
    """Categories of build errors."""
    MODULE_NOT_FOUND = "module_not_found"
    TYPE_ERROR = "type_error"
    SYNTAX_ERROR = "syntax_error"
    DEPENDENCY_CONFLICT = "dependency_conflict"
    NATIVE_MODULE = "native_module"
    OUT_OF_MEMORY = "out_of_memory"
    TIMEOUT = "timeout"
    PERMISSION = "permission"
    PATCH_FAILURE = "patch_failure"
    VOLTA_NODE = "volta_node"
    UNKNOWN = "unknown"


class BuildProblem(BaseModel):
    """A categorized build problem."""
    category: BuildErrorCategory
    message: str
    file_path: str = ""
    package: str = ""
    raw_error: str = ""
    suggested_tier: EscalationTier = EscalationTier.FAST


class BuildResolution(BaseModel):
    """A proposed resolution for a build problem."""
    problem: BuildProblem
    tier_used: EscalationTier
    commands: List[str] = Field(default_factory=list)
    explanation: str = ""
    success: bool = False
    attempts: int = 0


class BuildDiagnostics(BaseModel):
    """Complete build diagnostics."""
    problems: List[BuildProblem] = Field(default_factory=list)
    resolutions: List[BuildResolution] = Field(default_factory=list)
    node_version: str = ""
    yarn_version: str = ""
    packages_with_issues: List[str] = Field(default_factory=list)
    environment_valid: bool = True
    summary: str = ""
