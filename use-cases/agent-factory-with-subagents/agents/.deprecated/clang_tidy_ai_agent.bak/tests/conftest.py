"""Test configuration for the Clang-Tidy AI Agent tests."""

import pytest
import pytest_asyncio
import tempfile
import sqlite3
from pathlib import Path
from unittest.mock import Mock, patch

from ..settings import ClangTidyAISettings
from ..dependencies import ClangTidyDependencies
from ..models import Warning, ClangTidyAnalysis

@pytest.fixture
def temp_dir():
    """Create temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)

@pytest.fixture
def test_settings(temp_dir):
    """Create test settings with temporary paths."""
    return ClangTidyAISettings(
        llm_provider="test",
        llm_api_key="test-key",
        llm_model="test-model",
        llm_base_url="http://test.local",
        clang_tidy_ai_db_path=temp_dir / "test.db",
        clang_tidy_binary_path=Path("/usr/bin/clang-tidy"),
        project_root=temp_dir,
        enable_learning_mode=True,
        cache_analysis_results=True
    )

@pytest.fixture
def test_db(temp_dir):
    """Create test database."""
    db_path = temp_dir / "test.db"
    connection = sqlite3.connect(db_path)
    
    # Initialize schema
    schema = """
    CREATE TABLE user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        warning_type TEXT,
        preferred_strategy TEXT,
        context_tags TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE analysis_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT,
        file_hash TEXT,
        analysis_result TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(file_path, file_hash)
    );
    
    CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        warning_id TEXT,
        recommended_fix TEXT,
        user_action TEXT,
        satisfaction_rating INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
    
    connection.executescript(schema)
    connection.commit()
    yield connection
    connection.close()

@pytest.fixture
def test_dependencies(test_settings, test_db):
    """Create test dependencies."""
    import logging
    
    logger = logging.getLogger("test_clang_tidy_ai")
    logger.setLevel(logging.INFO)
    
    return ClangTidyDependencies(
        settings=test_settings,
        db_connection=test_db,
        logger=logger,
        session_id="test-session",
        user_preferences={},
        clang_tidy_cache={},
        project_analysis_cache=None,
        analysis_stats={"total_analyses": 0, "cache_hits": 0, "warnings_fixed": 0}
    )

@pytest.fixture
def sample_warning():
    """Create a sample warning for testing."""
    return Warning(
        line_number=42,
        column_number=10,
        rule_id="readability-identifier-naming",
        severity="warning",
        message="variable name 'myVar' doesn't follow naming convention",
        suggested_fix="rename to 'my_var'",
        context_lines=["int myVar = 42;", "std::cout << myVar << std::endl;"]
    )

@pytest.fixture
def sample_analysis(sample_warning):
    """Create a sample clang-tidy analysis result."""
    return ClangTidyAnalysis(
        file_path="src/test.cpp",
        warnings=[sample_warning],
        total_warnings=1,
        clang_tidy_version="clang-tidy 15.0.0"
    )

@pytest.fixture
def sample_cpp_file(temp_dir):
    """Create a sample C++ file for testing."""
    cpp_content = """
#include <iostream>
#include <string>

int main() {
    int myVar = 42;  // naming convention issue
    std::string myString = "hello";  // another naming issue
    
    for (int i = 0; i < 10; ++i) {
        std::cout << myVar + i << std::endl;  // performance issue: avoid endl
    }
    
    return 0;
}
"""
    
    cpp_file = temp_dir / "src" / "test.cpp"
    cpp_file.parent.mkdir(parents=True)
    cpp_file.write_text(cpp_content)
    return cpp_file

@pytest.fixture
def mock_clang_tidy_output():
    """Mock clang-tidy command output."""
    stderr_output = """
src/test.cpp:5:9: warning: variable name 'myVar' doesn't follow naming convention [readability-identifier-naming]
    int myVar = 42;
        ^~~~~
        my_var
src/test.cpp:6:17: warning: variable name 'myString' doesn't follow naming convention [readability-identifier-naming]  
    std::string myString = "hello";
                ^~~~~~~~
                my_string
src/test.cpp:9:36: warning: use '\\n' instead of std::endl for performance [performance-avoid-endl]
        std::cout << myVar + i << std::endl;
                                  ^~~~~~~~~
                                  '\\n'
"""
    return "", stderr_output, 0

@pytest.fixture
def mock_subprocess_run(mock_clang_tidy_output):
    """Mock subprocess.run for clang-tidy execution."""
    stdout, stderr, returncode = mock_clang_tidy_output
    
    mock_result = Mock()
    mock_result.stdout = stdout
    mock_result.stderr = stderr
    mock_result.returncode = returncode
    
    with patch('subprocess.run', return_value=mock_result) as mock_run:
        yield mock_run

@pytest.fixture
def mock_llm_model():
    """Mock LLM model for testing."""
    from pydantic_ai.models import TestModel
    
    # Create a test model that returns predictable responses
    return TestModel()

@pytest_asyncio.fixture
async def mock_agent_context(test_dependencies, mock_llm_model):
    """Create mock agent context for testing."""
    from pydantic_ai import RunContext
    
    class MockRunContext:
        def __init__(self, deps):
            self.deps = deps
    
    return MockRunContext(test_dependencies)

# Test data fixtures

@pytest.fixture
def clang_tidy_rules_data():
    """Test data for clang-tidy rules."""
    return {
        "readability-identifier-naming": {
            "category": "readability",
            "description": "Enforces consistent identifier naming conventions",
            "severity": "warning",
            "examples": {
                "bad": "int myVar = 42;",
                "good": "int my_var = 42;"
            }
        },
        "performance-avoid-endl": {
            "category": "performance", 
            "description": "Suggests using '\\n' instead of std::endl for better performance",
            "severity": "warning",
            "examples": {
                "bad": "std::cout << value << std::endl;",
                "good": "std::cout << value << '\\n';"
            }
        }
    }

@pytest.fixture
def user_preferences_data():
    """Test data for user preferences."""
    return {
        "readability-identifier-naming": {
            "preferred_strategy": "snake_case_conversion",
            "context_tags": ["legacy_code", "consistent_style"]
        },
        "performance-avoid-endl": {
            "preferred_strategy": "auto_replace", 
            "context_tags": ["performance_critical", "logging"]
        }
    }

# Integration test fixtures

@pytest.fixture
def integration_test_project(temp_dir):
    """Create a realistic test project structure."""
    project_root = temp_dir
    
    # Create directory structure
    (project_root / "src").mkdir()
    (project_root / "include").mkdir()
    (project_root / "tests").mkdir()
    
    # Create test files with various issues
    main_cpp = project_root / "src" / "main.cpp"
    main_cpp.write_text("""
#include <iostream>
#include <vector>
#include <string>

class TestClass {
private:
    int memberVar;  // naming issue
    std::vector<int> data;
    
public:
    TestClass() : memberVar(0) {}
    
    void processData() {
        for (int i = 0; i < 1000; ++i) {
            data.push_back(i);  // performance: should reserve
        }
        
        for (const auto& item : data) {
            std::cout << item << std::endl;  // performance: avoid endl
        }
    }
};

int main() {
    TestClass testObj;
    testObj.processData();
    return 0;
}
""")
    
    header_file = project_root / "include" / "utils.hpp"
    header_file.write_text("""
#ifndef UTILS_HPP
#define UTILS_HPP

#include <string>

class UtilityClass {
public:
    static std::string formatString(const std::string& input);  // pass by value issue
    static void processVector(std::vector<int>& vec);  // missing const
};

#endif
""")
    
    return project_root

# Mock agent responses for testing

@pytest.fixture 
def mock_agent_responses():
    """Mock responses from the AI agent for testing."""
    return {
        "file_analysis": """
## Analysis Results for src/test.cpp

I found 3 code quality issues that we should address:

### 1. Naming Convention Issues (2 warnings)
- **Lines 5-6**: Variables `myVar` and `myString` don't follow naming conventions
- **Impact**: Reduces code readability and consistency
- **Recommendation**: Use snake_case naming (my_var, my_string)

### 2. Performance Issue (1 warning)  
- **Line 9**: Using `std::endl` instead of `'\\n'`
- **Impact**: Unnecessary buffer flushing hurts performance
- **Recommendation**: Replace with `'\\n'` for better performance

Would you like me to explain any of these issues in detail or help you fix them?
""",
        
        "warning_explanation": """
## Explanation: readability-identifier-naming

This clang-tidy rule enforces consistent identifier naming conventions across your codebase.

### What it checks:
- Variable names, function names, class names
- Consistency with specified naming patterns
- Common conventions like camelCase, snake_case, PascalCase

### Why it matters:
- **Readability**: Consistent naming makes code easier to understand
- **Maintainability**: Reduces cognitive load when reading code
- **Team Collaboration**: Ensures everyone follows the same conventions

### How to fix:
1. Choose a naming convention (e.g., snake_case for variables)
2. Configure clang-tidy with your preferred style
3. Rename identifiers to match the convention

### Example:
```cpp
// Before (inconsistent)
int myVar = 42;
std::string userName = "john";

// After (consistent snake_case)  
int my_var = 42;
std::string user_name = "john";
```

This improves code consistency and makes it easier for your team to work together!
""",

        "fix_recommendation": """
## Fix Recommendation Analysis

Based on the code context and best practices, here's my recommendation:

### Recommended Strategy: **Automated Snake Case Conversion**
**Confidence**: 90%

### Why this approach:
1. **Consistency**: Your codebase appears to favor snake_case in other areas
2. **Minimal Impact**: Simple renaming with low risk of breaking changes
3. **Tool Support**: Most IDEs can handle this refactoring automatically

### Implementation Plan:
1. **Use IDE Refactoring**: Right-click → Refactor → Rename
2. **Verify All References**: Ensure all usages are updated
3. **Run Tests**: Confirm functionality remains intact
4. **Update Documentation**: If variables are documented externally

### Alternative Approaches:
- **Manual Review**: More control but time-intensive
- **Batch Processing**: Use clang-tidy --fix for multiple files

### Estimated Complexity: **Simple**
This is a straightforward refactoring with minimal risk.

Would you like me to help with the specific renaming steps or explain any part of this recommendation?
"""
    }

# Cleanup fixtures

@pytest.fixture(autouse=True)
def cleanup_test_artifacts():
    """Automatically cleanup test artifacts after each test."""
    yield
    # Any cleanup code would go here
    pass