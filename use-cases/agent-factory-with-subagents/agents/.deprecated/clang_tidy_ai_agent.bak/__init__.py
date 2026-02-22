"""AI-Enhanced Clang-Tidy Agent - Intelligent code quality assistant with conversational interface."""

from .agent import ClangTidyAI, clang_tidy_agent
from .settings import load_settings
from .models import (
    ClangTidyAnalysis,
    Warning, 
    WarningExplanation,
    FixRecommendation,
    ProjectAnalysis
)

__version__ = "1.0.0"
__author__ = "AI Agent Factory"
__description__ = "AI-Enhanced Clang-Tidy Assistant with conversational interface and intelligent fix recommendations"

# Main exports
__all__ = [
    "ClangTidyAI",
    "clang_tidy_agent", 
    "load_settings",
    "ClangTidyAnalysis",
    "Warning",
    "WarningExplanation", 
    "FixRecommendation",
    "ProjectAnalysis"
]