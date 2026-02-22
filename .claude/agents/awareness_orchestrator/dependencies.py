"""
Dependencies for Awareness Orchestrator — Notesnook TypeScript/React monorepo.

Adapted from RIGGWIRE-EA-LIVE awareness_orchestrator/dependencies.py.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class OrchestrationDeps:
    """Dependencies injected into the orchestrator agent context."""

    # Project paths
    project_root: str = "."

    # Lazy-initialized components
    _pattern_system: Any = field(default=None, repr=False)
    _suggestions_engine: Any = field(default=None, repr=False)
    _metrics_dashboard: Any = field(default=None, repr=False)
    _progress_reporter: Any = field(default=None, repr=False)

    # Runtime state
    changed_files: List[str] = field(default_factory=list)
    target_packages: List[str] = field(default_factory=lambda: ["core"])
    session_metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def pattern_system(self):
        """Lazy-init pattern recognition system."""
        if self._pattern_system is None:
            self._pattern_system = PatternRecognitionSystem(self.project_root)
        return self._pattern_system

    @property
    def suggestions_engine(self):
        """Lazy-init proactive suggestions engine."""
        if self._suggestions_engine is None:
            self._suggestions_engine = ProactiveSuggestionsEngine(self.project_root)
        return self._suggestions_engine

    @property
    def metrics_dashboard(self):
        """Lazy-init metrics dashboard."""
        if self._metrics_dashboard is None:
            self._metrics_dashboard = MetricsDashboard(self.project_root)
        return self._metrics_dashboard

    @property
    def progress_reporter(self):
        """Lazy-init progress reporter."""
        if self._progress_reporter is None:
            self._progress_reporter = ProgressReporter()
        return self._progress_reporter

    @classmethod
    def create_default(cls, project_root: Optional[str] = None) -> "OrchestrationDeps":
        """Create dependencies with auto-detected project paths."""
        if project_root is None:
            # Try to find project root by looking for package.json
            current = Path.cwd()
            while current != current.parent:
                if (current / "package.json").exists() and (current / "packages").exists():
                    project_root = str(current)
                    break
                current = current.parent
            else:
                project_root = "."

        return cls(project_root=project_root)


class PatternRecognitionSystem:
    """Recognizes recurring code patterns across analysis sessions."""

    def __init__(self, project_root: str):
        self.project_root = project_root
        self.patterns: List[Dict[str, Any]] = []
        self._patterns_file = Path(project_root) / ".claude" / "patterns.json"

    def load_patterns(self) -> List[Dict[str, Any]]:
        """Load patterns from persistent storage."""
        if self._patterns_file.exists():
            import json
            with open(self._patterns_file) as f:
                data = json.load(f)
                return data.get("patterns", [])
        return []

    def record_pattern(self, name: str, description: str, agent_sequence: List[str]):
        """Record a new pattern or increment an existing one."""
        for p in self.patterns:
            if p["name"] == name:
                p["occurrences"] = p.get("occurrences", 0) + 1
                return
        self.patterns.append({
            "name": name,
            "description": description,
            "agent_sequence": agent_sequence,
            "occurrences": 1
        })


class ProactiveSuggestionsEngine:
    """Generates proactive code improvement suggestions."""

    def __init__(self, project_root: str):
        self.project_root = project_root

    def get_suggestions(self, context: Dict[str, Any]) -> List[Dict[str, str]]:
        """Generate suggestions based on current analysis context."""
        suggestions = []

        # Check for common Notesnook patterns
        target_packages = context.get("target_packages", [])

        if "core" in target_packages:
            suggestions.append({
                "title": "Verify encryption flow",
                "description": "Changes to core may affect encryption pipeline. Run crypto validation."
            })

        if "editor" in target_packages:
            suggestions.append({
                "title": "Check editor snapshot tests",
                "description": "Editor changes may require updating test snapshots."
            })

        return suggestions


class MetricsDashboard:
    """Tracks and reports code quality metrics."""

    def __init__(self, project_root: str):
        self.project_root = project_root
        self.metrics: Dict[str, Any] = {}

    def record_metric(self, name: str, value: float, unit: str = "", package: str = ""):
        """Record a metric value."""
        self.metrics[name] = {
            "value": value,
            "unit": unit,
            "package": package
        }

    def get_summary(self) -> Dict[str, Any]:
        """Get metrics summary."""
        return self.metrics


class ProgressReporter:
    """Reports progress of orchestration operations."""

    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def report(self, stage: str, message: str, progress: float = 0.0):
        """Report progress."""
        event = {"stage": stage, "message": message, "progress": progress}
        self.events.append(event)
        logger.info(f"[{stage}] {message} ({progress:.0%})")
