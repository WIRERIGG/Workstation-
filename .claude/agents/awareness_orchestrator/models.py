"""
Models for the Awareness Orchestrator — Notesnook TypeScript/React monorepo.

Adapted from RIGGWIRE-EA-LIVE awareness_orchestrator/models.py.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Any, Optional
from datetime import datetime


class Severity(str, Enum):
    """Severity levels for findings."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AgentType(str, Enum):
    """Types of specialized agents available."""
    TYPESCRIPT_CODE = "typescript_code"
    ESLINT_AI = "eslint_ai"
    BUNDLE_OPTIMIZER = "bundle_optimizer"
    CORE_RELIABILITY = "core_reliability"
    DEBUG_SYSTEM = "debug_system"
    BUILD_RESOLVER = "build_resolver"
    PERFORMANCE_PROFILER = "performance_profiler"
    ANALYSIS = "analysis"          # Internal sub-agent
    ARCHITECTURE = "architecture"   # Internal sub-agent
    VALIDATION = "validation"       # Internal sub-agent


@dataclass
class Finding:
    """A single finding from code analysis."""
    title: str
    description: str
    severity: Severity
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    agent_source: str = ""
    category: str = ""  # lint, type-error, performance, security, test, etc.
    suggestion: str = ""
    auto_fixable: bool = False


@dataclass
class AgentFindings:
    """Findings from a single agent run."""
    agent_type: AgentType
    findings: List[Finding] = field(default_factory=list)
    execution_time_ms: float = 0.0
    success: bool = True
    error_message: str = ""

    @property
    def critical_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == Severity.CRITICAL)

    @property
    def high_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == Severity.HIGH)


@dataclass
class OrchestrationContext:
    """Context for orchestrating multiple agents."""
    project_root: str = "."
    target_packages: List[str] = field(default_factory=lambda: ["core"])
    target_files: List[str] = field(default_factory=list)
    code_type: str = "typescript"  # typescript, react, react-native
    run_id: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    previous_findings: List[AgentFindings] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OrchestrationResult:
    """Complete result of an orchestration run."""
    context: OrchestrationContext
    agent_results: Dict[str, AgentFindings] = field(default_factory=dict)
    total_findings: int = 0
    critical_findings: int = 0
    success: bool = True
    execution_time_ms: float = 0.0
    summary: str = ""

    def add_agent_result(self, agent_type: str, findings: AgentFindings):
        """Add results from an agent."""
        self.agent_results[agent_type] = findings
        self.total_findings += len(findings.findings)
        self.critical_findings += findings.critical_count


@dataclass
class BuildResult:
    """Result of a build operation."""
    success: bool
    command: str
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    duration_ms: float = 0.0
    package: str = ""


@dataclass
class TestResult:
    """Result of a test run."""
    success: bool
    total_tests: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    duration_ms: float = 0.0
    failures: List[Dict[str, str]] = field(default_factory=list)
    package: str = "core"


@dataclass
class ValidationResult:
    """Result of validation checks."""
    is_valid: bool
    checks_passed: List[str] = field(default_factory=list)
    checks_failed: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class Pattern:
    """A recognized code pattern."""
    name: str
    description: str
    occurrences: int = 0
    success_rate: float = 0.0
    agent_sequence: List[str] = field(default_factory=list)


@dataclass
class Suggestion:
    """A proactive suggestion for code improvement."""
    title: str
    description: str
    priority: Severity = Severity.MEDIUM
    category: str = ""
    affected_packages: List[str] = field(default_factory=list)
    estimated_impact: str = ""


@dataclass
class Metric:
    """A measurable code quality metric."""
    name: str
    value: float
    unit: str = ""
    package: str = ""
    trend: str = "stable"  # improving, stable, degrading
    threshold: Optional[float] = None

    @property
    def exceeds_threshold(self) -> bool:
        if self.threshold is None:
            return False
        return self.value > self.threshold
