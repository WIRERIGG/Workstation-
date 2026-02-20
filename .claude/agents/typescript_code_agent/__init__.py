"""TypeScript Code Agent — deep TS/React code analysis for Notesnook."""
from .agent import typescript_agent, analyze_typescript, analyze_typescript_sync
from .models import (
    AnalysisMode, CodeIssue, ComplexityAnalysis,
    OptimizationStrategy, AnalysisResult
)

__all__ = [
    "typescript_agent",
    "analyze_typescript",
    "analyze_typescript_sync",
    "AnalysisMode",
    "CodeIssue",
    "ComplexityAnalysis",
    "OptimizationStrategy",
    "AnalysisResult",
]
