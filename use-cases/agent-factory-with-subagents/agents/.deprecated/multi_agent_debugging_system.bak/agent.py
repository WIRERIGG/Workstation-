"""
Main Multi-Agent Debugging System implementation.
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Union

from pydantic_ai import Agent, RunContext
from pydantic import BaseModel

from .providers import get_llm_model
from .dependencies import (
    AgentDependencies, DebuggingContext, AnalysisMode, ToolType,
    create_debugging_context, ToolResult
)
from .prompts import (
    LEAD_AGENT_PROMPT, TOOL_AGENT_PROMPT_TEMPLATE,
    DETAIL_AGENT_PROMPT, PLAN_AGENT_PROMPT
)
from .tools import run_debugging_tool, correlate_findings, compile_source


class AnalysisRequest(BaseModel):
    """Request model for debugging analysis."""
    target_path: str
    analysis_mode: str = "comprehensive"
    output_format: str = "both"
    max_parallel_tools: int = 4
    timeout: int = 300


class AnalysisResult(BaseModel):
    """Result model for debugging analysis."""
    success: bool
    session_id: str
    execution_time: float
    analysis_mode: str
    tools_executed: List[str]
    total_issues: int
    critical_issues: int
    correlation_summary: Dict[str, Any]
    recommendations: List[str]
    detailed_results: Dict[str, Any]
    human_readable_report: str


# Initialize Lead Agent
lead_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=LEAD_AGENT_PROMPT
)

# Initialize Tool Agents
gdb_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=TOOL_AGENT_PROMPT_TEMPLATE.format(tool_name="GDB")
)

strace_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=TOOL_AGENT_PROMPT_TEMPLATE.format(tool_name="strace")
)

ltrace_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=TOOL_AGENT_PROMPT_TEMPLATE.format(tool_name="ltrace")
)

perf_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=TOOL_AGENT_PROMPT_TEMPLATE.format(tool_name="perf")
)

cppcheck_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=TOOL_AGENT_PROMPT_TEMPLATE.format(tool_name="cppcheck")
)

clang_tidy_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=TOOL_AGENT_PROMPT_TEMPLATE.format(tool_name="clang-tidy")
)

valgrind_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=TOOL_AGENT_PROMPT_TEMPLATE.format(tool_name="valgrind")
)

# Initialize coordination agents
detail_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=DETAIL_AGENT_PROMPT
)

plan_agent = Agent(
    get_llm_model(),
    deps_type=AgentDependencies,
    system_prompt=PLAN_AGENT_PROMPT
)

# Register tools with agents
lead_agent.tool(run_debugging_tool)
lead_agent.tool(correlate_findings)
lead_agent.tool(compile_source)

for agent in [gdb_agent, strace_agent, ltrace_agent, perf_agent,
              cppcheck_agent, clang_tidy_agent, valgrind_agent]:
    agent.tool(run_debugging_tool)

detail_agent.tool(correlate_findings)
plan_agent.tool(compile_source)


class MultiAgentDebugger:
    """Main orchestrator for the multi-agent debugging system."""

    def __init__(self):
        self.tool_agents = {
            ToolType.GDB: gdb_agent,
            ToolType.STRACE: strace_agent,
            ToolType.LTRACE: ltrace_agent,
            ToolType.PERF: perf_agent,
            ToolType.CPPCHECK: cppcheck_agent,
            ToolType.CLANG_TIDY: clang_tidy_agent,
            ToolType.VALGRIND: valgrind_agent
        }

    async def analyze(
        self,
        target_path: str,
        analysis_mode: str = "comprehensive",
        output_format: str = "both",
        max_parallel_tools: int = 4,
        timeout: int = 300
    ) -> AnalysisResult:
        """
        Perform comprehensive multi-agent debugging analysis.

        Args:
            target_path: Path to C++ source file or binary
            analysis_mode: Analysis type (static, dynamic, comprehensive)
            output_format: Output format (json, human, both)
            max_parallel_tools: Maximum parallel tool executions
            timeout: Analysis timeout in seconds

        Returns:
            Complete analysis results
        """
        start_time = time.time()

        try:
            # Create debugging context
            mode = AnalysisMode(analysis_mode)
            context = create_debugging_context(target_path, mode)

            # Initialize agent dependencies
            deps = AgentDependencies(
                context=context,
                message_queue=[],
                results_cache={}
            )

            # Phase 1: Planning
            print(f"🎯 Phase 1: Creating execution plan for {analysis_mode} analysis...")
            execution_plan = await self._create_execution_plan(deps, max_parallel_tools)

            # Phase 2: Compilation (if needed)
            if context.build_required and mode in [AnalysisMode.DYNAMIC, AnalysisMode.COMPREHENSIVE]:
                print("🔨 Phase 2: Compiling source code for dynamic analysis...")
                compilation_result = await self._handle_compilation(deps, target_path)
                if not compilation_result["success"]:
                    print(f"⚠️  Compilation failed, switching to static-only analysis")
                    mode = AnalysisMode.STATIC

            # Phase 3: Parallel tool execution
            print(f"⚡ Phase 3: Executing tools in parallel (max {max_parallel_tools})...")
            tool_results = await self._execute_tools_parallel(deps, execution_plan, max_parallel_tools)

            # Phase 4: Correlation and analysis
            print("🔍 Phase 4: Correlating findings across tools...")
            correlation_result = await self._correlate_results(deps, tool_results)

            # Phase 5: Generate comprehensive report
            print("📊 Phase 5: Generating final analysis report...")
            final_report = await self._generate_final_report(
                deps, tool_results, correlation_result, output_format
            )

            execution_time = time.time() - start_time

            return AnalysisResult(
                success=True,
                session_id=context.session_id,
                execution_time=execution_time,
                analysis_mode=analysis_mode,
                tools_executed=[r["tool_name"] for r in tool_results if r.get("success", False)],
                total_issues=sum(len(r.get("issues", [])) for r in tool_results),
                critical_issues=len([
                    issue for r in tool_results
                    for issue in r.get("issues", [])
                    if issue.get("severity") == "critical"
                ]),
                correlation_summary=correlation_result,
                recommendations=correlation_result.get("recommendations", []),
                detailed_results={
                    "tool_results": tool_results,
                    "correlation": correlation_result,
                    "execution_plan": execution_plan
                },
                human_readable_report=final_report
            )

        except Exception as e:
            execution_time = time.time() - start_time
            return AnalysisResult(
                success=False,
                session_id="failed",
                execution_time=execution_time,
                analysis_mode=analysis_mode,
                tools_executed=[],
                total_issues=0,
                critical_issues=0,
                correlation_summary={},
                recommendations=[f"Analysis failed: {str(e)}"],
                detailed_results={"error": str(e)},
                human_readable_report=f"Analysis failed: {str(e)}"
            )

    async def _create_execution_plan(self, deps: AgentDependencies, max_parallel: int) -> Dict[str, Any]:
        """Create optimal execution plan using Plan Agent."""
        try:
            plan_prompt = f"""
            Create an execution plan for {deps.context.analysis_mode.value} analysis of {deps.context.target_path}.

            Available tools: {[tool.value for tool in deps.context.available_tools]}
            Max parallel executions: {max_parallel}

            Consider:
            1. Tool dependencies (dynamic tools need compilation)
            2. Resource constraints and optimal parallelization
            3. Tool-specific requirements and interactions

            Return a structured execution plan with phases and tool groupings.
            """

            result = await plan_agent.run(plan_prompt, deps=deps)

            # Extract execution phases from result
            if isinstance(result.data, str):
                # Default plan if planning fails
                static_tools = [t for t in deps.context.available_tools
                              if t in [ToolType.CPPCHECK, ToolType.CLANG_TIDY]]
                dynamic_tools = [t for t in deps.context.available_tools
                               if t in [ToolType.GDB, ToolType.STRACE, ToolType.LTRACE, ToolType.PERF, ToolType.VALGRIND]]

                return {
                    "phases": [
                        {"name": "static_analysis", "tools": [t.value for t in static_tools], "parallel": True},
                        {"name": "dynamic_analysis", "tools": [t.value for t in dynamic_tools], "parallel": True}
                    ],
                    "estimated_duration": 180,
                    "resource_requirements": {"cpu": "medium", "memory": "low"}
                }

            return {"phases": [], "estimated_duration": 300, "resource_requirements": {}}

        except Exception as e:
            print(f"Warning: Plan creation failed: {e}")
            # Return basic plan
            return {
                "phases": [{"name": "all_tools", "tools": [t.value for t in deps.context.available_tools], "parallel": True}],
                "estimated_duration": 300,
                "resource_requirements": {}
            }

    async def _handle_compilation(self, deps: AgentDependencies, target_path: str) -> Dict[str, Any]:
        """Handle source code compilation."""
        return await compile_source(
            RunContext(deps=deps),
            target_path,
            build_type="debug",
            additional_flags=["-g", "-O0"]
        )

    async def _execute_tools_parallel(
        self,
        deps: AgentDependencies,
        execution_plan: Dict[str, Any],
        max_parallel: int
    ) -> List[Dict[str, Any]]:
        """Execute debugging tools in parallel according to execution plan."""
        all_results = []

        for phase in execution_plan.get("phases", []):
            phase_tools = phase.get("tools", [])
            if not phase_tools:
                continue

            print(f"  Executing {phase['name']}: {', '.join(phase_tools)}")

            if phase.get("parallel", True):
                # Execute tools in parallel with semaphore
                semaphore = asyncio.Semaphore(max_parallel)
                tasks = []

                for tool_name in phase_tools:
                    if ToolType(tool_name) in deps.context.available_tools:
                        task = self._execute_single_tool_with_semaphore(
                            semaphore, deps, tool_name
                        )
                        tasks.append(task)

                if tasks:
                    results = await asyncio.gather(*tasks, return_exceptions=True)
                    for result in results:
                        if isinstance(result, Exception):
                            print(f"    Tool execution failed: {result}")
                        else:
                            all_results.append(result)
            else:
                # Execute tools sequentially
                for tool_name in phase_tools:
                    if ToolType(tool_name) in deps.context.available_tools:
                        result = await self._execute_single_tool(deps, tool_name)
                        all_results.append(result)

        return all_results

    async def _execute_single_tool_with_semaphore(
        self,
        semaphore: asyncio.Semaphore,
        deps: AgentDependencies,
        tool_name: str
    ) -> Dict[str, Any]:
        """Execute a single tool with concurrency control."""
        async with semaphore:
            return await self._execute_single_tool(deps, tool_name)

    async def _execute_single_tool(self, deps: AgentDependencies, tool_name: str) -> Dict[str, Any]:
        """Execute a single debugging tool."""
        try:
            target_path = deps.context.compiled_binary or deps.context.target_path

            # Get the appropriate agent for this tool
            tool_type = ToolType(tool_name)
            agent = self.tool_agents.get(tool_type)

            if agent:
                # Use the specialized agent for this tool
                prompt = f"Execute {tool_name} analysis on {target_path} and provide structured findings."
                result = await agent.run(prompt, deps=deps)

                # If agent returns structured data, use it; otherwise call tool directly
                if hasattr(result, 'data') and isinstance(result.data, dict):
                    return result.data

            # Fallback to direct tool execution
            return await run_debugging_tool(
                RunContext(deps=deps),
                tool_name,
                target_path
            )

        except Exception as e:
            return {
                "tool_name": tool_name,
                "success": False,
                "error": str(e),
                "issues": []
            }

    async def _correlate_results(self, deps: AgentDependencies, tool_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Correlate findings using Detail Agent."""
        try:
            # First run basic correlation
            correlation_result = await correlate_findings(
                RunContext(deps=deps),
                tool_results,
                correlation_threshold=0.7
            )

            # Enhance with Detail Agent analysis
            analysis_prompt = f"""
            Analyze the correlation results from multiple debugging tools:

            Total issues found: {correlation_result.get('total_raw_issues', 0)}
            Issue groups: {correlation_result.get('correlated_groups', 0)}
            High priority issues: {correlation_result.get('high_priority_issues', 0)}

            Provide additional insights on:
            1. Cross-tool validation of findings
            2. Potential root causes for issue clusters
            3. Priority recommendations for fixing
            4. Confidence assessment for each finding group
            """

            detail_result = await detail_agent.run(analysis_prompt, deps=deps)

            # Combine basic correlation with detailed analysis
            enhanced_result = correlation_result.copy()
            enhanced_result["detail_analysis"] = getattr(detail_result, 'data', str(detail_result))

            return enhanced_result

        except Exception as e:
            print(f"Warning: Correlation failed: {e}")
            return {
                "correlation_success": False,
                "error": str(e),
                "issue_groups": [],
                "recommendations": []
            }

    async def _generate_final_report(
        self,
        deps: AgentDependencies,
        tool_results: List[Dict[str, Any]],
        correlation_result: Dict[str, Any],
        output_format: str
    ) -> str:
        """Generate final comprehensive report."""
        try:
            summary_prompt = f"""
            Generate a comprehensive debugging analysis report based on:

            Target: {deps.context.target_path}
            Analysis Mode: {deps.context.analysis_mode.value}
            Tools Executed: {len(tool_results)}
            Total Issues: {sum(len(r.get('issues', [])) for r in tool_results)}

            Correlation Summary:
            - Issue groups: {correlation_result.get('correlated_groups', 0)}
            - High priority: {correlation_result.get('high_priority_issues', 0)}
            - Tool consensus score: {correlation_result.get('summary', {}).get('tools_consensus', 0)}

            Provide:
            1. Executive summary with key findings
            2. Critical issues that require immediate attention
            3. Prioritized recommendations with rationale
            4. Tool-specific insights and their reliability
            5. Overall code quality assessment

            Format: Professional technical report suitable for development teams.
            """

            report_result = await lead_agent.run(summary_prompt, deps=deps)
            return getattr(report_result, 'data', str(report_result))

        except Exception as e:
            return f"Report generation failed: {str(e)}"


# Convenience function for direct usage
async def analyze_cpp_code(
    target_path: str,
    analysis_mode: str = "comprehensive",
    output_format: str = "both",
    max_parallel_tools: int = 4,
    timeout: int = 300
) -> AnalysisResult:
    """
    Convenience function to analyze C++ code with multi-agent debugging system.

    Args:
        target_path: Path to C++ source file or binary
        analysis_mode: Analysis type (static, dynamic, comprehensive)
        output_format: Output format (json, human, both)
        max_parallel_tools: Maximum parallel tool executions
        timeout: Analysis timeout in seconds

    Returns:
        Complete analysis results
    """
    debugger = MultiAgentDebugger()
    return await debugger.analyze(
        target_path=target_path,
        analysis_mode=analysis_mode,
        output_format=output_format,
        max_parallel_tools=max_parallel_tools,
        timeout=timeout
    )