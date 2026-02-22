"""
Models for Bundle Optimizer Agent — Notesnook monorepo.

Adapted from RIGGWIRE-EA-LIVE blitzfire_cpp_optimizer/models.py.
Refactored from C++ SIMD/cache optimization to JS/TS bundle optimization.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class OptimizationLevel(str, Enum):
    """Bundle optimization levels."""
    QUICK = "quick"          # Low-hanging fruit (unused imports, dead code)
    STANDARD = "standard"    # Tree-shaking, code splitting
    AGGRESSIVE = "aggressive"  # Dynamic imports, lazy loading, chunk splitting


class BundleMetrics(BaseModel):
    """Bundle size metrics for a package or app."""
    package: str
    total_size_kb: float = 0.0
    gzipped_size_kb: float = 0.0
    chunk_count: int = 0
    largest_chunk_kb: float = 0.0
    dependency_count: int = 0
    tree_shakeable: bool = True


class TreeShakingReport(BaseModel):
    """Tree-shaking analysis report."""
    package: str
    unused_exports: List[str] = Field(default_factory=list)
    side_effect_imports: List[str] = Field(default_factory=list)
    barrel_files: List[str] = Field(default_factory=list)  # index.ts re-export files
    recommendations: List[str] = Field(default_factory=list)


class CodeSplittingOpportunity(BaseModel):
    """A code splitting opportunity."""
    file_path: str
    description: str
    estimated_savings_kb: float = 0.0
    implementation: str = ""  # e.g., "Convert to dynamic import: import('./heavy-module')"


class OptimizationRecommendation(BaseModel):
    """A bundle optimization recommendation."""
    title: str
    description: str
    level: OptimizationLevel
    estimated_impact_kb: float = 0.0
    affected_packages: List[str] = Field(default_factory=list)
    before_example: str = ""
    after_example: str = ""
    priority: str = "medium"  # low, medium, high


class BundleOptimizationResult(BaseModel):
    """Complete bundle optimization analysis result."""
    metrics: List[BundleMetrics] = Field(default_factory=list)
    tree_shaking: List[TreeShakingReport] = Field(default_factory=list)
    code_splitting: List[CodeSplittingOpportunity] = Field(default_factory=list)
    recommendations: List[OptimizationRecommendation] = Field(default_factory=list)
    total_potential_savings_kb: float = 0.0
    summary: str = ""
