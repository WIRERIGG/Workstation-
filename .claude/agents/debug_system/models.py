"""
Models for Debug System — Notesnook monorepo.

Adapted from RIGGWIRE-EA-LIVE multi_agent_debugging_system/models.py.
Refactored from GDB/Valgrind/Strace to Node.js/React debugging tools.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class DebugTool(str, Enum):
    """Available debugging tools."""
    NODE_INSPECT = "node_inspect"     # Node.js debugger
    CONSOLE_TRACE = "console_trace"    # Console-based tracing
    REACT_PROFILER = "react_profiler"  # React DevTools Profiler
    HEAP_SNAPSHOT = "heap_snapshot"     # V8 heap snapshots
    CPU_PROFILE = "cpu_profile"        # V8 CPU profiling
    NETWORK_TRACE = "network_trace"    # Network request tracing
    SOURCE_MAPS = "source_maps"        # Source map analysis
    STACK_TRACE = "stack_trace"        # Error stack trace analysis


class DebugMode(str, Enum):
    """Debug analysis modes."""
    CRASH = "crash"            # Analyze crash/exception
    PERFORMANCE = "performance"  # Performance bottleneck
    MEMORY = "memory"          # Memory leak investigation
    NETWORK = "network"        # Network/sync issues
    RENDER = "render"          # React rendering issues
    FULL = "full"              # Comprehensive debugging


class DebugFinding(BaseModel):
    """A finding from debugging analysis."""
    tool: DebugTool
    title: str
    description: str
    severity: str = "medium"  # critical, high, medium, low
    file_path: str = ""
    line_number: Optional[int] = None
    stack_trace: str = ""
    suggestion: str = ""


class DebugSession(BaseModel):
    """A debugging session with multiple findings."""
    mode: DebugMode
    tools_used: List[DebugTool] = Field(default_factory=list)
    findings: List[DebugFinding] = Field(default_factory=list)
    root_cause: str = ""
    resolution: str = ""
    duration_ms: float = 0.0


class ErrorAnalysis(BaseModel):
    """Analysis of a runtime error."""
    error_type: str = ""       # TypeError, RangeError, etc.
    error_message: str = ""
    stack_frames: List[Dict[str, str]] = Field(default_factory=list)
    likely_cause: str = ""
    affected_package: str = ""
    suggested_fix: str = ""


class PerformanceBottleneck(BaseModel):
    """A detected performance bottleneck."""
    location: str              # File and function
    description: str
    metric: str = ""           # e.g., "render time", "API latency"
    current_value: float = 0.0
    expected_value: float = 0.0
    unit: str = "ms"
    optimization_suggestion: str = ""
