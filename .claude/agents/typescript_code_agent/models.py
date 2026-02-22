"""
Models for TypeScript Code Agent — Notesnook monorepo.

Adapted from RIGGWIRE-EA-LIVE blitzfire_code_agent/models.py.
Refactored from C++ performance analysis to TypeScript/React analysis.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class AnalysisMode(str, Enum):
    """Analysis modes for TypeScript code."""
    GENERAL = "general"           # General code quality
    REACT_PERFORMANCE = "react"   # React-specific optimizations
    BUNDLE = "bundle"             # Bundle size and tree-shaking
    SECURITY = "security"         # Security-focused analysis
    ENCRYPTION = "encryption"     # Encryption code review


class IssueSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class CodeIssue(BaseModel):
    """A single code issue found during analysis."""
    title: str
    description: str
    severity: IssueSeverity
    file_path: str = ""
    line_number: Optional[int] = None
    rule: str = ""  # ESLint rule or custom rule ID
    category: str = ""  # type-safety, performance, react, security, etc.
    suggestion: str = ""
    auto_fixable: bool = False


class ComplexityAnalysis(BaseModel):
    """Complexity analysis for a file or module."""
    file_path: str
    cyclomatic_complexity: int = 0
    cognitive_complexity: int = 0
    lines_of_code: int = 0
    function_count: int = 0
    export_count: int = 0
    import_count: int = 0
    type_coverage: float = Field(default=0.0, ge=0.0, le=100.0)
    has_any_types: bool = False
    complexity_rating: str = "low"  # low, moderate, high, very-high


class ReactComponentAnalysis(BaseModel):
    """React-specific analysis for a component."""
    component_name: str
    file_path: str
    is_functional: bool = True
    uses_memo: bool = False
    uses_callback: bool = False
    prop_count: int = 0
    state_count: int = 0
    effect_count: int = 0
    re_render_risk: str = "low"  # low, moderate, high
    suggestions: List[str] = Field(default_factory=list)


class OptimizationStrategy(BaseModel):
    """An optimization strategy recommendation."""
    title: str
    description: str
    category: str  # tree-shaking, code-splitting, memoization, lazy-loading, etc.
    estimated_impact: str = "unknown"  # low, medium, high
    affected_files: List[str] = Field(default_factory=list)
    before_example: str = ""
    after_example: str = ""


class BundleAnalysis(BaseModel):
    """Bundle analysis results."""
    package: str
    total_size_kb: float = 0.0
    tree_shakeable: bool = True
    unused_exports: List[str] = Field(default_factory=list)
    large_dependencies: List[Dict[str, float]] = Field(default_factory=list)
    code_split_opportunities: List[str] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    """Complete analysis result from the TypeScript Code Agent."""
    mode: AnalysisMode
    issues: List[CodeIssue] = Field(default_factory=list)
    complexity: Optional[ComplexityAnalysis] = None
    react_analysis: List[ReactComponentAnalysis] = Field(default_factory=list)
    optimizations: List[OptimizationStrategy] = Field(default_factory=list)
    bundle_analysis: Optional[BundleAnalysis] = None
    summary: str = ""
    files_analyzed: int = 0

    @property
    def critical_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == IssueSeverity.CRITICAL)

    @property
    def fixable_count(self) -> int:
        return sum(1 for i in self.issues if i.auto_fixable)
