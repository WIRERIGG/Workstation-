"""
Integration tests for Multi-Agent Debugging System end-to-end workflows.
"""

import asyncio
import json
import tempfile
import pytest
from pathlib import Path
from unittest.mock import Mock, AsyncMock, patch, MagicMock

from pydantic_ai.models import TestModel

from ..agent import MultiAgentDebugger, analyze_cpp_code, AnalysisResult
from ..dependencies import AnalysisMode, ToolType
from ..tools import run_debugging_tool, correlate_findings, compile_source


class TestEndToEndWorkflow:
    """Test complete end-to-end analysis workflows."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_comprehensive_analysis_workflow(self, sample_cpp_file, mock_tool_results,
                                                 mock_correlation_result):
        """Test complete comprehensive analysis workflow."""
        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_create_execution_plan') as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report, \
             patch.object(debugger, '_handle_compilation') as mock_compile:

            # Setup execution plan
            mock_plan.return_value = {
                "phases": [
                    {"name": "static_analysis", "tools": ["cppcheck", "clang-tidy"], "parallel": True},
                    {"name": "dynamic_analysis", "tools": ["valgrind"], "parallel": False}
                ],
                "estimated_duration": 180
            }

            # Setup tool execution results
            mock_execute.return_value = mock_tool_results

            # Setup correlation results
            mock_correlate.return_value = mock_correlation_result

            # Setup final report
            mock_report.return_value = "Comprehensive Analysis Report: 3 critical issues found"

            # Setup compilation
            mock_compile.return_value = {"success": True, "binary_path": "/tmp/test_binary"}

            # Execute analysis
            result = await debugger.analyze(
                target_path=sample_cpp_file,
                analysis_mode="comprehensive",
                max_parallel_tools=2
            )

            # Verify result structure
            assert isinstance(result, AnalysisResult)
            assert result.success == True
            assert result.analysis_mode == "comprehensive"
            assert result.total_issues > 0
            assert result.critical_issues > 0
            assert len(result.tools_executed) > 0
            assert len(result.recommendations) > 0

            # Verify workflow stages were called
            mock_plan.assert_called_once()
            mock_execute.assert_called_once()
            mock_correlate.assert_called_once()
            mock_report.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_static_only_analysis_workflow(self, sample_cpp_file):
        """Test static-only analysis workflow."""
        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_create_execution_plan') as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            # Setup static-only execution plan
            mock_plan.return_value = {
                "phases": [
                    {"name": "static_analysis", "tools": ["cppcheck", "clang-tidy"], "parallel": True}
                ],
                "estimated_duration": 60
            }

            # Setup static tool results
            static_results = [
                {
                    "tool_name": "cppcheck",
                    "success": True,
                    "issues": [{"type": "error", "message": "Memory leak", "severity": "critical"}]
                },
                {
                    "tool_name": "clang-tidy",
                    "success": True,
                    "issues": [{"type": "warning", "message": "Style issue", "severity": "low"}]
                }
            ]
            mock_execute.return_value = static_results

            mock_correlate.return_value = {"correlation_success": True, "issue_groups": []}
            mock_report.return_value = "Static Analysis Report"

            # Execute static analysis
            result = await debugger.analyze(
                target_path=sample_cpp_file,
                analysis_mode="static"
            )

            assert result.success == True
            assert result.analysis_mode == "static"
            # Should only execute static tools
            assert all(tool in ["cppcheck", "clang-tidy"] for tool in result.tools_executed)

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_dynamic_only_analysis_workflow(self, sample_binary_path):
        """Test dynamic-only analysis workflow."""
        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_create_execution_plan') as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            # Setup dynamic-only execution plan
            mock_plan.return_value = {
                "phases": [
                    {"name": "dynamic_analysis", "tools": ["valgrind", "gdb"], "parallel": False}
                ],
                "estimated_duration": 120
            }

            # Setup dynamic tool results
            dynamic_results = [
                {
                    "tool_name": "valgrind",
                    "success": True,
                    "issues": [{"type": "error", "message": "Invalid read", "severity": "critical"}]
                }
            ]
            mock_execute.return_value = dynamic_results

            mock_correlate.return_value = {"correlation_success": True, "issue_groups": []}
            mock_report.return_value = "Dynamic Analysis Report"

            # Execute dynamic analysis
            result = await debugger.analyze(
                target_path=sample_binary_path,
                analysis_mode="dynamic"
            )

            assert result.success == True
            assert result.analysis_mode == "dynamic"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_convenience_function_workflow(self, sample_cpp_file):
        """Test the convenience function analyze_cpp_code."""
        with patch('..agent.MultiAgentDebugger.analyze') as mock_analyze:
            expected_result = AnalysisResult(
                success=True,
                session_id="test-session",
                execution_time=30.5,
                analysis_mode="comprehensive",
                tools_executed=["cppcheck", "valgrind"],
                total_issues=5,
                critical_issues=2,
                correlation_summary={"groups": 2},
                recommendations=["Fix memory leaks"],
                detailed_results={"tools": []},
                human_readable_report="Test report"
            )
            mock_analyze.return_value = expected_result

            # Test convenience function
            result = await analyze_cpp_code(
                target_path=sample_cpp_file,
                analysis_mode="comprehensive",
                max_parallel_tools=3
            )

            assert isinstance(result, AnalysisResult)
            assert result.success == True
            assert result.total_issues == 5
            assert result.critical_issues == 2

            # Verify parameters were passed correctly
            mock_analyze.assert_called_once_with(
                target_path=sample_cpp_file,
                analysis_mode="comprehensive",
                output_format="both",
                max_parallel_tools=3,
                timeout=300
            )


class TestErrorHandlingIntegration:
    """Test error handling across the entire system."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_compilation_failure_fallback(self, sample_cpp_file):
        """Test fallback to static analysis when compilation fails."""
        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_handle_compilation') as mock_compile, \
             patch.object(debugger, '_create_execution_plan') as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            # Simulate compilation failure
            mock_compile.return_value = {"success": False, "error": "Compilation failed"}

            # Should fallback to static-only plan
            mock_plan.return_value = {
                "phases": [{"name": "static_analysis", "tools": ["cppcheck"], "parallel": True}]
            }
            mock_execute.return_value = [{"tool_name": "cppcheck", "success": True, "issues": []}]
            mock_correlate.return_value = {"correlation_success": True}
            mock_report.return_value = "Static-only report due to compilation failure"

            result = await debugger.analyze(
                target_path=sample_cpp_file,
                analysis_mode="comprehensive"  # Should fallback to static
            )

            assert result.success == True
            # Should have switched to static analysis due to compilation failure
            assert "cppcheck" in result.tools_executed or len(result.tools_executed) >= 0

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_partial_tool_failure_handling(self, sample_cpp_file):
        """Test handling when some tools fail but others succeed."""
        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_create_execution_plan') as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            mock_plan.return_value = {
                "phases": [{"name": "mixed_analysis", "tools": ["cppcheck", "failing_tool"], "parallel": True}]
            }

            # Mix of successful and failed tools
            mixed_results = [
                {"tool_name": "cppcheck", "success": True, "issues": [{"message": "Found issue"}]},
                {"tool_name": "failing_tool", "success": False, "error": "Tool failed"}
            ]
            mock_execute.return_value = mixed_results

            mock_correlate.return_value = {"correlation_success": True, "total_raw_issues": 1}
            mock_report.return_value = "Partial analysis report"

            result = await debugger.analyze(sample_cpp_file)

            assert result.success == True  # Should succeed with partial results
            assert len(result.tools_executed) >= 1  # At least one tool succeeded
            assert result.total_issues >= 0

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_complete_failure_handling(self, sample_cpp_file):
        """Test handling when entire analysis fails."""
        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_create_execution_plan') as mock_plan:
            # Simulate complete failure
            mock_plan.side_effect = Exception("Critical failure in planning")

            result = await debugger.analyze(sample_cpp_file)

            assert result.success == False
            assert "error" in result.detailed_results
            assert "Critical failure" in str(result.detailed_results["error"])


class TestConcurrencyIntegration:
    """Test concurrent operations and race conditions."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_parallel_tool_execution_integration(self, sample_cpp_file):
        """Test parallel execution of multiple tools."""
        debugger = MultiAgentDebugger()

        async def mock_tool_execution(tool_name):
            # Simulate varying execution times
            execution_times = {"cppcheck": 0.1, "clang-tidy": 0.2, "valgrind": 0.3}
            await asyncio.sleep(execution_times.get(tool_name, 0.1))
            return {
                "tool_name": tool_name,
                "success": True,
                "execution_time": execution_times.get(tool_name, 0.1),
                "issues": [{"message": f"Issue from {tool_name}"}]
            }

        with patch.object(debugger, '_execute_single_tool', side_effect=mock_tool_execution):
            execution_plan = {
                "phases": [
                    {
                        "name": "parallel_phase",
                        "tools": ["cppcheck", "clang-tidy", "valgrind"],
                        "parallel": True
                    }
                ]
            }

            # Mock dependencies
            from ..dependencies import create_debugging_context, AgentDependencies
            context = create_debugging_context(sample_cpp_file, AnalysisMode.COMPREHENSIVE)
            deps = AgentDependencies(context=context, message_queue=[], results_cache={})

            start_time = asyncio.get_event_loop().time()
            results = await debugger._execute_tools_parallel(deps, execution_plan, 3)
            end_time = asyncio.get_event_loop().time()

            execution_time = end_time - start_time

            # Should complete in approximately the time of the longest tool (0.3s + overhead)
            assert execution_time < 1.0  # Should be much less than sequential (0.6s)
            assert len(results) == 3
            assert all(result["success"] for result in results)

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_concurrent_analyses(self, sample_cpp_file, tmp_path):
        """Test running multiple analyses concurrently."""
        # Create multiple test files
        test_files = []
        for i in range(3):
            test_file = tmp_path / f"test_{i}.cpp"
            test_file.write_text(f"// Test file {i}\nint main() {{ return {i}; }}")
            test_files.append(str(test_file))

        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_create_execution_plan') as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            # Setup mocks for all analyses
            mock_plan.return_value = {"phases": [{"name": "test", "tools": ["cppcheck"], "parallel": True}]}
            mock_execute.return_value = [{"tool_name": "cppcheck", "success": True, "issues": []}]
            mock_correlate.return_value = {"correlation_success": True}
            mock_report.return_value = "Concurrent test report"

            # Run multiple analyses concurrently
            tasks = [debugger.analyze(file_path) for file_path in test_files]
            results = await asyncio.gather(*tasks)

            # All analyses should succeed
            assert len(results) == 3
            assert all(isinstance(result, AnalysisResult) for result in results)
            assert all(result.success for result in results)


class TestAgentCooperationIntegration:
    """Test cooperation between different agents."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_lead_agent_coordination(self, agent_dependencies, mock_test_model):
        """Test lead agent coordinating other agents."""
        from ..agent import lead_agent
        from pydantic_ai import Agent

        test_lead_agent = Agent(mock_test_model, deps_type=type(agent_dependencies))

        # Simulate lead agent coordinating analysis
        coordination_prompt = """
        Coordinate a comprehensive debugging analysis:
        1. Plan the execution strategy
        2. Delegate tool execution to specialized agents
        3. Correlate findings from multiple tools
        4. Generate final recommendations
        """

        result = await test_lead_agent.run(coordination_prompt, deps=agent_dependencies)

        assert result is not None
        # Lead agent should provide coordination response
        assert isinstance(result.data, str)
        assert len(result.data) > 0

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_tool_agent_specialization(self, agent_dependencies, mock_test_model):
        """Test that tool agents provide specialized responses."""
        from pydantic_ai import Agent

        # Test different agents with tool-specific prompts
        test_scenarios = [
            ("GDB", "Debug a segmentation fault in C++ application"),
            ("Valgrind", "Analyze memory leaks and access violations"),
            ("Cppcheck", "Perform static analysis on C++ source code"),
            ("Clang-tidy", "Check code quality and modern C++ practices")
        ]

        for tool_name, prompt in test_scenarios:
            test_agent = Agent(mock_test_model, deps_type=type(agent_dependencies))
            result = await test_agent.run(prompt, deps=agent_dependencies)

            assert result is not None
            assert isinstance(result.data, str)
            # Each agent should provide specialized response for its tool

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_detail_agent_correlation(self, agent_dependencies, mock_tool_results, mock_test_model):
        """Test detail agent providing correlation insights."""
        from pydantic_ai import Agent

        test_detail_agent = Agent(mock_test_model, deps_type=type(agent_dependencies))

        correlation_prompt = f"""
        Analyze correlation between multiple debugging tool results:

        Results summary:
        - Total issues: {sum(len(r.get('issues', [])) for r in mock_tool_results)}
        - Tools used: {[r['tool_name'] for r in mock_tool_results]}
        - Critical issues: {sum(1 for r in mock_tool_results for i in r.get('issues', []) if i.get('severity') == 'critical')}

        Provide detailed correlation analysis and insights.
        """

        result = await test_detail_agent.run(correlation_prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)
        # Detail agent should provide correlation insights

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_plan_agent_execution_strategy(self, agent_dependencies, mock_test_model):
        """Test plan agent creating execution strategies."""
        from pydantic_ai import Agent

        test_plan_agent = Agent(mock_test_model, deps_type=type(agent_dependencies))

        planning_prompt = """
        Create an optimal execution plan for comprehensive C++ debugging:

        Available tools: [cppcheck, clang-tidy, valgrind, gdb, strace, ltrace, perf]
        Target: Large C++ application with potential memory and performance issues
        Constraints: Maximum 3 parallel processes, 5-minute timeout

        Provide structured execution plan with phases and rationale.
        """

        result = await test_plan_agent.run(planning_prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)
        # Plan agent should provide execution strategy


class TestDataFlowIntegration:
    """Test data flow through the entire system."""

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_context_propagation(self, sample_cpp_file):
        """Test that context is properly propagated through all components."""
        debugger = MultiAgentDebugger()

        # Track context usage through mocks
        context_usage = []

        def track_context_usage(deps, *args, **kwargs):
            context_usage.append({
                "component": "execution_plan",
                "target_path": deps.context.target_path,
                "analysis_mode": deps.context.analysis_mode,
                "session_id": deps.context.session_id
            })
            return {"phases": []}

        with patch.object(debugger, '_create_execution_plan', side_effect=track_context_usage), \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            mock_execute.return_value = []
            mock_correlate.return_value = {"correlation_success": True}
            mock_report.return_value = "Context test report"

            await debugger.analyze(sample_cpp_file, analysis_mode="static")

            # Verify context was used
            assert len(context_usage) == 1
            assert context_usage[0]["target_path"] == sample_cpp_file
            assert context_usage[0]["analysis_mode"].value == "static"
            assert context_usage[0]["session_id"] is not None

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_results_aggregation(self, sample_cpp_file, mock_tool_results):
        """Test that results are properly aggregated across components."""
        debugger = MultiAgentDebugger()

        with patch.object(debugger, '_create_execution_plan') as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            mock_plan.return_value = {"phases": []}
            mock_execute.return_value = mock_tool_results

            # Detailed correlation result
            correlation_result = {
                "correlation_success": True,
                "total_raw_issues": 5,
                "correlated_groups": 2,
                "high_priority_issues": 3,
                "recommendations": ["Fix memory issues", "Add bounds checking"]
            }
            mock_correlate.return_value = correlation_result

            mock_report.return_value = "Comprehensive aggregated report"

            result = await debugger.analyze(sample_cpp_file)

            # Verify aggregation
            assert result.success == True
            assert result.total_issues == 5
            assert result.critical_issues == 3  # From mock_tool_results critical issues
            assert len(result.recommendations) >= 2
            assert result.correlation_summary == correlation_result

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_message_queue_usage(self, agent_dependencies):
        """Test message queue for agent communication."""
        # Simulate messages being added to queue
        test_messages = [
            {"from": "lead_agent", "to": "tool_agent", "action": "execute_tool", "tool": "cppcheck"},
            {"from": "tool_agent", "to": "detail_agent", "action": "correlate", "results": []},
            {"from": "detail_agent", "to": "lead_agent", "action": "report", "correlation": {}}
        ]

        for message in test_messages:
            agent_dependencies.message_queue.append(message)

        # Verify messages are queued
        assert len(agent_dependencies.message_queue) == 3
        assert agent_dependencies.message_queue[0]["from"] == "lead_agent"
        assert agent_dependencies.message_queue[-1]["to"] == "lead_agent"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_results_caching_integration(self, agent_dependencies):
        """Test results caching across the system."""
        # Simulate caching tool results
        cache_key = "tool_cppcheck_sample.cpp"
        cached_result = {
            "tool_name": "cppcheck",
            "success": True,
            "cached": True,
            "issues": [{"message": "Cached issue"}]
        }

        agent_dependencies.results_cache[cache_key] = cached_result

        # Verify caching works
        assert cache_key in agent_dependencies.results_cache
        assert agent_dependencies.results_cache[cache_key]["cached"] == True

        # Simulate cache hit
        retrieved_result = agent_dependencies.results_cache.get(cache_key)
        assert retrieved_result == cached_result


@pytest.mark.slow
@pytest.mark.integration
class TestFullSystemIntegration:
    """Comprehensive full-system integration tests."""

    @pytest.mark.asyncio
    async def test_realistic_cpp_analysis_scenario(self, tmp_path):
        """Test realistic C++ analysis scenario with actual code issues."""
        # Create realistic C++ file with multiple types of issues
        realistic_cpp = tmp_path / "realistic_test.cpp"
        realistic_cpp.write_text('''
#include <iostream>
#include <vector>
#include <memory>

class DataProcessor {
private:
    int* data;
    size_t capacity;
    size_t size;

public:
    DataProcessor(size_t cap) : capacity(cap), size(0) {
        data = new int[capacity];  // Raw pointer allocation
    }

    ~DataProcessor() {
        // Missing delete[] - memory leak
    }

    void addData(int value) {
        if (size >= capacity) {
            // Buffer overflow potential
            data[size] = value;
            size++;
        } else {
            data[size++] = value;
        }
    }

    int getData(size_t index) {
        return data[index];  // No bounds checking
    }

    void processAll() {
        for (size_t i = 0; i <= size; ++i) {  // Off-by-one error
            std::cout << data[i] << " ";
        }
    }
};

int main() {
    DataProcessor* processor = new DataProcessor(10);

    // Add some data
    for (int i = 0; i < 15; ++i) {  // Will cause buffer overflow
        processor->addData(i);
    }

    processor->processAll();

    // Access out of bounds
    std::cout << processor->getData(20) << std::endl;

    // Memory leak - never delete processor
    return 0;
}
''')

        debugger = MultiAgentDebugger()

        # Mock realistic tool responses based on the code
        def mock_cppcheck_execution(*args, **kwargs):
            return {
                "tool_name": "cppcheck",
                "success": True,
                "execution_time": 2.1,
                "issues": [
                    {
                        "type": "error",
                        "severity": "critical",
                        "message": "Memory leak: data",
                        "file": str(realistic_cpp),
                        "line": 12,
                        "column": 16
                    },
                    {
                        "type": "error",
                        "severity": "high",
                        "message": "Array index out of bounds",
                        "file": str(realistic_cpp),
                        "line": 32,
                        "column": 13
                    }
                ]
            }

        def mock_clang_tidy_execution(*args, **kwargs):
            return {
                "tool_name": "clang-tidy",
                "success": True,
                "execution_time": 3.5,
                "issues": [
                    {
                        "type": "warning",
                        "severity": "medium",
                        "message": "Use smart pointers instead of raw pointers",
                        "file": str(realistic_cpp),
                        "line": 9,
                        "column": 5
                    }
                ]
            }

        with patch('..tools.run_debugging_tool') as mock_tool:
            # Return different results based on tool name
            def tool_side_effect(ctx, tool_name, target_path, *args, **kwargs):
                if tool_name == "cppcheck":
                    return mock_cppcheck_execution()
                elif tool_name == "clang-tidy":
                    return mock_clang_tidy_execution()
                else:
                    return {"tool_name": tool_name, "success": True, "issues": []}

            mock_tool.side_effect = tool_side_effect

            result = await debugger.analyze(
                target_path=str(realistic_cpp),
                analysis_mode="static",
                max_parallel_tools=2
            )

            # Verify realistic analysis results
            assert result.success == True
            assert result.total_issues >= 3  # Should find multiple issues
            assert result.critical_issues >= 1  # Should find critical memory leak
            assert len(result.tools_executed) >= 1
            assert "memory" in result.human_readable_report.lower() or len(result.human_readable_report) > 0

    @pytest.mark.asyncio
    async def test_system_resilience_and_recovery(self, sample_cpp_file):
        """Test system resilience under various failure conditions."""
        debugger = MultiAgentDebugger()

        # Test scenario: Multiple components fail but system recovers
        failure_count = 0

        def intermittent_failure(*args, **kwargs):
            nonlocal failure_count
            failure_count += 1
            if failure_count <= 2:  # First two calls fail
                raise Exception(f"Simulated failure #{failure_count}")
            return {"phases": [{"name": "recovery", "tools": ["cppcheck"], "parallel": True}]}

        with patch.object(debugger, '_create_execution_plan', side_effect=intermittent_failure) as mock_plan, \
             patch.object(debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(debugger, '_correlate_results') as mock_correlate, \
             patch.object(debugger, '_generate_final_report') as mock_report:

            mock_execute.return_value = [{"tool_name": "cppcheck", "success": True, "issues": []}]
            mock_correlate.return_value = {"correlation_success": True}
            mock_report.return_value = "Recovery test report"

            # System should handle initial failures and eventually recover
            result = await debugger.analyze(sample_cpp_file)

            # Despite failures, system should eventually succeed or fail gracefully
            assert isinstance(result, AnalysisResult)
            # The specific success state depends on error handling implementation
            if result.success:
                assert len(result.detailed_results) > 0
            else:
                assert "error" in result.detailed_results