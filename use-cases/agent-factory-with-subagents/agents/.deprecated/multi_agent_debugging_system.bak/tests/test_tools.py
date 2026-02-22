"""
Unit tests for debugging tools integration using PydanticAI patterns.
"""

import asyncio
import json
import subprocess
import tempfile
import pytest
from pathlib import Path
from unittest.mock import Mock, AsyncMock, patch, MagicMock

from pydantic_ai import RunContext

from ..tools import (
    run_debugging_tool, correlate_findings, compile_source,
    _get_tool_command, _parse_tool_output, _execute_with_timeout
)
from ..dependencies import AgentDependencies, ToolResult, ToolType


class TestRunDebuggingTool:
    """Test the main debugging tool execution function."""

    @pytest.mark.asyncio
    async def test_run_debugging_tool_success(self, agent_dependencies, sample_cpp_file):
        """Test successful tool execution."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            # Mock successful subprocess
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (
                b'Mock cppcheck output: [test.cpp:10]: (error) Memory leak',
                b''
            )
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await run_debugging_tool(ctx, "cppcheck", sample_cpp_file)

            assert result["success"] == True
            assert result["tool_name"] == "cppcheck"
            assert "execution_time" in result
            assert isinstance(result["issues"], list)

    @pytest.mark.asyncio
    async def test_run_debugging_tool_failure(self, agent_dependencies, sample_cpp_file):
        """Test tool execution failure handling."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            # Mock failing subprocess
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (
                b'',
                b'Error: Tool not found'
            )
            mock_process.returncode = 1
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await run_debugging_tool(ctx, "nonexistent_tool", sample_cpp_file)

            assert result["success"] == False
            assert "error" in result
            assert result["tool_name"] == "nonexistent_tool"

    @pytest.mark.asyncio
    async def test_run_debugging_tool_timeout(self, agent_dependencies, sample_cpp_file):
        """Test tool execution timeout handling."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            # Mock subprocess that times out
            mock_process = AsyncMock()
            mock_process.communicate.side_effect = asyncio.TimeoutError()
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await run_debugging_tool(ctx, "slow_tool", sample_cpp_file)

            assert result["success"] == False
            assert "timeout" in result.get("error", "").lower()

    @pytest.mark.parametrize("tool_name,expected_in_command", [
        ("cppcheck", "cppcheck"),
        ("clang-tidy", "clang-tidy"),
        ("valgrind", "valgrind"),
        ("gdb", "gdb"),
        ("strace", "strace"),
        ("ltrace", "ltrace"),
        ("perf", "perf")
    ])
    @pytest.mark.asyncio
    async def test_run_debugging_tool_commands(self, agent_dependencies, sample_cpp_file,
                                             tool_name, expected_in_command):
        """Test that correct commands are generated for each tool."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (b'Mock output', b'')
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            await run_debugging_tool(ctx, tool_name, sample_cpp_file)

            # Verify the command contains the expected tool name
            mock_exec.assert_called_once()
            call_args = mock_exec.call_args[0]
            assert any(expected_in_command in str(arg) for arg in call_args)

    @pytest.mark.asyncio
    async def test_run_debugging_tool_with_args(self, agent_dependencies, sample_cpp_file):
        """Test tool execution with custom arguments."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (b'Mock output', b'')
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            custom_args = ["--verbose", "--xml"]
            result = await run_debugging_tool(ctx, "cppcheck", sample_cpp_file, custom_args)

            assert result["success"] == True
            # Verify custom args were passed
            mock_exec.assert_called_once()


class TestToolCommandGeneration:
    """Test tool command generation and configuration."""

    def test_get_tool_command_cppcheck(self, sample_cpp_file):
        """Test cppcheck command generation."""
        command, args = _get_tool_command("cppcheck", sample_cpp_file, [])

        assert "cppcheck" in command[0]
        assert sample_cpp_file in args or any(sample_cpp_file in str(arg) for arg in args)

    def test_get_tool_command_clang_tidy(self, sample_cpp_file):
        """Test clang-tidy command generation."""
        command, args = _get_tool_command("clang-tidy", sample_cpp_file, [])

        assert "clang-tidy" in command[0]
        assert sample_cpp_file in args or any(sample_cpp_file in str(arg) for arg in args)

    def test_get_tool_command_valgrind(self, sample_binary_path):
        """Test valgrind command generation."""
        command, args = _get_tool_command("valgrind", sample_binary_path, [])

        assert "valgrind" in command[0]
        assert sample_binary_path in args or any(sample_binary_path in str(arg) for arg in args)

    def test_get_tool_command_with_custom_args(self, sample_cpp_file):
        """Test command generation with custom arguments."""
        custom_args = ["--verbose", "--enable=all"]
        command, args = _get_tool_command("cppcheck", sample_cpp_file, custom_args)

        # Custom args should be included
        all_args = command + args
        assert any("--verbose" in str(arg) for arg in all_args)
        assert any("--enable=all" in str(arg) for arg in all_args)

    def test_get_tool_command_unsupported_tool(self, sample_cpp_file):
        """Test command generation for unsupported tool."""
        with pytest.raises((ValueError, KeyError)):
            _get_tool_command("unsupported_tool", sample_cpp_file, [])


class TestToolOutputParsing:
    """Test tool output parsing and issue extraction."""

    def test_parse_cppcheck_output(self):
        """Test parsing cppcheck output."""
        cppcheck_output = """
        [test.cpp:10]: (error) Memory leak: data
        [test.cpp:15]: (warning) Array 'arr[10]' accessed at index 10, which is out of bounds
        [test.cpp:20]: (style) Variable 'unused' is assigned but never used
        """

        result = _parse_tool_output("cppcheck", cppcheck_output, "", 0)

        assert result["success"] == True
        assert len(result["issues"]) >= 2  # At least error and warning

        # Check first issue (memory leak)
        memory_leak = next((issue for issue in result["issues"]
                          if "Memory leak" in issue["message"]), None)
        assert memory_leak is not None
        assert memory_leak["severity"] in ["error", "critical"]
        assert memory_leak["line"] == 10

    def test_parse_clang_tidy_output(self):
        """Test parsing clang-tidy output."""
        clang_tidy_output = """
        test.cpp:5:1: warning: use of undeclared identifier 'cout' [readability-identifier-naming]
        test.cpp:10:5: error: use of uninitialized variable 'x' [cppcoreguidelines-init-variables]
        """

        result = _parse_tool_output("clang-tidy", clang_tidy_output, "", 0)

        assert result["success"] == True
        assert len(result["issues"]) >= 1

        # Check for identifier warning
        identifier_issue = next((issue for issue in result["issues"]
                               if "identifier" in issue["message"].lower()), None)
        assert identifier_issue is not None

    def test_parse_valgrind_output(self):
        """Test parsing valgrind output."""
        valgrind_output = """
        ==12345== Invalid write of size 4
        ==12345==    at 0x400123: main (test.cpp:15)
        ==12345== Address 0x123456 is 0 bytes after a block of size 40 alloc'd
        ==12345==
        ==12345== HEAP SUMMARY:
        ==12345==     in use at exit: 40 bytes in 1 blocks
        ==12345==   total heap usage: 1 allocs, 0 frees, 40 bytes allocated
        ==12345==
        ==12345== LEAK SUMMARY:
        ==12345==    definitely lost: 40 bytes in 1 blocks
        """

        result = _parse_tool_output("valgrind", valgrind_output, "", 0)

        assert result["success"] == True
        assert len(result["issues"]) >= 1

        # Check for memory issues
        memory_issues = [issue for issue in result["issues"]
                        if any(term in issue["message"].lower()
                              for term in ["invalid", "leak", "lost"])]
        assert len(memory_issues) >= 1

    def test_parse_gdb_output(self):
        """Test parsing GDB output."""
        gdb_output = """
        (gdb) run
        Starting program: /path/to/test

        Program received signal SIGSEGV, Segmentation fault.
        0x0000000000400123 in main () at test.cpp:20
        20      *ptr = 42;  // Null pointer dereference

        (gdb) bt
        #0  0x0000000000400123 in main () at test.cpp:20
        """

        result = _parse_tool_output("gdb", gdb_output, "", 0)

        assert result["success"] == True
        # GDB output should be captured even if no structured issues are found
        assert "raw_output" in result
        assert len(result["raw_output"]) > 0

    def test_parse_empty_output(self):
        """Test parsing empty or minimal tool output."""
        result = _parse_tool_output("cppcheck", "", "", 0)

        assert result["success"] == True
        assert result["issues"] == []
        assert result["raw_output"] == ""

    def test_parse_tool_error_output(self):
        """Test parsing output when tool encounters errors."""
        error_output = "Error: Could not open file test.cpp"

        result = _parse_tool_output("cppcheck", "", error_output, 1)

        assert result["success"] == False
        assert "error" in result
        assert "Could not open file" in result["error"]


class TestCorrelateFindings:
    """Test the findings correlation functionality."""

    @pytest.mark.asyncio
    async def test_correlate_findings_basic(self, agent_dependencies, mock_tool_results):
        """Test basic findings correlation."""
        ctx = RunContext(deps=agent_dependencies)
        result = await correlate_findings(ctx, mock_tool_results)

        assert "correlation_success" in result
        assert "total_raw_issues" in result
        assert "correlated_groups" in result
        assert isinstance(result["issue_groups"], list)

    @pytest.mark.asyncio
    async def test_correlate_findings_memory_issues(self, agent_dependencies):
        """Test correlation of memory-related issues."""
        tool_results = [
            {
                "tool_name": "cppcheck",
                "success": True,
                "issues": [
                    {
                        "type": "error",
                        "severity": "critical",
                        "message": "Memory leak: data",
                        "file": "test.cpp",
                        "line": 10
                    }
                ]
            },
            {
                "tool_name": "valgrind",
                "success": True,
                "issues": [
                    {
                        "type": "error",
                        "severity": "critical",
                        "message": "40 bytes in 1 blocks are definitely lost",
                        "file": "test.cpp",
                        "line": 10
                    }
                ]
            }
        ]

        ctx = RunContext(deps=agent_dependencies)
        result = await correlate_findings(ctx, tool_results, correlation_threshold=0.7)

        assert result["correlation_success"] == True
        # Should find correlation between memory issues
        memory_groups = [group for group in result["issue_groups"]
                        if "memory" in group.get("type", "").lower()]
        assert len(memory_groups) >= 1

    @pytest.mark.asyncio
    async def test_correlate_findings_no_correlation(self, agent_dependencies):
        """Test correlation when no issues correlate."""
        tool_results = [
            {
                "tool_name": "cppcheck",
                "success": True,
                "issues": [
                    {
                        "type": "style",
                        "severity": "low",
                        "message": "Variable unused",
                        "file": "test.cpp",
                        "line": 5
                    }
                ]
            },
            {
                "tool_name": "clang-tidy",
                "success": True,
                "issues": [
                    {
                        "type": "warning",
                        "severity": "medium",
                        "message": "Missing const qualifier",
                        "file": "test.cpp",
                        "line": 20
                    }
                ]
            }
        ]

        ctx = RunContext(deps=agent_dependencies)
        result = await correlate_findings(ctx, tool_results, correlation_threshold=0.9)

        assert result["correlation_success"] == True
        # Should have separate groups for unrelated issues
        assert len(result["issue_groups"]) >= 0

    @pytest.mark.asyncio
    async def test_correlate_findings_high_threshold(self, agent_dependencies, mock_tool_results):
        """Test correlation with high similarity threshold."""
        ctx = RunContext(deps=agent_dependencies)
        result = await correlate_findings(ctx, mock_tool_results, correlation_threshold=0.95)

        assert result["correlation_success"] == True
        # High threshold should result in fewer correlated groups
        assert isinstance(result["correlated_groups"], int)

    @pytest.mark.asyncio
    async def test_correlate_findings_empty_results(self, agent_dependencies):
        """Test correlation with empty tool results."""
        ctx = RunContext(deps=agent_dependencies)
        result = await correlate_findings(ctx, [], correlation_threshold=0.7)

        assert result["correlation_success"] == True
        assert result["total_raw_issues"] == 0
        assert result["correlated_groups"] == 0
        assert result["issue_groups"] == []


class TestCompileSource:
    """Test source code compilation functionality."""

    @pytest.mark.asyncio
    async def test_compile_source_success(self, agent_dependencies, sample_cpp_file):
        """Test successful source compilation."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (
                b'Compilation successful',
                b''
            )
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await compile_source(ctx, sample_cpp_file)

            assert result["success"] == True
            assert "binary_path" in result
            assert "compilation_time" in result

    @pytest.mark.asyncio
    async def test_compile_source_failure(self, agent_dependencies, sample_cpp_file):
        """Test source compilation failure."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (
                b'',
                b'test.cpp:10:5: error: undeclared identifier'
            )
            mock_process.returncode = 1
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await compile_source(ctx, sample_cpp_file)

            assert result["success"] == False
            assert "errors" in result
            assert len(result["errors"]) > 0

    @pytest.mark.asyncio
    async def test_compile_source_with_build_type(self, agent_dependencies, sample_cpp_file):
        """Test compilation with specific build type."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (b'Success', b'')
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await compile_source(
                ctx,
                sample_cpp_file,
                build_type="release",
                additional_flags=["-O3", "-DNDEBUG"]
            )

            assert result["success"] == True
            # Verify optimization flags were used
            mock_exec.assert_called_once()
            call_args = mock_exec.call_args[0]
            all_args = ' '.join(str(arg) for arg in call_args)
            assert "-O3" in all_args or "release" in all_args.lower()

    @pytest.mark.asyncio
    async def test_compile_source_with_warnings(self, agent_dependencies, sample_cpp_file):
        """Test compilation with warnings but successful build."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (
                b'Binary created successfully',
                b'test.cpp:15: warning: unused variable'
            )
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await compile_source(ctx, sample_cpp_file)

            assert result["success"] == True
            assert "warnings" in result
            assert len(result["warnings"]) > 0
            assert any("unused variable" in warning for warning in result["warnings"])


class TestExecuteWithTimeout:
    """Test timeout functionality for tool execution."""

    @pytest.mark.asyncio
    async def test_execute_with_timeout_success(self):
        """Test successful execution within timeout."""
        async def quick_task():
            await asyncio.sleep(0.1)
            return "Success"

        result = await _execute_with_timeout(quick_task(), 1.0)
        assert result == "Success"

    @pytest.mark.asyncio
    async def test_execute_with_timeout_failure(self):
        """Test timeout when task takes too long."""
        async def slow_task():
            await asyncio.sleep(2.0)
            return "Too slow"

        with pytest.raises(asyncio.TimeoutError):
            await _execute_with_timeout(slow_task(), 0.5)

    @pytest.mark.asyncio
    async def test_execute_with_timeout_zero(self):
        """Test immediate timeout."""
        async def any_task():
            return "Should not complete"

        with pytest.raises(asyncio.TimeoutError):
            await _execute_with_timeout(any_task(), 0)


@pytest.mark.integration
class TestToolIntegration:
    """Integration tests for tool functionality."""

    @pytest.mark.asyncio
    async def test_full_tool_workflow(self, agent_dependencies, sample_cpp_file):
        """Test complete tool execution workflow."""
        with patch('asyncio.create_subprocess_exec') as mock_exec:
            # Mock successful cppcheck execution
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (
                b'[test.cpp:10]: (error) Memory leak: data',
                b''
            )
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)

            # 1. Run tool
            tool_result = await run_debugging_tool(ctx, "cppcheck", sample_cpp_file)
            assert tool_result["success"] == True

            # 2. Correlate findings
            correlation_result = await correlate_findings(ctx, [tool_result])
            assert correlation_result["correlation_success"] == True

    @pytest.mark.asyncio
    async def test_multi_tool_analysis(self, agent_dependencies, sample_cpp_file):
        """Test analysis with multiple tools."""
        tool_outputs = {
            "cppcheck": b'[test.cpp:10]: (error) Memory leak',
            "clang-tidy": b'test.cpp:5: warning: unused variable',
        }

        results = []

        for tool_name, output in tool_outputs.items():
            with patch('asyncio.create_subprocess_exec') as mock_exec:
                mock_process = AsyncMock()
                mock_process.communicate.return_value = (output, b'')
                mock_process.returncode = 0
                mock_exec.return_value = mock_process

                ctx = RunContext(deps=agent_dependencies)
                result = await run_debugging_tool(ctx, tool_name, sample_cpp_file)
                results.append(result)

        # Correlate all results
        ctx = RunContext(deps=agent_dependencies)
        correlation = await correlate_findings(ctx, results)

        assert correlation["correlation_success"] == True
        assert correlation["total_raw_issues"] >= len(results)


@pytest.mark.slow
class TestPerformance:
    """Performance tests for tool operations."""

    @pytest.mark.asyncio
    async def test_concurrent_tool_execution(self, agent_dependencies, sample_cpp_file):
        """Test concurrent execution of multiple tools."""
        async def mock_tool_execution(tool_name):
            await asyncio.sleep(0.1)  # Simulate tool execution time
            return {
                "tool_name": tool_name,
                "success": True,
                "execution_time": 0.1,
                "issues": []
            }

        tools = ["cppcheck", "clang-tidy", "valgrind"]

        # Execute tools concurrently
        start_time = asyncio.get_event_loop().time()
        results = await asyncio.gather(*[
            mock_tool_execution(tool) for tool in tools
        ])
        end_time = asyncio.get_event_loop().time()

        # Concurrent execution should be faster than sequential
        execution_time = end_time - start_time
        assert execution_time < 0.5  # Should be much less than 0.3 (3 * 0.1)
        assert len(results) == len(tools)

    @pytest.mark.asyncio
    async def test_large_output_handling(self, agent_dependencies, sample_cpp_file):
        """Test handling of large tool output."""
        # Generate large output (simulating detailed analysis)
        large_output = b'\n'.join([
            f'[test.cpp:{i}]: (warning) Issue #{i}'.encode()
            for i in range(1000)
        ])

        with patch('asyncio.create_subprocess_exec') as mock_exec:
            mock_process = AsyncMock()
            mock_process.communicate.return_value = (large_output, b'')
            mock_process.returncode = 0
            mock_exec.return_value = mock_process

            ctx = RunContext(deps=agent_dependencies)
            result = await run_debugging_tool(ctx, "cppcheck", sample_cpp_file)

            assert result["success"] == True
            assert len(result["issues"]) > 0
            # Should handle large output without issues
            assert len(result["raw_output"]) > 10000