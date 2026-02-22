"""
Multi-Agent Debugging System - A PydanticAI-based C++ code analysis framework.

This package provides a sophisticated multi-agent system for comprehensive C++ code
analysis using debugging tools like gdb, strace, ltrace, perf, cppcheck, clang-tidy,
and valgrind.

Key Components:
- Lead Agent: Orchestrates the debugging workflow
- Tool Agents: Specialized agents for each debugging tool
- Detail Agent: Correlates findings across tools
- Plan Agent: Creates optimal execution strategies

Usage:
    from multi_agent_debugging_system import analyze_cpp_code

    # Analyze C++ code
    result = await analyze_cpp_code(
        target_path="example.cpp",
        analysis_mode="comprehensive"
    )

    print(result.human_readable_report)
"""

from .agent import (
    analyze_cpp_code,
    MultiAgentDebugger,
    AnalysisResult,
    AnalysisRequest
)

from .dependencies import (
    DebuggingContext,
    AnalysisMode,
    ToolType,
    create_debugging_context
)

from .settings import settings

__version__ = "1.0.0"
__author__ = "Multi-Agent Debugging System Team"

__all__ = [
    "analyze_cpp_code",
    "MultiAgentDebugger",
    "AnalysisResult",
    "AnalysisRequest",
    "DebuggingContext",
    "AnalysisMode",
    "ToolType",
    "create_debugging_context",
    "settings"
]