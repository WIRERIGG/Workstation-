"""
Dependencies and context management for Multi-Agent Debugging System.
"""

import asyncio
import json
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from enum import Enum


class AnalysisMode(str, Enum):
    """Analysis modes for debugging."""
    STATIC = "static"
    DYNAMIC = "dynamic"
    COMPREHENSIVE = "comprehensive"


class ToolType(str, Enum):
    """Available debugging tools."""
    GDB = "gdb"
    STRACE = "strace"
    LTRACE = "ltrace"
    PERF = "perf"
    CPPCHECK = "cppcheck"
    CLANG_TIDY = "clang-tidy"
    VALGRIND = "valgrind"


@dataclass
class DebuggingContext:
    """Context shared across debugging agents."""
    target_path: str
    analysis_mode: AnalysisMode
    output_dir: str
    session_id: str
    start_time: datetime
    available_tools: List[ToolType]
    build_required: bool = False
    compiled_binary: Optional[str] = None
    temp_dir: Optional[str] = None


@dataclass
class ToolResult:
    """Result from a debugging tool execution."""
    tool_name: str
    command: str
    exit_code: int
    stdout: str
    stderr: str
    execution_time: float
    issues_found: List[Dict[str, Any]]
    success: bool
    error_message: Optional[str] = None


@dataclass
class AgentMessage:
    """Message passed between agents."""
    sender: str
    recipient: str
    message_type: str
    payload: Dict[str, Any]
    timestamp: datetime


@dataclass
class AgentDependencies:
    """Dependencies for agent execution."""
    context: DebuggingContext
    message_queue: List[AgentMessage]
    results_cache: Dict[str, ToolResult]
    lock: Optional[asyncio.Lock] = None

    def __post_init__(self):
        if self.lock is None:
            self.lock = asyncio.Lock()

    async def send_message(self, sender: str, recipient: str, msg_type: str, payload: Dict[str, Any]):
        """Send a message between agents."""
        async with self.lock:
            message = AgentMessage(
                sender=sender,
                recipient=recipient,
                message_type=msg_type,
                payload=payload,
                timestamp=datetime.now()
            )
            self.message_queue.append(message)

    async def get_messages(self, recipient: str) -> List[AgentMessage]:
        """Get messages for a specific agent."""
        async with self.lock:
            messages = [msg for msg in self.message_queue if msg.recipient == recipient]
            # Remove retrieved messages
            self.message_queue = [msg for msg in self.message_queue if msg.recipient != recipient]
            return messages

    async def cache_result(self, tool_name: str, result: ToolResult):
        """Cache a tool execution result."""
        async with self.lock:
            self.results_cache[tool_name] = result

    async def get_cached_result(self, tool_name: str) -> Optional[ToolResult]:
        """Get cached tool result."""
        async with self.lock:
            return self.results_cache.get(tool_name)


def create_debugging_context(
    target_path: str,
    analysis_mode: AnalysisMode = AnalysisMode.COMPREHENSIVE,
    output_dir: Optional[str] = None
) -> DebuggingContext:
    """Create a debugging context for analysis."""
    session_id = f"debug_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix=f"debug_analysis_{session_id}_")

    # Determine available tools based on system
    available_tools = []
    tool_commands = {
        ToolType.GDB: "gdb",
        ToolType.STRACE: "strace",
        ToolType.LTRACE: "ltrace",
        ToolType.PERF: "perf",
        ToolType.CPPCHECK: "cppcheck",
        ToolType.CLANG_TIDY: "clang-tidy",
        ToolType.VALGRIND: "valgrind"
    }

    for tool_type, command in tool_commands.items():
        try:
            subprocess.run([command, "--version"], capture_output=True, check=True)
            available_tools.append(tool_type)
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass  # Tool not available

    # Determine if build is required
    target_path_obj = Path(target_path)
    build_required = target_path_obj.suffix in ['.cpp', '.cc', '.cxx', '.c']

    return DebuggingContext(
        target_path=target_path,
        analysis_mode=analysis_mode,
        output_dir=output_dir,
        session_id=session_id,
        start_time=datetime.now(),
        available_tools=available_tools,
        build_required=build_required
    )