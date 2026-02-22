# Multi-Agent Debugging System - Dependencies Configuration

## Environment Variables

### Essential Configuration
```bash
# Model Provider Configuration
OPENAI_API_KEY="your-api-key-here"
PYDANTIC_AI_MODEL="openai:gpt-4"

# Analysis Configuration
ANALYSIS_OUTPUT_DIR="/tmp/multi_agent_debug"
ANALYSIS_TIMEOUT_SECONDS="300"
MAX_PARALLEL_AGENTS="7"

# Tool Paths (auto-detected if in PATH)
GDB_PATH="/usr/bin/gdb"
STRACE_PATH="/usr/bin/strace"
LTRACE_PATH="/usr/bin/ltrace"
PERF_PATH="/usr/bin/perf"
CPPCHECK_PATH="/usr/bin/cppcheck"
CLANG_TIDY_PATH="/usr/bin/clang-tidy"
VALGRIND_PATH="/usr/bin/valgrind"

# Logging Configuration
LOG_LEVEL="INFO"
LOG_FILE="/tmp/multi_agent_debug.log"
```

## Python Dependencies

### Core Framework
```
# PydanticAI and validation
pydantic-ai>=0.0.13
pydantic>=2.0.0

# Async execution
asyncio

# System integration
subprocess
pathlib
json
uuid
datetime
typing
dataclasses

# Logging and utilities
logging
tempfile
shutil
os
signal
```

### Package Installation
```bash
pip install pydantic-ai pydantic
```

## System Dependencies

### Required Debugging Tools
```bash
# Static Analysis Tools
sudo apt-get install cppcheck clang-tidy

# Dynamic Analysis Tools
sudo apt-get install gdb strace ltrace linux-perf valgrind

# Build Requirements
sudo apt-get install build-essential cmake make
```

### Tool Version Requirements
- **gdb**: >= 8.0
- **valgrind**: >= 3.15
- **cppcheck**: >= 2.0
- **clang-tidy**: >= 10.0
- **strace**: >= 5.0
- **ltrace**: >= 0.7
- **perf**: >= 5.0

## Agent Dependencies Structure

### Core Data Models
```python
@dataclass
class AnalysisConfig:
    target_path: str
    mode: str  # "static", "dynamic", "comprehensive"
    timeout_seconds: int = 300
    max_parallel_agents: int = 7
    output_format: str = "json"  # "json", "human", "both"

@dataclass
class AgentContext:
    analysis_id: str
    config: AnalysisConfig
    temp_dir: str
    log_handler: Any

@dataclass
class Finding:
    id: str
    severity: str  # "critical", "high", "medium", "low"
    category: str  # "memory", "performance", "security", "style"
    source_agents: List[str]
    correlation_confidence: float
    location: Dict[str, Any]
    description: str
    recommendation: str

@dataclass
class AnalysisResult:
    analysis_id: str
    timestamp: str
    mode: str
    target: str
    agents_executed: List[str]
    findings: List[Finding]
    statistics: Dict[str, Any]
```

### Agent Communication Protocol
```python
@dataclass
class AgentMessage:
    sender: str
    recipient: str
    message_type: str  # "task", "result", "error", "status"
    payload: Dict[str, Any]
    timestamp: str
```

## Minimal Runtime Requirements

### System Resources
- **Memory**: 2GB minimum (4GB recommended)
- **Disk Space**: 1GB for temporary analysis files
- **CPU**: 2+ cores for parallel execution
- **OS**: Linux/Unix with standard debugging tools

### Directory Structure
```
/tmp/multi_agent_debug/
├── analysis_[uuid]/
│   ├── agent_outputs/
│   ├── correlation_data/
│   ├── final_results/
│   └── logs/
```

### File Permissions
- Read/write access to analysis output directory
- Execute permissions for debugging tools
- Temporary file creation capabilities

## Optional Enhancements (Future)

### Extended Model Support
```bash
# Alternative providers (not implemented in MVP)
ANTHROPIC_API_KEY="future-support"
GOOGLE_API_KEY="future-support"
```

### Advanced Configuration
```bash
# Resource limits (future enhancement)
MAX_MEMORY_MB="2048"
MAX_CPU_PERCENT="80"
PARALLEL_EXECUTION_MODE="intelligent"  # "sequential", "parallel", "intelligent"
```

### Additional Tools (Future)
- **AddressSanitizer**: Memory error detection
- **ThreadSanitizer**: Data race detection
- **UBSan**: Undefined behavior detection
- **gcov**: Code coverage analysis

## Validation Checklist

### Pre-execution Requirements
- [ ] All debugging tools available in PATH or specified paths
- [ ] API key configured for model provider
- [ ] Output directory writable
- [ ] Target C++ project buildable
- [ ] Sufficient system resources available

### Runtime Dependencies Check
```bash
# Tool availability verification
which gdb strace ltrace perf cppcheck clang-tidy valgrind

# Python package verification
python -c "import pydantic_ai, pydantic"

# Directory permissions
test -w $ANALYSIS_OUTPUT_DIR
```