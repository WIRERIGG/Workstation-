"""
Pytest configuration and fixtures for Multi-Agent Debugging System tests.
"""

import asyncio
import tempfile
import pytest
from pathlib import Path
from typing import Dict, Any, List
from unittest.mock import Mock, AsyncMock

from pydantic_ai import Agent
from pydantic_ai.models import TestModel, FunctionModel
from pydantic_ai.messages import ModelRequest, ModelResponse

from ..dependencies import (
    AgentDependencies, DebuggingContext, AnalysisMode, ToolType,
    create_debugging_context
)
from ..agent import MultiAgentDebugger
from ..providers import get_llm_model


@pytest.fixture
def sample_cpp_code():
    """Sample C++ code with various issues for testing."""
    return '''
#include <iostream>
#include <vector>
#include <memory>

class TestClass {
private:
    int* data;
    size_t size;

public:
    TestClass(size_t s) : size(s) {
        data = new int[size];  // Memory leak potential
    }

    ~TestClass() {
        // Missing delete[] - memory leak
    }

    void process() {
        for(size_t i = 0; i <= size; ++i) {  // Buffer overflow
            data[i] = i * 2;
        }
    }

    int getValue(size_t index) {
        return data[index];  // No bounds checking
    }
};

int main() {
    TestClass* obj = new TestClass(10);
    obj->process();

    // Memory leak - never deleted
    std::cout << obj->getValue(5) << std::endl;

    // Potential segfault
    std::cout << obj->getValue(15) << std::endl;

    return 0;
}
'''


@pytest.fixture
def sample_cpp_file(tmp_path, sample_cpp_code):
    """Create a temporary C++ file for testing."""
    cpp_file = tmp_path / "test_sample.cpp"
    cpp_file.write_text(sample_cpp_code)
    return str(cpp_file)


@pytest.fixture
def sample_binary_path(tmp_path):
    """Mock binary path for dynamic analysis testing."""
    binary_path = tmp_path / "test_binary"
    binary_path.touch()
    binary_path.chmod(0o755)
    return str(binary_path)


@pytest.fixture
def debugging_context(sample_cpp_file):
    """Create a debugging context for testing."""
    return create_debugging_context(
        target_path=sample_cpp_file,
        analysis_mode=AnalysisMode.COMPREHENSIVE
    )


@pytest.fixture
def agent_dependencies(debugging_context):
    """Create agent dependencies for testing."""
    return AgentDependencies(
        context=debugging_context,
        message_queue=[],
        results_cache={}
    )


@pytest.fixture
def mock_tool_results():
    """Mock tool execution results."""
    return [
        {
            "tool_name": "cppcheck",
            "success": True,
            "execution_time": 2.5,
            "issues": [
                {
                    "type": "error",
                    "severity": "critical",
                    "message": "Memory leak: data",
                    "file": "test_sample.cpp",
                    "line": 15,
                    "column": 9
                },
                {
                    "type": "warning",
                    "severity": "medium",
                    "message": "Array index out of bounds",
                    "file": "test_sample.cpp",
                    "line": 18,
                    "column": 13
                }
            ],
            "raw_output": "cppcheck output...",
            "metadata": {"version": "2.10", "database": "std.cfg"}
        },
        {
            "tool_name": "clang-tidy",
            "success": True,
            "execution_time": 3.2,
            "issues": [
                {
                    "type": "warning",
                    "severity": "medium",
                    "message": "Use smart pointers instead of raw pointers",
                    "file": "test_sample.cpp",
                    "line": 7,
                    "column": 5
                }
            ],
            "raw_output": "clang-tidy output...",
            "metadata": {"version": "15.0.0"}
        },
        {
            "tool_name": "valgrind",
            "success": True,
            "execution_time": 8.1,
            "issues": [
                {
                    "type": "error",
                    "severity": "critical",
                    "message": "Invalid write of size 4",
                    "file": "test_sample.cpp",
                    "line": 18,
                    "column": 13
                },
                {
                    "type": "error",
                    "severity": "critical",
                    "message": "40 bytes in 1 blocks are definitely lost",
                    "file": "test_sample.cpp",
                    "line": 10,
                    "column": 16
                }
            ],
            "raw_output": "valgrind output...",
            "metadata": {"version": "3.19.0"}
        }
    ]


@pytest.fixture
def mock_correlation_result():
    """Mock correlation analysis result."""
    return {
        "correlation_success": True,
        "total_raw_issues": 5,
        "correlated_groups": 2,
        "high_priority_issues": 3,
        "issue_groups": [
            {
                "id": "memory_leak_group",
                "type": "memory_management",
                "severity": "critical",
                "confidence": 0.95,
                "tools": ["cppcheck", "valgrind"],
                "primary_issue": "Memory leak in constructor/destructor",
                "related_issues": ["Missing delete[]", "Memory not freed"],
                "location": {"file": "test_sample.cpp", "lines": [10, 15]}
            },
            {
                "id": "bounds_check_group",
                "type": "buffer_overflow",
                "severity": "critical",
                "confidence": 0.88,
                "tools": ["cppcheck", "valgrind"],
                "primary_issue": "Buffer overflow in loop",
                "related_issues": ["Array index out of bounds", "Invalid write"],
                "location": {"file": "test_sample.cpp", "lines": [18]}
            }
        ],
        "recommendations": [
            "Implement RAII pattern with smart pointers",
            "Add bounds checking in array access",
            "Use vector instead of raw arrays"
        ],
        "summary": {
            "tools_consensus": 0.91,
            "overall_confidence": 0.89,
            "critical_path_analysis": "Memory management issues pose immediate risk"
        }
    }


class MockTestModel(TestModel):
    """Custom TestModel for debugging system testing."""

    def __init__(self, responses: List[str] = None):
        self.responses = responses or []
        self.call_count = 0
        super().__init__()

    async def agent_model(self, messages, model_settings=None) -> ModelResponse:
        """Return predetermined responses for testing."""
        if self.call_count < len(self.responses):
            response = self.responses[self.call_count]
        else:
            response = "Default test response"

        self.call_count += 1
        return ModelResponse(content=response, role='assistant')


@pytest.fixture
def test_model_responses():
    """Predefined responses for TestModel."""
    return [
        # Lead Agent response
        """Based on the analysis, I've identified several critical issues:
        1. Memory leak in TestClass constructor
        2. Buffer overflow in process() method
        3. Missing bounds checking in getValue()
        Priority: Fix memory management first.""",

        # Tool Agent responses
        "Cppcheck analysis complete. Found 2 critical memory issues.",
        "Clang-tidy analysis complete. Recommends smart pointer usage.",
        "Valgrind analysis complete. Detected memory leaks and buffer overflows.",

        # Plan Agent response
        """Execution plan:
        Phase 1: Static analysis (cppcheck, clang-tidy) - parallel
        Phase 2: Dynamic analysis (valgrind, gdb) - sequential
        Estimated duration: 180 seconds""",

        # Detail Agent response
        """Detailed correlation analysis:
        - Memory management issues are consistent across tools
        - High confidence in buffer overflow detection
        - Recommend immediate fixes for critical issues""",

        # Final report response
        """DEBUGGING ANALYSIS REPORT
        ========================
        Target: test_sample.cpp
        Critical Issues: 3
        Recommendations: Use RAII, add bounds checking, implement proper memory management"""
    ]


@pytest.fixture
def mock_test_model(test_model_responses):
    """Create TestModel with predefined responses."""
    return MockTestModel(responses=test_model_responses)


@pytest.fixture
def mock_agent_with_test_model(mock_test_model):
    """Create Agent instance using TestModel."""
    return Agent(
        model=mock_test_model,
        deps_type=AgentDependencies
    )


@pytest.fixture
def multi_agent_debugger():
    """Create MultiAgentDebugger instance for testing."""
    return MultiAgentDebugger()


@pytest.fixture
async def mock_subprocess_result():
    """Mock subprocess execution result."""
    mock_process = Mock()
    mock_process.communicate.return_value = (
        b"Mock tool output with findings",
        b"Mock tool errors"
    )
    mock_process.returncode = 0
    return mock_process


@pytest.fixture
def sample_execution_plan():
    """Sample execution plan for testing."""
    return {
        "phases": [
            {
                "name": "static_analysis",
                "tools": ["cppcheck", "clang-tidy"],
                "parallel": True
            },
            {
                "name": "dynamic_analysis",
                "tools": ["valgrind", "gdb"],
                "parallel": False
            }
        ],
        "estimated_duration": 180,
        "resource_requirements": {
            "cpu": "medium",
            "memory": "low"
        }
    }


@pytest.fixture
def mock_compilation_result():
    """Mock compilation result."""
    return {
        "success": True,
        "binary_path": "/tmp/test_binary",
        "compilation_time": 2.3,
        "warnings": [],
        "errors": [],
        "compiler_output": "Compilation successful"
    }


# Event loop fixture for async tests
@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


# Async test utilities
@pytest.fixture
async def async_mock_tool_execution():
    """Mock async tool execution."""
    async def mock_run_tool(tool_name, target_path):
        await asyncio.sleep(0.1)  # Simulate execution time
        return {
            "tool_name": tool_name,
            "success": True,
            "execution_time": 0.1,
            "issues": [{"type": "test", "message": f"Mock issue from {tool_name}"}]
        }
    return mock_run_tool


# Test data generators
def generate_test_issues(count: int = 3, severity: str = "medium") -> List[Dict[str, Any]]:
    """Generate test issues for validation."""
    issues = []
    for i in range(count):
        issues.append({
            "type": "warning",
            "severity": severity,
            "message": f"Test issue #{i+1}",
            "file": "test_file.cpp",
            "line": 10 + i,
            "column": 5
        })
    return issues


def generate_mock_agent_response(content: str, tool_calls: List[str] = None) -> Dict[str, Any]:
    """Generate mock agent response structure."""
    return {
        "content": content,
        "tool_calls": tool_calls or [],
        "metadata": {
            "timestamp": "2024-01-01T12:00:00Z",
            "model": "test-model",
            "usage": {"tokens": 100}
        }
    }


# Pytest configuration
def pytest_configure(config):
    """Configure pytest for the test suite."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
    config.addinivalue_line(
        "markers", "unit: marks tests as unit tests"
    )


# Clean up fixture
@pytest.fixture(autouse=True)
def cleanup_temp_files():
    """Automatically clean up temporary files after each test."""
    yield
    # Cleanup logic if needed
    import gc
    gc.collect()


# Mock environment variables
@pytest.fixture
def mock_env_vars(monkeypatch):
    """Mock environment variables for testing."""
    monkeypatch.setenv("DEBUGGING_TOOLS_PATH", "/usr/bin")
    monkeypatch.setenv("MAX_TOOL_TIMEOUT", "60")
    monkeypatch.setenv("ENABLE_TOOL_CACHING", "false")
    return {
        "DEBUGGING_TOOLS_PATH": "/usr/bin",
        "MAX_TOOL_TIMEOUT": "60",
        "ENABLE_TOOL_CACHING": "false"
    }