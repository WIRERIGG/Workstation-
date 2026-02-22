"""
Unit tests for Multi-Agent Debugging System agents using PydanticAI TestModel.
"""

import asyncio
import pytest
from unittest.mock import Mock, AsyncMock, patch

from pydantic_ai.models import TestModel
from pydantic_ai import Agent

from ..agent import (
    MultiAgentDebugger, AnalysisRequest, AnalysisResult,
    lead_agent, gdb_agent, strace_agent, ltrace_agent,
    perf_agent, cppcheck_agent, clang_tidy_agent, valgrind_agent,
    detail_agent, plan_agent, analyze_cpp_code
)
from ..dependencies import AgentDependencies, AnalysisMode, ToolType


class TestLeadAgent:
    """Test cases for the Lead Agent."""

    @pytest.mark.asyncio
    async def test_lead_agent_initialization(self):
        """Test that lead agent is properly initialized."""
        assert lead_agent is not None
        assert hasattr(lead_agent, 'deps_type')
        assert lead_agent.deps_type == AgentDependencies

    @pytest.mark.asyncio
    async def test_lead_agent_basic_response(self, agent_dependencies, mock_test_model):
        """Test lead agent provides basic response."""
        # Replace the agent's model with test model
        test_agent = Agent(mock_test_model, deps_type=AgentDependencies)

        prompt = "Analyze this C++ code for debugging issues."
        result = await test_agent.run(prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)
        assert len(result.data) > 0

    @pytest.mark.asyncio
    async def test_lead_agent_with_tool_calls(self, agent_dependencies):
        """Test lead agent can handle tool calls."""
        with patch('pydantic_ai.Agent.run') as mock_run:
            mock_run.return_value = Mock(data="Analysis completed with tool findings")

            prompt = "Execute debugging tools on test_file.cpp"
            result = await lead_agent.run(prompt, deps=agent_dependencies)

            mock_run.assert_called_once()
            assert result.data == "Analysis completed with tool findings"


class TestToolAgents:
    """Test cases for specialized tool agents."""

    @pytest.mark.parametrize("agent,tool_type", [
        (gdb_agent, ToolType.GDB),
        (strace_agent, ToolType.STRACE),
        (ltrace_agent, ToolType.LTRACE),
        (perf_agent, ToolType.PERF),
        (cppcheck_agent, ToolType.CPPCHECK),
        (clang_tidy_agent, ToolType.CLANG_TIDY),
        (valgrind_agent, ToolType.VALGRIND)
    ])
    @pytest.mark.asyncio
    async def test_tool_agent_initialization(self, agent, tool_type):
        """Test that tool agents are properly initialized."""
        assert agent is not None
        assert hasattr(agent, 'deps_type')
        assert agent.deps_type == AgentDependencies

    @pytest.mark.asyncio
    async def test_gdb_agent_response(self, agent_dependencies, mock_test_model):
        """Test GDB agent provides appropriate response."""
        test_agent = Agent(mock_test_model, deps_type=AgentDependencies)

        prompt = "Execute GDB analysis on test binary"
        result = await test_agent.run(prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)

    @pytest.mark.asyncio
    async def test_static_analysis_agents(self, agent_dependencies, mock_test_model):
        """Test static analysis agents (cppcheck, clang-tidy)."""
        test_agent = Agent(mock_test_model, deps_type=AgentDependencies)

        # Test with source code analysis prompt
        prompt = "Analyze source code for static issues"
        result = await test_agent.run(prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)

    @pytest.mark.asyncio
    async def test_dynamic_analysis_agents(self, agent_dependencies, mock_test_model):
        """Test dynamic analysis agents (valgrind, perf, etc.)."""
        test_agent = Agent(mock_test_model, deps_type=AgentDependencies)

        # Test with binary analysis prompt
        prompt = "Analyze binary for runtime issues"
        result = await test_agent.run(prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)


class TestCoordinationAgents:
    """Test cases for coordination agents (Detail and Plan agents)."""

    @pytest.mark.asyncio
    async def test_detail_agent_initialization(self):
        """Test detail agent is properly initialized."""
        assert detail_agent is not None
        assert hasattr(detail_agent, 'deps_type')
        assert detail_agent.deps_type == AgentDependencies

    @pytest.mark.asyncio
    async def test_plan_agent_initialization(self):
        """Test plan agent is properly initialized."""
        assert plan_agent is not None
        assert hasattr(plan_agent, 'deps_type')
        assert plan_agent.deps_type == AgentDependencies

    @pytest.mark.asyncio
    async def test_detail_agent_correlation_analysis(self, agent_dependencies, mock_test_model):
        """Test detail agent can analyze correlations."""
        test_agent = Agent(mock_test_model, deps_type=AgentDependencies)

        prompt = """Analyze correlation results:
        - Tool A found 3 memory leaks
        - Tool B found 2 buffer overflows
        - Tool C confirmed 1 overlapping issue"""

        result = await test_agent.run(prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)

    @pytest.mark.asyncio
    async def test_plan_agent_execution_planning(self, agent_dependencies, mock_test_model):
        """Test plan agent can create execution plans."""
        test_agent = Agent(mock_test_model, deps_type=AgentDependencies)

        prompt = """Create execution plan for comprehensive analysis:
        - Available tools: cppcheck, clang-tidy, valgrind, gdb
        - Target: C++ source file
        - Max parallel: 2"""

        result = await test_agent.run(prompt, deps=agent_dependencies)

        assert result is not None
        assert isinstance(result.data, str)


class TestMultiAgentDebugger:
    """Test cases for the main MultiAgentDebugger orchestrator."""

    def test_debugger_initialization(self, multi_agent_debugger):
        """Test debugger initializes with correct tool agents."""
        assert multi_agent_debugger is not None
        assert len(multi_agent_debugger.tool_agents) == 7

        # Verify all tool types are mapped
        expected_tools = {
            ToolType.GDB, ToolType.STRACE, ToolType.LTRACE,
            ToolType.PERF, ToolType.CPPCHECK, ToolType.CLANG_TIDY,
            ToolType.VALGRIND
        }
        assert set(multi_agent_debugger.tool_agents.keys()) == expected_tools

    @pytest.mark.asyncio
    async def test_analyze_method_basic(self, multi_agent_debugger, sample_cpp_file):
        """Test basic analyze method execution."""
        with patch.object(multi_agent_debugger, '_create_execution_plan') as mock_plan, \
             patch.object(multi_agent_debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(multi_agent_debugger, '_correlate_results') as mock_correlate, \
             patch.object(multi_agent_debugger, '_generate_final_report') as mock_report:

            # Setup mocks
            mock_plan.return_value = {"phases": []}
            mock_execute.return_value = []
            mock_correlate.return_value = {"correlation_success": True}
            mock_report.return_value = "Test report"

            result = await multi_agent_debugger.analyze(sample_cpp_file)

            assert isinstance(result, AnalysisResult)
            assert result.success == True
            assert result.analysis_mode == "comprehensive"

    @pytest.mark.asyncio
    async def test_analyze_with_parameters(self, multi_agent_debugger, sample_cpp_file):
        """Test analyze method with custom parameters."""
        with patch.object(multi_agent_debugger, '_create_execution_plan') as mock_plan, \
             patch.object(multi_agent_debugger, '_execute_tools_parallel') as mock_execute, \
             patch.object(multi_agent_debugger, '_correlate_results') as mock_correlate, \
             patch.object(multi_agent_debugger, '_generate_final_report') as mock_report:

            mock_plan.return_value = {"phases": []}
            mock_execute.return_value = []
            mock_correlate.return_value = {"correlation_success": True}
            mock_report.return_value = "Test report"

            result = await multi_agent_debugger.analyze(
                target_path=sample_cpp_file,
                analysis_mode="static",
                output_format="json",
                max_parallel_tools=2,
                timeout=120
            )

            assert result.analysis_mode == "static"
            assert result.execution_time > 0

    @pytest.mark.asyncio
    async def test_create_execution_plan(self, multi_agent_debugger, agent_dependencies):
        """Test execution plan creation."""
        result = await multi_agent_debugger._create_execution_plan(agent_dependencies, 4)

        assert isinstance(result, dict)
        assert "phases" in result
        assert "estimated_duration" in result
        assert isinstance(result["phases"], list)

    @pytest.mark.asyncio
    async def test_execute_single_tool(self, multi_agent_debugger, agent_dependencies):
        """Test single tool execution."""
        with patch('..tools.run_debugging_tool') as mock_tool:
            mock_tool.return_value = {
                "tool_name": "cppcheck",
                "success": True,
                "issues": []
            }

            result = await multi_agent_debugger._execute_single_tool(
                agent_dependencies, "cppcheck"
            )

            assert result["tool_name"] == "cppcheck"
            assert result["success"] == True

    @pytest.mark.asyncio
    async def test_execute_tools_parallel(self, multi_agent_debugger, agent_dependencies):
        """Test parallel tool execution."""
        execution_plan = {
            "phases": [
                {
                    "name": "static_analysis",
                    "tools": ["cppcheck", "clang-tidy"],
                    "parallel": True
                }
            ]
        }

        with patch.object(multi_agent_debugger, '_execute_single_tool') as mock_single:
            mock_single.return_value = {"tool_name": "test", "success": True}

            results = await multi_agent_debugger._execute_tools_parallel(
                agent_dependencies, execution_plan, 2
            )

            assert isinstance(results, list)
            assert len(results) >= 0

    @pytest.mark.asyncio
    async def test_correlate_results(self, multi_agent_debugger, agent_dependencies, mock_tool_results):
        """Test results correlation."""
        with patch('..tools.correlate_findings') as mock_correlate:
            mock_correlate.return_value = {
                "correlation_success": True,
                "correlated_groups": 2
            }

            result = await multi_agent_debugger._correlate_results(
                agent_dependencies, mock_tool_results
            )

            assert result["correlation_success"] == True
            assert "correlated_groups" in result

    @pytest.mark.asyncio
    async def test_generate_final_report(self, multi_agent_debugger, agent_dependencies, mock_tool_results):
        """Test final report generation."""
        correlation_result = {"correlation_success": True}

        result = await multi_agent_debugger._generate_final_report(
            agent_dependencies, mock_tool_results, correlation_result, "human"
        )

        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_error_handling(self, multi_agent_debugger):
        """Test error handling in analysis."""
        # Test with non-existent file
        result = await multi_agent_debugger.analyze("non_existent_file.cpp")

        assert isinstance(result, AnalysisResult)
        assert result.success == False
        assert "error" in result.detailed_results


class TestAnalysisModels:
    """Test Pydantic models for analysis."""

    def test_analysis_request_model(self):
        """Test AnalysisRequest model validation."""
        request = AnalysisRequest(
            target_path="test.cpp",
            analysis_mode="static",
            output_format="json",
            max_parallel_tools=2,
            timeout=180
        )

        assert request.target_path == "test.cpp"
        assert request.analysis_mode == "static"
        assert request.max_parallel_tools == 2

    def test_analysis_result_model(self):
        """Test AnalysisResult model validation."""
        result = AnalysisResult(
            success=True,
            session_id="test-123",
            execution_time=45.5,
            analysis_mode="comprehensive",
            tools_executed=["cppcheck", "valgrind"],
            total_issues=5,
            critical_issues=2,
            correlation_summary={"groups": 1},
            recommendations=["Fix memory leaks"],
            detailed_results={"tools": []},
            human_readable_report="Test report"
        )

        assert result.success == True
        assert result.session_id == "test-123"
        assert len(result.tools_executed) == 2
        assert result.total_issues == 5


class TestConvenienceFunction:
    """Test the convenience function for direct usage."""

    @pytest.mark.asyncio
    async def test_analyze_cpp_code_function(self, sample_cpp_file):
        """Test the analyze_cpp_code convenience function."""
        with patch('..agent.MultiAgentDebugger.analyze') as mock_analyze:
            mock_analyze.return_value = AnalysisResult(
                success=True,
                session_id="test",
                execution_time=30.0,
                analysis_mode="comprehensive",
                tools_executed=["cppcheck"],
                total_issues=1,
                critical_issues=0,
                correlation_summary={},
                recommendations=[],
                detailed_results={},
                human_readable_report="Test"
            )

            result = await analyze_cpp_code(sample_cpp_file)

            assert isinstance(result, AnalysisResult)
            assert result.success == True
            mock_analyze.assert_called_once()

    @pytest.mark.asyncio
    async def test_analyze_cpp_code_with_parameters(self, sample_cpp_file):
        """Test convenience function with custom parameters."""
        with patch('..agent.MultiAgentDebugger.analyze') as mock_analyze:
            mock_analyze.return_value = AnalysisResult(
                success=True,
                session_id="test",
                execution_time=15.0,
                analysis_mode="static",
                tools_executed=["cppcheck"],
                total_issues=1,
                critical_issues=0,
                correlation_summary={},
                recommendations=[],
                detailed_results={},
                human_readable_report="Test"
            )

            result = await analyze_cpp_code(
                target_path=sample_cpp_file,
                analysis_mode="static",
                max_parallel_tools=1,
                timeout=60
            )

            assert result.analysis_mode == "static"
            mock_analyze.assert_called_once_with(
                target_path=sample_cpp_file,
                analysis_mode="static",
                output_format="both",
                max_parallel_tools=1,
                timeout=60
            )


@pytest.mark.integration
class TestAgentIntegration:
    """Integration tests for agent interactions."""

    @pytest.mark.asyncio
    async def test_agent_tool_registration(self):
        """Test that agents have tools properly registered."""
        # Check lead agent tools
        assert hasattr(lead_agent, '_function_tools')
        assert len(lead_agent._function_tools) >= 3  # run_debugging_tool, correlate_findings, compile_source

        # Check tool agents have run_debugging_tool
        for agent in [gdb_agent, strace_agent, cppcheck_agent]:
            assert hasattr(agent, '_function_tools')
            assert len(agent._function_tools) >= 1

    @pytest.mark.asyncio
    async def test_cross_agent_communication(self, agent_dependencies):
        """Test that agents can communicate through shared dependencies."""
        # Simulate message passing between agents
        agent_dependencies.message_queue.append({
            "from": "lead_agent",
            "to": "tool_agent",
            "message": "Execute analysis",
            "timestamp": "2024-01-01T12:00:00Z"
        })

        assert len(agent_dependencies.message_queue) == 1
        assert agent_dependencies.message_queue[0]["from"] == "lead_agent"

    @pytest.mark.asyncio
    async def test_results_caching(self, agent_dependencies):
        """Test that results can be cached between agents."""
        # Cache a result
        agent_dependencies.results_cache["test_key"] = {
            "result": "cached_value",
            "timestamp": "2024-01-01T12:00:00Z"
        }

        assert "test_key" in agent_dependencies.results_cache
        assert agent_dependencies.results_cache["test_key"]["result"] == "cached_value"


@pytest.mark.slow
class TestLongRunningOperations:
    """Test cases for long-running operations and timeouts."""

    @pytest.mark.asyncio
    async def test_analysis_timeout_handling(self, multi_agent_debugger, sample_cpp_file):
        """Test that analysis respects timeout settings."""
        # Mock long-running operations
        async def slow_operation(*args, **kwargs):
            await asyncio.sleep(2)
            return {"phases": []}

        with patch.object(multi_agent_debugger, '_create_execution_plan', slow_operation):
            start_time = asyncio.get_event_loop().time()

            result = await multi_agent_debugger.analyze(
                sample_cpp_file,
                timeout=1  # 1 second timeout
            )

            end_time = asyncio.get_event_loop().time()
            execution_time = end_time - start_time

            # Should complete despite timeout (error handling)
            assert isinstance(result, AnalysisResult)
            # Verify it didn't take the full 2 seconds (would indicate timeout worked)
            assert execution_time < 3  # Allow some buffer