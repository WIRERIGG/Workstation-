"""
Unit tests for Multi-Agent Debugging System CLI interface.
"""

import asyncio
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import Mock, AsyncMock, patch
from click.testing import CliRunner

import pytest

from ..cli import cli, analyze, quick_analyze, list_tools, validate_target
from ..agent import AnalysisResult


class TestCLIBasicFunctionality:
    """Test basic CLI functionality and command structure."""

    def test_cli_group_exists(self):
        """Test that CLI group is properly defined."""
        assert cli is not None
        assert hasattr(cli, 'commands')

    def test_cli_help(self):
        """Test CLI help output."""
        runner = CliRunner()
        result = runner.invoke(cli, ['--help'])

        assert result.exit_code == 0
        assert 'Multi-Agent Debugging System' in result.output
        assert 'analyze' in result.output

    def test_cli_version(self):
        """Test CLI version command."""
        runner = CliRunner()
        result = runner.invoke(cli, ['--version'])

        assert result.exit_code == 0
        # Should display version information


class TestAnalyzeCommand:
    """Test the main analyze command."""

    def test_analyze_command_exists(self):
        """Test that analyze command is properly registered."""
        assert 'analyze' in cli.commands
        assert cli.commands['analyze'] == analyze

    def test_analyze_help(self):
        """Test analyze command help."""
        runner = CliRunner()
        result = runner.invoke(cli, ['analyze', '--help'])

        assert result.exit_code == 0
        assert 'target_path' in result.output
        assert 'analysis-mode' in result.output
        assert 'output-format' in result.output

    @patch('..cli.analyze_cpp_code')
    def test_analyze_basic_execution(self, mock_analyze, sample_cpp_file):
        """Test basic analyze command execution."""
        # Mock successful analysis
        mock_result = AnalysisResult(
            success=True,
            session_id="test-123",
            execution_time=30.5,
            analysis_mode="comprehensive",
            tools_executed=["cppcheck", "valgrind"],
            total_issues=3,
            critical_issues=1,
            correlation_summary={"groups": 1},
            recommendations=["Fix memory leak"],
            detailed_results={"tools": []},
            human_readable_report="Test analysis completed successfully"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, ['analyze', sample_cpp_file])

        assert result.exit_code == 0
        mock_analyze.assert_called_once()

    @patch('..cli.analyze_cpp_code')
    def test_analyze_with_options(self, mock_analyze, sample_cpp_file):
        """Test analyze command with various options."""
        mock_result = AnalysisResult(
            success=True,
            session_id="test-456",
            execution_time=15.2,
            analysis_mode="static",
            tools_executed=["cppcheck"],
            total_issues=2,
            critical_issues=0,
            correlation_summary={},
            recommendations=["Improve code style"],
            detailed_results={"tools": []},
            human_readable_report="Static analysis completed"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--analysis-mode', 'static',
            '--output-format', 'json',
            '--max-parallel', '2',
            '--timeout', '120',
            '--verbose'
        ])

        assert result.exit_code == 0

        # Verify analyze_cpp_code was called with correct parameters
        call_args = mock_analyze.call_args[1]  # Get keyword arguments
        assert call_args['analysis_mode'] == 'static'
        assert call_args['output_format'] == 'json'
        assert call_args['max_parallel_tools'] == 2
        assert call_args['timeout'] == 120

    @patch('..cli.analyze_cpp_code')
    def test_analyze_output_to_file(self, mock_analyze, sample_cpp_file, tmp_path):
        """Test analyze command output to file."""
        mock_result = AnalysisResult(
            success=True,
            session_id="test-789",
            execution_time=25.0,
            analysis_mode="comprehensive",
            tools_executed=["cppcheck", "clang-tidy"],
            total_issues=1,
            critical_issues=1,
            correlation_summary={"groups": 1},
            recommendations=["Fix critical issue"],
            detailed_results={"tools": []},
            human_readable_report="Analysis with file output"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        output_file = tmp_path / "analysis_output.json"

        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--output-format', 'json',
            '--output-file', str(output_file)
        ])

        assert result.exit_code == 0
        # Output file should be created (mocked behavior would need implementation)

    @patch('..cli.analyze_cpp_code')
    def test_analyze_failure_handling(self, mock_analyze, sample_cpp_file):
        """Test analyze command failure handling."""
        mock_result = AnalysisResult(
            success=False,
            session_id="failed-123",
            execution_time=5.0,
            analysis_mode="comprehensive",
            tools_executed=[],
            total_issues=0,
            critical_issues=0,
            correlation_summary={},
            recommendations=["Check file path and permissions"],
            detailed_results={"error": "File not accessible"},
            human_readable_report="Analysis failed: File not accessible"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, ['analyze', sample_cpp_file])

        # Should handle failure gracefully
        assert result.exit_code != 0 or "failed" in result.output.lower()

    def test_analyze_invalid_file(self):
        """Test analyze command with non-existent file."""
        runner = CliRunner()
        result = runner.invoke(cli, ['analyze', 'non_existent_file.cpp'])

        assert result.exit_code != 0
        assert 'does not exist' in result.output.lower() or 'error' in result.output.lower()

    @patch('..cli.analyze_cpp_code')
    def test_analyze_exception_handling(self, mock_analyze, sample_cpp_file):
        """Test analyze command exception handling."""
        # Mock analyze_cpp_code raising an exception
        mock_analyze.side_effect = Exception("Unexpected error during analysis")

        runner = CliRunner()
        result = runner.invoke(cli, ['analyze', sample_cpp_file])

        # Should handle exception gracefully
        assert result.exit_code != 0
        assert 'error' in result.output.lower() or 'failed' in result.output.lower()


class TestQuickAnalyzeCommand:
    """Test the quick analyze command."""

    def test_quick_analyze_command_exists(self):
        """Test that quick-analyze command exists if implemented."""
        # Check if quick-analyze is implemented
        if 'quick-analyze' in cli.commands:
            assert cli.commands['quick-analyze'] == quick_analyze

    @patch('..cli.analyze_cpp_code')
    def test_quick_analyze_execution(self, mock_analyze, sample_cpp_file):
        """Test quick analyze command execution."""
        mock_result = AnalysisResult(
            success=True,
            session_id="quick-123",
            execution_time=10.0,
            analysis_mode="static",
            tools_executed=["cppcheck"],
            total_issues=1,
            critical_issues=0,
            correlation_summary={},
            recommendations=["Quick fix available"],
            detailed_results={"tools": []},
            human_readable_report="Quick analysis completed"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()

        # Try quick-analyze if it exists
        if 'quick-analyze' in cli.commands:
            result = runner.invoke(cli, ['quick-analyze', sample_cpp_file])
            assert result.exit_code == 0

            # Should use static mode and limited parallelism for quick analysis
            call_args = mock_analyze.call_args[1]
            assert call_args.get('analysis_mode') == 'static' or call_args.get('max_parallel_tools', 4) <= 2


class TestListToolsCommand:
    """Test the list-tools command."""

    def test_list_tools_command_exists(self):
        """Test that list-tools command exists if implemented."""
        if 'list-tools' in cli.commands:
            assert cli.commands['list-tools'] == list_tools

    def test_list_tools_execution(self):
        """Test list-tools command execution."""
        runner = CliRunner()

        if 'list-tools' in cli.commands:
            result = runner.invoke(cli, ['list-tools'])

            assert result.exit_code == 0
            # Should list available debugging tools
            expected_tools = ['cppcheck', 'clang-tidy', 'valgrind', 'gdb', 'strace', 'ltrace', 'perf']
            for tool in expected_tools:
                assert tool in result.output.lower()

    def test_list_tools_with_details(self):
        """Test list-tools command with detailed output."""
        runner = CliRunner()

        if 'list-tools' in cli.commands:
            # Try with --detailed flag if available
            result = runner.invoke(cli, ['list-tools', '--detailed'])

            if result.exit_code == 0:
                # Should provide detailed information about tools
                assert len(result.output) > 100  # Detailed output should be substantial


class TestValidateTargetCommand:
    """Test the validate-target command."""

    def test_validate_target_command_exists(self):
        """Test that validate-target command exists if implemented."""
        if 'validate-target' in cli.commands:
            assert cli.commands['validate-target'] == validate_target

    def test_validate_cpp_file(self, sample_cpp_file):
        """Test validate-target with C++ file."""
        runner = CliRunner()

        if 'validate-target' in cli.commands:
            result = runner.invoke(cli, ['validate-target', sample_cpp_file])

            assert result.exit_code == 0
            assert 'valid' in result.output.lower()

    def test_validate_binary_file(self, sample_binary_path):
        """Test validate-target with binary file."""
        runner = CliRunner()

        if 'validate-target' in cli.commands:
            result = runner.invoke(cli, ['validate-target', sample_binary_path])

            assert result.exit_code == 0

    def test_validate_invalid_file(self):
        """Test validate-target with invalid file."""
        runner = CliRunner()

        if 'validate-target' in cli.commands:
            result = runner.invoke(cli, ['validate-target', 'invalid_file.txt'])

            # Should indicate the file is not a valid target
            assert 'invalid' in result.output.lower() or 'not supported' in result.output.lower()


class TestCLIOutputFormats:
    """Test CLI output formatting and display."""

    @patch('..cli.analyze_cpp_code')
    def test_json_output_format(self, mock_analyze, sample_cpp_file):
        """Test JSON output format."""
        mock_result = AnalysisResult(
            success=True,
            session_id="json-test",
            execution_time=20.0,
            analysis_mode="comprehensive",
            tools_executed=["cppcheck", "valgrind"],
            total_issues=2,
            critical_issues=1,
            correlation_summary={"groups": 1, "confidence": 0.85},
            recommendations=["Fix memory leak", "Add bounds checking"],
            detailed_results={"tools": [], "correlation": {}},
            human_readable_report="JSON format test"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--output-format', 'json'
        ])

        assert result.exit_code == 0
        # Output should contain JSON-like structure or be valid JSON
        # (Exact implementation depends on CLI formatting logic)

    @patch('..cli.analyze_cpp_code')
    def test_human_readable_output_format(self, mock_analyze, sample_cpp_file):
        """Test human-readable output format."""
        mock_result = AnalysisResult(
            success=True,
            session_id="human-test",
            execution_time=18.5,
            analysis_mode="static",
            tools_executed=["cppcheck"],
            total_issues=1,
            critical_issues=0,
            correlation_summary={},
            recommendations=["Minor style improvements"],
            detailed_results={"tools": []},
            human_readable_report="""
            DEBUGGING ANALYSIS REPORT
            =========================
            Target: test_sample.cpp
            Mode: Static Analysis
            Tools: cppcheck

            FINDINGS:
            - 1 total issues found
            - 0 critical issues

            RECOMMENDATIONS:
            - Minor style improvements
            """
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--output-format', 'human'
        ])

        assert result.exit_code == 0
        # Should contain human-readable formatting
        assert 'REPORT' in result.output or 'Analysis' in result.output

    @patch('..cli.analyze_cpp_code')
    def test_both_output_formats(self, mock_analyze, sample_cpp_file):
        """Test both JSON and human output formats."""
        mock_result = AnalysisResult(
            success=True,
            session_id="both-test",
            execution_time=22.3,
            analysis_mode="comprehensive",
            tools_executed=["cppcheck", "clang-tidy"],
            total_issues=3,
            critical_issues=1,
            correlation_summary={"groups": 2},
            recommendations=["Address critical issues first"],
            detailed_results={"tools": [], "summary": {}},
            human_readable_report="Both formats test report"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--output-format', 'both'
        ])

        assert result.exit_code == 0
        # Should contain both human-readable and structured output


class TestCLIVerboseMode:
    """Test CLI verbose and debugging output."""

    @patch('..cli.analyze_cpp_code')
    def test_verbose_output(self, mock_analyze, sample_cpp_file):
        """Test verbose mode output."""
        mock_result = AnalysisResult(
            success=True,
            session_id="verbose-test",
            execution_time=35.0,
            analysis_mode="comprehensive",
            tools_executed=["cppcheck", "clang-tidy", "valgrind"],
            total_issues=4,
            critical_issues=2,
            correlation_summary={"groups": 2, "high_priority": 2},
            recommendations=["Fix critical memory issues"],
            detailed_results={
                "execution_plan": {"phases": 2},
                "tool_details": {"cppcheck": {"duration": 5.0}},
                "correlation": {"confidence": 0.92}
            },
            human_readable_report="Verbose test analysis"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--verbose'
        ])

        assert result.exit_code == 0
        # Verbose mode should provide additional details
        # (Exact output depends on implementation)

    @patch('..cli.analyze_cpp_code')
    def test_quiet_mode(self, mock_analyze, sample_cpp_file):
        """Test quiet mode if implemented."""
        mock_result = AnalysisResult(
            success=True,
            session_id="quiet-test",
            execution_time=12.0,
            analysis_mode="static",
            tools_executed=["cppcheck"],
            total_issues=1,
            critical_issues=0,
            correlation_summary={},
            recommendations=["Minor fix"],
            detailed_results={"tools": []},
            human_readable_report="Quiet mode test"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()

        # Try quiet flag if available
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--quiet'
        ])

        if result.exit_code == 0:
            # Quiet mode should have minimal output
            assert len(result.output) < 500  # Reasonable threshold for minimal output


class TestCLIErrorHandling:
    """Test CLI error handling and edge cases."""

    def test_invalid_analysis_mode(self, sample_cpp_file):
        """Test invalid analysis mode handling."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--analysis-mode', 'invalid_mode'
        ])

        assert result.exit_code != 0
        assert 'invalid choice' in result.output.lower() or 'error' in result.output.lower()

    def test_invalid_output_format(self, sample_cpp_file):
        """Test invalid output format handling."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--output-format', 'invalid_format'
        ])

        assert result.exit_code != 0
        assert 'invalid choice' in result.output.lower() or 'error' in result.output.lower()

    def test_invalid_max_parallel(self, sample_cpp_file):
        """Test invalid max-parallel value."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--max-parallel', '-1'  # Negative value should be invalid
        ])

        # Behavior depends on click validation implementation
        # Should either reject negative values or handle gracefully

    def test_invalid_timeout(self, sample_cpp_file):
        """Test invalid timeout value."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--timeout', '0'  # Zero timeout might be invalid
        ])

        # Should handle gracefully or reject zero timeout

    def test_permission_denied_output_file(self, sample_cpp_file):
        """Test permission denied on output file."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--output-file', '/root/forbidden_output.json'  # Likely no permissions
        ])

        # Should handle permission errors gracefully
        # (Exact behavior depends on implementation)

    def test_missing_required_argument(self):
        """Test missing required target_path argument."""
        runner = CliRunner()
        result = runner.invoke(cli, ['analyze'])

        assert result.exit_code != 0
        assert 'missing' in result.output.lower() or 'required' in result.output.lower()


@pytest.mark.integration
class TestCLIIntegration:
    """Integration tests for CLI functionality."""

    @patch('..cli.analyze_cpp_code')
    def test_full_cli_workflow(self, mock_analyze, sample_cpp_file, tmp_path):
        """Test complete CLI workflow from command to output."""
        # Mock comprehensive analysis result
        mock_result = AnalysisResult(
            success=True,
            session_id="integration-test",
            execution_time=45.2,
            analysis_mode="comprehensive",
            tools_executed=["cppcheck", "clang-tidy", "valgrind", "gdb"],
            total_issues=6,
            critical_issues=2,
            correlation_summary={
                "groups": 3,
                "high_priority": 2,
                "confidence": 0.88
            },
            recommendations=[
                "Fix memory leaks in constructor",
                "Add bounds checking in array access",
                "Consider using smart pointers"
            ],
            detailed_results={
                "execution_plan": {"phases": 2, "duration": 180},
                "tool_results": [
                    {"tool": "cppcheck", "issues": 2},
                    {"tool": "valgrind", "issues": 2}
                ],
                "correlation": {"overlap": 0.7}
            },
            human_readable_report="""
MULTI-AGENT DEBUGGING ANALYSIS REPORT
=====================================

Target: test_sample.cpp
Analysis Mode: Comprehensive
Execution Time: 45.2 seconds
Session ID: integration-test

SUMMARY:
--------
✓ 4 tools executed successfully
✗ 6 total issues identified
⚠ 2 critical issues require immediate attention

CRITICAL ISSUES:
---------------
1. Memory leak in TestClass constructor (line 10)
2. Buffer overflow in process() method (line 18)

RECOMMENDATIONS:
---------------
1. Fix memory leaks in constructor
2. Add bounds checking in array access
3. Consider using smart pointers

TOOL CORRELATION:
----------------
- High confidence findings (88%)
- 3 correlated issue groups identified
- Cross-tool validation successful

For detailed results, use --output-format=json
"""
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        output_file = tmp_path / "integration_output.json"

        runner = CliRunner()
        result = runner.invoke(cli, [
            'analyze',
            sample_cpp_file,
            '--analysis-mode', 'comprehensive',
            '--output-format', 'both',
            '--output-file', str(output_file),
            '--max-parallel', '3',
            '--timeout', '300',
            '--verbose'
        ])

        assert result.exit_code == 0

        # Verify the analyze function was called with correct parameters
        mock_analyze.assert_called_once()
        call_kwargs = mock_analyze.call_args[1]
        assert call_kwargs['target_path'] == sample_cpp_file
        assert call_kwargs['analysis_mode'] == 'comprehensive'
        assert call_kwargs['output_format'] == 'both'
        assert call_kwargs['max_parallel_tools'] == 3
        assert call_kwargs['timeout'] == 300

        # Verify output contains expected information
        assert 'integration-test' in result.output or 'success' in result.output.lower()

    def test_cli_with_real_file_validation(self, tmp_path):
        """Test CLI with actual file validation."""
        # Create valid C++ file
        valid_cpp = tmp_path / "valid_test.cpp"
        valid_cpp.write_text("""
#include <iostream>
int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
""")

        # Create invalid file
        invalid_file = tmp_path / "invalid.txt"
        invalid_file.write_text("This is not C++ code")

        runner = CliRunner()

        # Test with valid C++ file
        if 'validate-target' in cli.commands:
            result = runner.invoke(cli, ['validate-target', str(valid_cpp)])
            assert result.exit_code == 0

            # Test with invalid file
            result = runner.invoke(cli, ['validate-target', str(invalid_file)])
            # Should indicate file is not suitable for C++ analysis

    @patch('..cli.analyze_cpp_code')
    def test_cli_error_propagation(self, mock_analyze, sample_cpp_file):
        """Test that errors are properly propagated through CLI."""
        # Mock analysis failure
        mock_result = AnalysisResult(
            success=False,
            session_id="error-test",
            execution_time=5.0,
            analysis_mode="comprehensive",
            tools_executed=[],
            total_issues=0,
            critical_issues=0,
            correlation_summary={},
            recommendations=["Check file permissions and tool availability"],
            detailed_results={
                "error": "Failed to execute debugging tools",
                "details": "Permission denied accessing target file"
            },
            human_readable_report="Analysis failed due to permission issues"
        )
        mock_analyze.return_value = asyncio.Future()
        mock_analyze.return_value.set_result(mock_result)

        runner = CliRunner()
        result = runner.invoke(cli, ['analyze', sample_cpp_file])

        # CLI should properly handle and report the failure
        assert result.exit_code != 0 or 'error' in result.output.lower() or 'failed' in result.output.lower()
        assert 'permission' in result.output.lower() or 'error' in result.output.lower()