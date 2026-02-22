"""
Models for Performance Profiler — Notesnook monorepo.

Adapted from RIGGWIRE-EA-LIVE valgrind_pydantic_tool/models.py.
Refactored from Valgrind C++ memory analysis to Node.js/React profiling.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class ProfilerTool(str, Enum):
    """Available profiling tools."""
    V8_HEAP = "v8_heap"              # V8 heap snapshot analysis
    V8_CPU = "v8_cpu"                # V8 CPU profiling
    CLINIC_DOCTOR = "clinic_doctor"  # Node Clinic Doctor
    CLINIC_FLAME = "clinic_flame"    # Node Clinic Flame
    LIGHTHOUSE = "lighthouse"         # Web performance audit
    REACT_PROFILER = "react_profiler"  # React DevTools profiler
    BUNDLE_ANALYZER = "bundle_analyzer"  # Webpack/Vite bundle analysis


class MemoryIssueCategory(str, Enum):
    """Categories of memory issues."""
    LEAK = "leak"                    # Memory not freed
    GROWING_ARRAY = "growing_array"  # Unbounded array growth
    CLOSURE_LEAK = "closure_leak"    # Closure retaining references
    EVENT_LISTENER = "event_listener"  # Unremoved event listeners
    CACHE_UNBOUNDED = "cache_unbounded"  # Cache without eviction
    LARGE_OBJECT = "large_object"    # Unexpectedly large objects
    DOM_DETACHED = "dom_detached"    # Detached DOM nodes


class MemoryIssue(BaseModel):
    """A detected memory issue."""
    category: MemoryIssueCategory
    description: str
    severity: str = "medium"
    file_path: str = ""
    retained_size_kb: float = 0.0
    suggestion: str = ""


class CPUHotspot(BaseModel):
    """A CPU hotspot from profiling."""
    function_name: str
    file_path: str
    self_time_ms: float = 0.0
    total_time_ms: float = 0.0
    call_count: int = 0
    optimization_suggestion: str = ""


class RenderMetrics(BaseModel):
    """React render performance metrics."""
    component_name: str
    render_count: int = 0
    avg_render_time_ms: float = 0.0
    max_render_time_ms: float = 0.0
    unnecessary_renders: int = 0
    suggestion: str = ""


class PerformanceReport(BaseModel):
    """Complete performance profiling report."""
    tools_used: List[ProfilerTool] = Field(default_factory=list)
    memory_issues: List[MemoryIssue] = Field(default_factory=list)
    cpu_hotspots: List[CPUHotspot] = Field(default_factory=list)
    render_metrics: List[RenderMetrics] = Field(default_factory=list)
    heap_size_mb: float = 0.0
    peak_heap_mb: float = 0.0
    gc_time_ms: float = 0.0
    summary: str = ""

    @property
    def critical_issues(self) -> int:
        return sum(1 for i in self.memory_issues if i.severity == "critical")
