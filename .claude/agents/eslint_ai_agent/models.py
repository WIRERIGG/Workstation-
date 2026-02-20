"""
Models for ESLint AI Agent — Notesnook monorepo.

Adapted from RIGGWIRE-EA-LIVE clang_tidy_ai_agent/models.py.
Refactored from Clang-Tidy C++ to ESLint TypeScript/React.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class ESLintSeverity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    OFF = "off"


class FixConfidence(str, Enum):
    HIGH = "high"        # Auto-fixable by ESLint --fix
    MEDIUM = "medium"    # AI can suggest a reliable fix
    LOW = "low"          # Needs human review
    MANUAL = "manual"    # Cannot be auto-fixed


class ESLintIssue(BaseModel):
    """A single ESLint issue."""
    rule_id: str              # e.g. "@typescript-eslint/no-explicit-any"
    message: str
    severity: ESLintSeverity
    file_path: str
    line: int
    column: int = 0
    end_line: Optional[int] = None
    end_column: Optional[int] = None
    fix_available: bool = False
    source_snippet: str = ""


class FixStrategy(BaseModel):
    """A proposed fix strategy for an ESLint issue."""
    issue: ESLintIssue
    confidence: FixConfidence
    description: str
    before_code: str = ""
    after_code: str = ""
    side_effects: List[str] = Field(default_factory=list)


class ESLintAnalysisResult(BaseModel):
    """Complete ESLint analysis result."""
    total_errors: int = 0
    total_warnings: int = 0
    total_fixable: int = 0
    files_analyzed: int = 0
    issues: List[ESLintIssue] = Field(default_factory=list)
    fix_strategies: List[FixStrategy] = Field(default_factory=list)
    top_rules: Dict[str, int] = Field(default_factory=dict)  # rule_id -> count
    summary: str = ""


class ESLintConfig(BaseModel):
    """Configuration for ESLint analysis."""
    target_paths: List[str] = Field(default_factory=lambda: ["./apps/", "./packages/"])
    fix_mode: bool = False
    max_warnings: int = 0
    rules_to_focus: List[str] = Field(default_factory=list)
    ignore_patterns: List[str] = Field(default_factory=lambda: ["node_modules", "dist", "build"])
