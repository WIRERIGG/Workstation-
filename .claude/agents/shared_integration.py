"""
Shared Integration Module for ESLint AI Agent and Bundle Optimizer
==================================================================

Adapted from RIGGWIRE-EA-LIVE shared_integration.py for Notesnook TypeScript/React monorepo.

This module provides integration between:
- eslint_ai_agent: Code quality, safety, and lint compliance
- bundle_optimizer: Bundle size optimization and React performance

The integration ensures both agents work together in a unified pipeline.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from enum import Enum
import subprocess
import sys

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PipelineStage(Enum):
    """Pipeline stages for the integrated workflow."""
    INITIAL_ANALYSIS = "initial_analysis"
    ESLINT_FIX = "eslint_fix"
    BUNDLE_OPTIMIZE = "bundle_optimize"
    TEST_VALIDATION = "test_validation"
    FINAL_VALIDATION = "final_validation"
    COMPLETE = "complete"


@dataclass
class PipelineConfig:
    """Configuration for the integrated pipeline."""
    # Target paths
    target_package: str = "core"  # Package to analyze (core, editor, web, etc.)
    project_root: str = "."
    output_dir: str = ".claude/agents/pipeline_output"

    # ESLint settings
    eslint_fix: bool = True
    eslint_config: str = ""  # Use project default if empty
    eslint_max_warnings: int = 0

    # Bundle optimization settings
    optimization_level: str = "standard"  # quick, standard, aggressive
    analyze_bundle: bool = True
    check_tree_shaking: bool = True
    check_code_splitting: bool = True

    # Test settings
    run_core_tests: bool = True
    test_command: str = "npm run test:core"

    # Pipeline settings
    validate_after_each_stage: bool = True
    generate_report: bool = True
    strict_mode: bool = True  # Fail if any lint errors remain

    # Integration settings
    max_iterations: int = 3


@dataclass
class PipelineResult:
    """Result of the integrated pipeline execution."""
    success: bool
    stage_completed: PipelineStage

    # Metrics
    lint_errors_fixed: int = 0
    lint_warnings_fixed: int = 0
    bundle_size_reduction: float = 0.0  # Percentage

    # Details
    eslint_report: Dict[str, Any] = field(default_factory=dict)
    optimization_report: Dict[str, Any] = field(default_factory=dict)
    test_report: Dict[str, Any] = field(default_factory=dict)
    validation_report: Dict[str, Any] = field(default_factory=dict)

    # Files modified
    files_modified: List[str] = field(default_factory=list)

    # Errors
    errors: List[str] = field(default_factory=list)


class IntegratedPipeline:
    """
    Unified pipeline orchestrator for ESLint and Bundle Optimization.

    Workflow:
    1. Initial Analysis: Baseline lint status and bundle metrics
    2. ESLint Fix: Auto-fix all lint issues
    3. Bundle Optimize: Analyze and suggest bundle improvements
    4. Test Validation: Run core tests to ensure no regressions
    5. Final Validation: Comprehensive check
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.current_stage = PipelineStage.INITIAL_ANALYSIS
        self.iteration = 0

        # Create output directory
        Path(config.output_dir).mkdir(parents=True, exist_ok=True)

    async def run_pipeline(self) -> PipelineResult:
        """Execute the complete integrated pipeline."""
        result = PipelineResult(success=False, stage_completed=PipelineStage.INITIAL_ANALYSIS)

        try:
            # Stage 1: Initial Analysis
            logger.info("Stage 1: Initial Analysis")
            initial_metrics = await self._run_initial_analysis()
            result.eslint_report['initial'] = initial_metrics

            # Stage 2: ESLint Fix
            logger.info("Stage 2: ESLint Code Quality Fixes")
            self.current_stage = PipelineStage.ESLINT_FIX

            eslint_result = await self._run_eslint_fixes()
            result.eslint_report['fixes'] = eslint_result
            result.lint_errors_fixed = eslint_result.get('errors_fixed', 0)
            result.lint_warnings_fixed = eslint_result.get('warnings_fixed', 0)

            if self.config.validate_after_each_stage:
                if not await self._validate_eslint():
                    result.errors.append("ESLint validation failed after fix")
                    if self.config.strict_mode:
                        return result

            # Stage 3: Bundle Optimization Analysis
            logger.info("Stage 3: Bundle Optimization Analysis")
            self.current_stage = PipelineStage.BUNDLE_OPTIMIZE

            optimization_result = await self._run_bundle_analysis()
            result.optimization_report = optimization_result

            # Stage 4: Test Validation
            if self.config.run_core_tests:
                logger.info("Stage 4: Test Validation")
                self.current_stage = PipelineStage.TEST_VALIDATION

                test_result = await self._run_tests()
                result.test_report = test_result

                if not test_result.get('success', False):
                    result.errors.append("Core tests failed after changes")
                    if self.config.strict_mode:
                        return result

            # Stage 5: Final Validation
            logger.info("Stage 5: Final Validation")
            self.current_stage = PipelineStage.FINAL_VALIDATION

            final_validation = await self._run_final_validation()
            result.validation_report = final_validation

            if final_validation.get('lint_clean', False) and \
               final_validation.get('tests_pass', False):
                result.success = True
                result.stage_completed = PipelineStage.COMPLETE
                logger.info("Pipeline completed successfully!")
            else:
                result.errors.append("Final validation failed")

            # Generate report
            if self.config.generate_report:
                await self._generate_report(result)

        except Exception as e:
            logger.error(f"Pipeline failed with error: {e}")
            result.errors.append(str(e))

        return result

    async def _run_initial_analysis(self) -> Dict[str, Any]:
        """Run initial ESLint analysis to get baseline metrics."""
        target = f"./apps/ ./packages/"
        cmd = f"npx eslint {target} --format json 2>/dev/null || true"
        proc = subprocess.run(cmd, capture_output=True, text=True, shell=True,
                              cwd=self.config.project_root)
        try:
            lint_output = json.loads(proc.stdout) if proc.stdout.strip() else []
            total_errors = sum(f.get('errorCount', 0) for f in lint_output)
            total_warnings = sum(f.get('warningCount', 0) for f in lint_output)
            return {
                "total_errors": total_errors,
                "total_warnings": total_warnings,
                "files_with_issues": len([f for f in lint_output if f.get('errorCount', 0) > 0 or f.get('warningCount', 0) > 0])
            }
        except json.JSONDecodeError:
            return {"raw_output": proc.stdout[:2000], "parse_error": True}

    async def _run_eslint_fixes(self) -> Dict[str, Any]:
        """Apply ESLint auto-fixes."""
        target = f"./apps/ ./packages/"
        cmd = f"npx eslint {target} --fix --format json 2>/dev/null || true"
        proc = subprocess.run(cmd, capture_output=True, text=True, shell=True,
                              cwd=self.config.project_root)
        return {"success": proc.returncode == 0, "output": proc.stdout[:2000]}

    async def _run_bundle_analysis(self) -> Dict[str, Any]:
        """Analyze bundle size and optimization opportunities."""
        # This is an analysis step — actual optimization recommendations
        # would come from the bundle_optimizer agent
        return {
            "analyzed": True,
            "target_package": self.config.target_package,
            "recommendations": [
                "Check for unused imports with tree-shaking",
                "Verify code splitting boundaries",
                "Review dynamic import usage"
            ]
        }

    async def _run_tests(self) -> Dict[str, Any]:
        """Run core tests."""
        cmd = self.config.test_command
        proc = subprocess.run(cmd, capture_output=True, text=True, shell=True,
                              cwd=self.config.project_root)
        return {
            "success": proc.returncode == 0,
            "output": proc.stdout[-2000:] if proc.stdout else "",
            "errors": proc.stderr[-1000:] if proc.stderr else ""
        }

    async def _validate_eslint(self) -> bool:
        """Validate no ESLint errors remain."""
        analysis = await self._run_initial_analysis()
        return analysis.get('total_errors', 1) == 0

    async def _run_final_validation(self) -> Dict[str, Any]:
        """Run comprehensive final validation."""
        validation = {
            "lint_clean": False,
            "tests_pass": False,
        }

        # Check lint
        analysis = await self._run_initial_analysis()
        validation["lint_clean"] = analysis.get('total_errors', 1) == 0

        # Check tests
        if self.config.run_core_tests:
            test_result = await self._run_tests()
            validation["tests_pass"] = test_result.get('success', False)
        else:
            validation["tests_pass"] = True

        return validation

    async def _generate_report(self, result: PipelineResult):
        """Generate detailed pipeline execution report."""
        report_path = f"{self.config.output_dir}/pipeline_report.json"

        report = {
            "success": result.success,
            "stage_completed": result.stage_completed.value,
            "metrics": {
                "lint_errors_fixed": result.lint_errors_fixed,
                "lint_warnings_fixed": result.lint_warnings_fixed,
                "bundle_size_reduction": f"{result.bundle_size_reduction}%"
            },
            "details": {
                "eslint": result.eslint_report,
                "optimization": result.optimization_report,
                "tests": result.test_report,
                "validation": result.validation_report
            },
            "files_modified": result.files_modified,
            "errors": result.errors
        }

        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)

        logger.info(f"Report saved to: {report_path}")


# Convenience functions

async def lint_and_optimize(
    project_root: str = ".",
    target_package: str = "core",
    strict: bool = True
) -> PipelineResult:
    """
    Run the complete lint + optimization pipeline.

    Args:
        project_root: Path to Notesnook monorepo root
        target_package: Package to focus on (core, editor, web, etc.)
        strict: Fail if any lint errors remain

    Returns:
        PipelineResult with execution details
    """
    config = PipelineConfig(
        project_root=project_root,
        target_package=target_package,
        strict_mode=strict
    )

    pipeline = IntegratedPipeline(config)
    return await pipeline.run_pipeline()


def lint_and_optimize_sync(
    project_root: str = ".",
    target_package: str = "core",
    strict: bool = True
) -> PipelineResult:
    """Synchronous wrapper for lint_and_optimize."""
    return asyncio.run(lint_and_optimize(project_root, target_package, strict))


INTEGRATION_ENABLED = True
PIPELINE_VERSION = "1.0.0"

__all__ = [
    "PipelineConfig",
    "PipelineResult",
    "PipelineStage",
    "IntegratedPipeline",
    "lint_and_optimize",
    "lint_and_optimize_sync",
    "INTEGRATION_ENABLED",
    "PIPELINE_VERSION"
]
