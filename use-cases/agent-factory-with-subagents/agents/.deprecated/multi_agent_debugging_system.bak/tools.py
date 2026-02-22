"""
Tool implementations for Multi-Agent Debugging System.
"""

import asyncio
import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from pydantic_ai import RunContext

from .dependencies import AgentDependencies, ToolResult, ToolType, AnalysisMode
from .settings import settings


async def run_debugging_tool(
    ctx: RunContext[AgentDependencies],
    tool_name: str,
    target_path: str,
    tool_args: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Execute a C++ debugging tool and return structured results.

    Args:
        ctx: Runtime context with dependencies
        tool_name: Name of the debugging tool to run
        target_path: Path to the target file/binary
        tool_args: Optional additional arguments for the tool

    Returns:
        Dictionary with execution results and structured findings
    """
    start_time = time.time()
    tool_args = tool_args or []

    try:
        # Get tool-specific command configuration
        command, tool_specific_args = _get_tool_command(tool_name, target_path, tool_args)

        # Execute the tool with timeout
        process = await asyncio.create_subprocess_exec(
            *command,
            *tool_specific_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=ctx.deps.context.output_dir
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=settings.analysis_timeout
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise subprocess.TimeoutExpired(command[0], settings.analysis_timeout)

        execution_time = time.time() - start_time

        # Parse tool output and extract issues
        issues_found = _parse_tool_output(tool_name, stdout.decode(), stderr.decode())

        # Create tool result
        result = ToolResult(
            tool_name=tool_name,
            command=" ".join(command + tool_specific_args),
            exit_code=process.returncode,
            stdout=stdout.decode(),
            stderr=stderr.decode(),
            execution_time=execution_time,
            issues_found=issues_found,
            success=process.returncode == 0 or len(issues_found) > 0,  # Some tools return non-zero when finding issues
            error_message=None
        )

        # Cache the result
        await ctx.deps.cache_result(tool_name, result)

        return {
            "tool_name": tool_name,
            "success": result.success,
            "execution_time": execution_time,
            "issues_count": len(issues_found),
            "issues": issues_found,
            "raw_output": stdout.decode(),
            "command": result.command
        }

    except Exception as e:
        execution_time = time.time() - start_time
        error_result = ToolResult(
            tool_name=tool_name,
            command=f"Failed to execute {tool_name}",
            exit_code=-1,
            stdout="",
            stderr="",
            execution_time=execution_time,
            issues_found=[],
            success=False,
            error_message=str(e)
        )

        await ctx.deps.cache_result(tool_name, error_result)

        return {
            "tool_name": tool_name,
            "success": False,
            "execution_time": execution_time,
            "error": str(e),
            "issues": []
        }


async def correlate_findings(
    ctx: RunContext[AgentDependencies],
    tool_results: List[Dict[str, Any]],
    correlation_threshold: float = 0.7,
    priority_mode: str = "severity"
) -> Dict[str, Any]:
    """
    Correlate findings across multiple debugging tools.

    Args:
        ctx: Runtime context with dependencies
        tool_results: List of tool execution results
        correlation_threshold: Minimum confidence for correlation
        priority_mode: Prioritization method (severity, confidence, consensus)

    Returns:
        Dictionary with correlated findings and recommendations
    """
    start_time = time.time()

    try:
        # Extract all issues from tool results
        all_issues = []
        for result in tool_results:
            if result.get("success", False):
                for issue in result.get("issues", []):
                    issue["source_tool"] = result["tool_name"]
                    all_issues.append(issue)

        # Group issues by similarity
        issue_groups = _group_similar_issues(all_issues, correlation_threshold)

        # Rank and prioritize issue groups
        prioritized_groups = _prioritize_issue_groups(issue_groups, priority_mode)

        # Generate consolidated recommendations
        recommendations = _generate_recommendations(prioritized_groups)

        execution_time = time.time() - start_time

        return {
            "correlation_success": True,
            "execution_time": execution_time,
            "total_raw_issues": len(all_issues),
            "correlated_groups": len(issue_groups),
            "high_priority_issues": len([g for g in prioritized_groups if g["priority"] == "high"]),
            "issue_groups": prioritized_groups,
            "recommendations": recommendations,
            "summary": {
                "critical_issues": len([g for g in prioritized_groups if g["severity"] == "critical"]),
                "tools_consensus": _calculate_tool_consensus(issue_groups),
                "confidence_score": _calculate_overall_confidence(prioritized_groups)
            }
        }

    except Exception as e:
        execution_time = time.time() - start_time
        return {
            "correlation_success": False,
            "execution_time": execution_time,
            "error": str(e),
            "issue_groups": [],
            "recommendations": []
        }


async def compile_source(
    ctx: RunContext[AgentDependencies],
    source_path: str,
    build_type: str = "debug",
    additional_flags: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Compile C++ source code for dynamic analysis.

    Args:
        ctx: Runtime context with dependencies
        source_path: Path to source file or directory
        build_type: Build configuration (debug, release, analysis)
        additional_flags: Additional compiler flags

    Returns:
        Dictionary with compilation results
    """
    start_time = time.time()
    additional_flags = additional_flags or []

    try:
        source_path_obj = Path(source_path)

        # Determine build method
        if source_path_obj.name == "CMakeLists.txt" or (source_path_obj / "CMakeLists.txt").exists():
            result = await _compile_with_cmake(source_path, build_type, additional_flags, ctx)
        elif source_path_obj.name == "Makefile" or (source_path_obj / "Makefile").exists():
            result = await _compile_with_make(source_path, build_type, additional_flags, ctx)
        else:
            result = await _compile_direct(source_path, build_type, additional_flags, ctx)

        execution_time = time.time() - start_time
        result["execution_time"] = execution_time

        # Update context with compiled binary path
        if result["success"] and result.get("binary_path"):
            ctx.deps.context.compiled_binary = result["binary_path"]

        return result

    except Exception as e:
        execution_time = time.time() - start_time
        return {
            "success": False,
            "execution_time": execution_time,
            "error": str(e),
            "binary_path": None,
            "build_log": ""
        }


def _get_tool_command(tool_name: str, target_path: str, args: List[str]) -> Tuple[List[str], List[str]]:
    """Get command and arguments for a specific debugging tool."""
    tool_configs = {
        "gdb": ([settings.gdb_path], ["--batch", "--ex", "run", "--ex", "bt", "--args", target_path] + args),
        "strace": ([settings.strace_path], ["-c", "-f", target_path] + args),
        "ltrace": ([settings.ltrace_path], ["-c", "-f", target_path] + args),
        "perf": ([settings.perf_path], ["stat", "-d", target_path] + args),
        "cppcheck": ([settings.cppcheck_path], ["--enable=all", "--json", target_path] + args),
        "clang-tidy": ([settings.clang_tidy_path], [target_path, "--"] + args),
        "valgrind": ([settings.valgrind_path], ["--leak-check=full", "--show-leak-kinds=all", "--track-origins=yes", target_path] + args)
    }

    if tool_name not in tool_configs:
        raise ValueError(f"Unknown tool: {tool_name}")

    return tool_configs[tool_name]


def _parse_tool_output(tool_name: str, stdout: str, stderr: str) -> List[Dict[str, Any]]:
    """Parse tool output and extract structured issues."""
    issues = []

    if tool_name == "cppcheck":
        # Parse cppcheck JSON output
        try:
            if stdout.strip():
                data = json.loads(stdout)
                for error in data.get("errors", []):
                    issues.append({
                        "severity": error.get("severity", "unknown"),
                        "message": error.get("message", ""),
                        "file": error.get("file", ""),
                        "line": error.get("line", 0),
                        "id": error.get("id", ""),
                        "confidence": 0.9
                    })
        except json.JSONDecodeError:
            # Fallback to text parsing
            for line in stdout.split('\n'):
                if '[' in line and ']' in line:
                    issues.append({
                        "severity": "medium",
                        "message": line.strip(),
                        "confidence": 0.7
                    })

    elif tool_name == "clang-tidy":
        # Parse clang-tidy output
        for line in stdout.split('\n'):
            if 'warning:' in line or 'error:' in line:
                issues.append({
                    "severity": "high" if "error:" in line else "medium",
                    "message": line.strip(),
                    "confidence": 0.8
                })

    elif tool_name == "valgrind":
        # Parse valgrind output for memory issues
        for line in stderr.split('\n'):
            if 'definitely lost:' in line or 'possibly lost:' in line:
                if not line.strip().endswith("0 bytes in 0 blocks"):
                    issues.append({
                        "severity": "high",
                        "message": line.strip(),
                        "category": "memory_leak",
                        "confidence": 0.95
                    })

    elif tool_name == "gdb":
        # Parse GDB backtrace output
        for line in stdout.split('\n'):
            if 'Segmentation fault' in line or 'SIGSEGV' in line:
                issues.append({
                    "severity": "critical",
                    "message": line.strip(),
                    "category": "segfault",
                    "confidence": 1.0
                })

    # Generic parsing for other tools
    else:
        # Look for common error patterns
        error_patterns = [
            ("error", "high", 0.8),
            ("warning", "medium", 0.6),
            ("leak", "high", 0.9),
            ("undefined", "medium", 0.7),
            ("overflow", "high", 0.9)
        ]

        for line in (stdout + stderr).split('\n'):
            line_lower = line.lower()
            for pattern, severity, confidence in error_patterns:
                if pattern in line_lower:
                    issues.append({
                        "severity": severity,
                        "message": line.strip(),
                        "confidence": confidence
                    })
                    break

    return issues


def _group_similar_issues(issues: List[Dict[str, Any]], threshold: float) -> List[Dict[str, Any]]:
    """Group similar issues together for correlation."""
    groups = []

    for issue in issues:
        # Find existing group for this issue
        grouped = False
        for group in groups:
            # Simple similarity based on message content and location
            similarity = _calculate_similarity(issue, group["representative"])
            if similarity >= threshold:
                group["issues"].append(issue)
                group["tool_consensus"].add(issue["source_tool"])
                grouped = True
                break

        if not grouped:
            # Create new group
            groups.append({
                "representative": issue,
                "issues": [issue],
                "tool_consensus": {issue["source_tool"]},
                "confidence": issue.get("confidence", 0.5)
            })

    return groups


def _calculate_similarity(issue1: Dict[str, Any], issue2: Dict[str, Any]) -> float:
    """Calculate similarity between two issues."""
    # Simple similarity based on message and location
    score = 0.0

    # Check message similarity (simple word overlap)
    msg1_words = set(issue1.get("message", "").lower().split())
    msg2_words = set(issue2.get("message", "").lower().split())
    if msg1_words and msg2_words:
        overlap = len(msg1_words & msg2_words)
        total = len(msg1_words | msg2_words)
        score += 0.6 * (overlap / total) if total > 0 else 0

    # Check location similarity
    if issue1.get("file") == issue2.get("file"):
        score += 0.2
        line_diff = abs(issue1.get("line", 0) - issue2.get("line", 0))
        if line_diff <= 5:  # Same or nearby lines
            score += 0.2

    return min(score, 1.0)


def _prioritize_issue_groups(groups: List[Dict[str, Any]], mode: str) -> List[Dict[str, Any]]:
    """Prioritize issue groups based on specified criteria."""
    severity_order = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

    for group in groups:
        # Calculate group priority
        max_severity = max(
            (severity_order.get(issue.get("severity", "low"), 1) for issue in group["issues"]),
            default=1
        )

        # Convert back to severity name
        severity_names = {v: k for k, v in severity_order.items()}
        group["severity"] = severity_names.get(max_severity, "low")

        # Calculate consensus score
        tool_count = len(group["tool_consensus"])
        group["consensus_score"] = tool_count / 7.0  # Normalize by total tool count

        # Assign priority
        if max_severity >= 3 and tool_count >= 2:
            group["priority"] = "high"
        elif max_severity >= 2 or tool_count >= 2:
            group["priority"] = "medium"
        else:
            group["priority"] = "low"

    # Sort by priority and confidence
    return sorted(groups, key=lambda g: (
        {"high": 3, "medium": 2, "low": 1}[g["priority"]],
        g["consensus_score"],
        g["confidence"]
    ), reverse=True)


def _generate_recommendations(groups: List[Dict[str, Any]]) -> List[str]:
    """Generate actionable recommendations from issue groups."""
    recommendations = []

    # Focus on high-priority groups
    high_priority = [g for g in groups if g["priority"] == "high"]

    if high_priority:
        recommendations.append(f"Address {len(high_priority)} critical issues with multi-tool consensus")

    # Memory-related recommendations
    memory_issues = [g for g in groups if any("leak" in i.get("message", "").lower() for i in g["issues"])]
    if memory_issues:
        recommendations.append("Review memory management: potential leaks detected by multiple tools")

    # Security recommendations
    security_keywords = ["overflow", "underflow", "injection", "vulnerability"]
    security_issues = [g for g in groups if any(
        any(keyword in i.get("message", "").lower() for keyword in security_keywords)
        for i in g["issues"]
    )]
    if security_issues:
        recommendations.append("Security review required: potential vulnerabilities detected")

    # Performance recommendations
    if any("perf" in g["tool_consensus"] for g in groups):
        recommendations.append("Performance optimization opportunities identified")

    return recommendations[:10]  # Limit to top 10 recommendations


def _calculate_tool_consensus(groups: List[Dict[str, Any]]) -> float:
    """Calculate overall tool consensus score."""
    if not groups:
        return 0.0

    total_consensus = sum(len(g["tool_consensus"]) for g in groups)
    max_possible = len(groups) * 7  # 7 tools max
    return total_consensus / max_possible if max_possible > 0 else 0.0


def _calculate_overall_confidence(groups: List[Dict[str, Any]]) -> float:
    """Calculate overall confidence score."""
    if not groups:
        return 0.0

    return sum(g["confidence"] for g in groups) / len(groups)


async def _compile_with_cmake(source_path: str, build_type: str, flags: List[str], ctx) -> Dict[str, Any]:
    """Compile using CMake."""
    build_dir = Path(ctx.deps.context.output_dir) / "cmake_build"
    build_dir.mkdir(exist_ok=True)

    # Configure
    configure_cmd = ["cmake", "-S", source_path, "-B", str(build_dir), f"-DCMAKE_BUILD_TYPE={build_type.title()}"]
    process = await asyncio.create_subprocess_exec(*configure_cmd, capture_output=True)
    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        return {
            "success": False,
            "error": f"CMake configuration failed: {stderr.decode()}",
            "build_log": stdout.decode() + stderr.decode()
        }

    # Build
    build_cmd = ["cmake", "--build", str(build_dir)]
    process = await asyncio.create_subprocess_exec(*build_cmd, capture_output=True)
    stdout, stderr = await process.communicate()

    success = process.returncode == 0
    binary_path = None
    if success:
        # Find the built binary
        for item in build_dir.rglob("*"):
            if item.is_file() and item.stat().st_mode & 0o111:  # Executable
                binary_path = str(item)
                break

    return {
        "success": success,
        "binary_path": binary_path,
        "build_log": stdout.decode() + stderr.decode()
    }


async def _compile_with_make(source_path: str, build_type: str, flags: List[str], ctx) -> Dict[str, Any]:
    """Compile using Make."""
    process = await asyncio.create_subprocess_exec(
        "make", "-C", source_path,
        capture_output=True
    )
    stdout, stderr = await process.communicate()

    success = process.returncode == 0
    binary_path = None
    if success:
        # Look for common binary names
        source_dir = Path(source_path)
        for name in ["main", "a.out", source_dir.name]:
            potential_binary = source_dir / name
            if potential_binary.exists() and potential_binary.stat().st_mode & 0o111:
                binary_path = str(potential_binary)
                break

    return {
        "success": success,
        "binary_path": binary_path,
        "build_log": stdout.decode() + stderr.decode()
    }


async def _compile_direct(source_path: str, build_type: str, flags: List[str], ctx) -> Dict[str, Any]:
    """Direct compilation with g++."""
    source_path_obj = Path(source_path)
    output_path = Path(ctx.deps.context.output_dir) / f"{source_path_obj.stem}_debug"

    compile_flags = ["-g", "-O0"] if build_type == "debug" else ["-O2"]
    compile_flags.extend(flags)

    cmd = [settings.compiler] + compile_flags + ["-o", str(output_path), source_path]

    process = await asyncio.create_subprocess_exec(*cmd, capture_output=True)
    stdout, stderr = await process.communicate()

    success = process.returncode == 0

    return {
        "success": success,
        "binary_path": str(output_path) if success else None,
        "build_log": stdout.decode() + stderr.decode()
    }