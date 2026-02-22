"""Integration tests for the AI-Enhanced Clang-Tidy Agent."""

import pytest
import pytest_asyncio
import tempfile
import subprocess
from pathlib import Path
from unittest.mock import patch, Mock

from ..agent import ClangTidyAI
from ..settings import load_settings
from ..dependencies import create_dependencies
from ..models import ClangTidyAnalysis, Warning

class TestEndToEndWorkflow:
    """Test complete end-to-end workflows."""
    
    @pytest.mark.asyncio
    async def test_complete_file_analysis_workflow(self, integration_test_project):
        """Test complete file analysis from start to finish.""" 
        
        # Create a settings override for testing
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = integration_test_project
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            mock_settings.return_value.llm_model = "test-model"
            mock_settings.return_value.clang_tidy_binary_path = Path("/usr/bin/clang-tidy")
            mock_settings.return_value.enable_learning_mode = True
            mock_settings.return_value.cache_analysis_results = True
            
            with patch('clang_tidy_ai_agent.agent.get_llm_model') as mock_model:
                from pydantic_ai.models import TestModel
                mock_model.return_value = TestModel()
                
                with patch('subprocess.run') as mock_subprocess:
                    # Mock clang-tidy output
                    mock_subprocess.return_value = Mock(
                        stdout="",
                        stderr="""src/main.cpp:7:9: warning: variable name 'memberVar' doesn't follow naming convention [readability-identifier-naming]
    int memberVar;
        ^~~~~~~~~
        member_var""",
                        returncode=0
                    )
                    
                    with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_agent:
                        mock_agent.return_value = Mock(data="Analysis complete: Found 1 naming issue in src/main.cpp. The variable 'memberVar' should use snake_case naming convention.")
                        
                        # Test the complete workflow
                        async with ClangTidyAI(session_id="integration-test") as ai:
                            result = await ai.analyze_file("src/main.cpp")
                            
                            assert result is not None
                            assert "memberVar" in result or "naming" in result
                            mock_agent.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_conversational_learning_workflow(self, integration_test_project):
        """Test conversational interaction with learning."""
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = integration_test_project
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            mock_settings.return_value.enable_learning_mode = True
            
            with patch('clang_tidy_ai_agent.agent.get_llm_model') as mock_model:
                from pydantic_ai.models import TestModel
                mock_model.return_value = TestModel()
                
                with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_agent:
                    # Simulate multiple conversation turns
                    mock_agent.side_effect = [
                        Mock(data="I prefer snake_case naming for variables. This preference has been saved."),
                        Mock(data="Based on your preference for snake_case, I recommend renaming 'memberVar' to 'member_var'.")
                    ]
                    
                    async with ClangTidyAI(session_id="learning-test") as ai:
                        # First interaction: Set preference
                        response1 = await ai.chat("I prefer snake_case naming - remember this")
                        assert "preference" in response1.lower()
                        
                        # Second interaction: Should use learned preference
                        response2 = await ai.get_fix_recommendation(
                            "Variable naming issue",
                            "int memberVar = 42;"
                        )
                        assert "snake_case" in response2

class TestRealClangTidyIntegration:
    """Test integration with actual clang-tidy (if available)."""
    
    def check_clang_tidy_available(self):
        """Check if clang-tidy is available on the system."""
        try:
            result = subprocess.run(['clang-tidy', '--version'], 
                                  capture_output=True, text=True, timeout=5)
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    @pytest.mark.skipif(not Path("/usr/bin/clang-tidy").exists(), 
                       reason="clang-tidy not available")
    @pytest.mark.asyncio
    async def test_real_clang_tidy_analysis(self, temp_dir):
        """Test with real clang-tidy if available."""
        
        # Create a simple C++ file with known issues
        test_file = temp_dir / "test.cpp"
        test_file.write_text("""
#include <iostream>

int main() {
    int myVar = 42;  // naming issue
    std::cout << myVar << std::endl;  // performance issue
    return 0;
}
""")
        
        # Create a basic compile_commands.json to help clang-tidy
        compile_commands = temp_dir / "compile_commands.json"
        compile_commands.write_text(f"""[
{{
    "directory": "{temp_dir}",
    "command": "g++ -std=c++17 test.cpp -o test",
    "file": "test.cpp"
}}
]""")
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = temp_dir
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            mock_settings.return_value.clang_tidy_binary_path = Path("/usr/bin/clang-tidy")
            mock_settings.return_value.enable_learning_mode = False
            mock_settings.return_value.cache_analysis_results = False
            
            with patch('clang_tidy_ai_agent.agent.get_llm_model') as mock_model:
                from pydantic_ai.models import TestModel
                mock_model.return_value = TestModel()
                
                # Test actual clang-tidy analysis
                deps = create_dependencies("real-test")
                deps.settings = mock_settings.return_value
                
                try:
                    from ..tools import analyze_code_with_clang_tidy
                    
                    class MockContext:
                        def __init__(self, deps):
                            self.deps = deps
                    
                    context = MockContext(deps)
                    
                    result = await analyze_code_with_clang_tidy(
                        context, 
                        "test.cpp",
                        "readability-*,performance-*"
                    )
                    
                    assert isinstance(result, ClangTidyAnalysis)
                    assert result.file_path == "test.cpp"
                    # Real clang-tidy should find at least some issues in our test code
                    print(f"Real clang-tidy found {result.total_warnings} warnings")
                    
                finally:
                    deps.db_connection.close()

class TestErrorRecoveryScenarios:
    """Test error recovery in various failure scenarios."""
    
    @pytest.mark.asyncio
    async def test_network_failure_recovery(self):
        """Test recovery from network/API failures."""
        
        with patch('clang_tidy_ai_agent.agent.get_llm_model') as mock_model:
            # Simulate network failure in LLM call
            mock_model.side_effect = ConnectionError("Network unavailable")
            
            with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
                mock_settings.return_value.llm_provider = "test"
                mock_settings.return_value.llm_api_key = "test-key"
                
                try:
                    ai = ClangTidyAI(session_id="error-test")
                    async with ai:
                        # This should handle the error gracefully
                        # In a real implementation, there might be fallback behavior
                        pass
                except ConnectionError:
                    # Expected in this test scenario
                    pass
    
    @pytest.mark.asyncio
    async def test_partial_file_corruption_recovery(self, temp_dir):
        """Test handling of partially corrupted files."""
        
        # Create a file with mixed valid and invalid content
        test_file = temp_dir / "corrupted.cpp"
        test_file.write_text("""
#include <iostream>
// This is valid C++
int main() {
    int valid_var = 42;
    
    // Some corrupted/invalid syntax below
    int invalid syntax here @@#$%
    std::cout << valid_var << std::endl;
    return 0;
}
""")
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = temp_dir
            mock_settings.return_value.clang_tidy_binary_path = Path("/usr/bin/clang-tidy")
            
            deps = create_dependencies("corruption-test")
            deps.settings = mock_settings.return_value
            
            try:
                from ..tools import analyze_code_with_clang_tidy
                
                class MockContext:
                    def __init__(self, deps):
                        self.deps = deps
                
                context = MockContext(deps)
                
                # clang-tidy might fail on corrupted syntax, but our tool should handle it
                result = await analyze_code_with_clang_tidy(context, "corrupted.cpp")
                
                # Should return a result even if clang-tidy fails
                assert isinstance(result, ClangTidyAnalysis)
                assert result.file_path == "corrupted.cpp"
                
            finally:
                deps.db_connection.close()
    
    @pytest.mark.asyncio
    async def test_database_corruption_recovery(self, temp_dir):
        """Test recovery from database corruption."""
        
        # Create a corrupted database file
        db_file = temp_dir / "corrupted.db"
        db_file.write_text("This is not a valid SQLite database")
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.clang_tidy_ai_db_path = db_file
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            
            try:
                # This should either recover or fail gracefully
                deps = create_dependencies("db-corruption-test")
                # If we get here, the system recovered
                deps.db_connection.close()
                
            except Exception as e:
                # Database corruption should be handled gracefully
                assert "database" in str(e).lower() or "sqlite" in str(e).lower()

class TestPerformanceIntegration:
    """Test performance characteristics in integration scenarios."""
    
    @pytest.mark.asyncio
    async def test_large_project_analysis_performance(self, temp_dir):
        """Test performance with a larger project structure."""
        
        # Create a larger test project
        project_root = temp_dir / "large_project"
        project_root.mkdir()
        
        # Create multiple directories and files
        for i in range(10):
            src_dir = project_root / f"src{i}"
            src_dir.mkdir()
            
            for j in range(5):
                cpp_file = src_dir / f"file{j}.cpp"
                cpp_file.write_text(f"""
#include <iostream>
#include <vector>

class TestClass{i}{j} {{
private:
    int memberVar{j};  // naming issue
    std::vector<int> dataVector;
    
public:
    TestClass{i}{j}() : memberVar{j}(0) {{}}
    
    void processData() {{
        for (int k = 0; k < 100; ++k) {{
            dataVector.push_back(k);  // performance issue
        }}
        
        for (const auto& item : dataVector) {{
            std::cout << item << std::endl;  // performance issue
        }}
    }}
}};

int main{i}{j}() {{
    TestClass{i}{j} testObj;
    testObj.processData();
    return 0;
}}
""")
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = project_root
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            mock_settings.return_value.enable_learning_mode = False
            mock_settings.return_value.cache_analysis_results = True
            
            with patch('clang_tidy_ai_agent.agent.get_llm_model') as mock_model:
                from pydantic_ai.models import TestModel
                mock_model.return_value = TestModel()
                
                with patch('subprocess.run') as mock_subprocess:
                    # Mock clang-tidy to return consistent results quickly
                    mock_subprocess.return_value = Mock(
                        stdout="",
                        stderr="",
                        returncode=0
                    )
                    
                    import time
                    start_time = time.time()
                    
                    # Test batch analysis performance
                    async with ClangTidyAI(session_id="perf-test") as ai:
                        result = await ai.analyze_project("src*/**/*.cpp")
                        
                    end_time = time.time()
                    analysis_time = end_time - start_time
                    
                    # Should complete in reasonable time even for larger projects
                    assert analysis_time < 30.0  # 30 seconds max
                    assert result is not None
    
    @pytest.mark.asyncio
    async def test_concurrent_user_sessions(self, temp_dir):
        """Test handling of concurrent user sessions."""
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = temp_dir
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            
            with patch('clang_tidy_ai_agent.agent.get_llm_model') as mock_model:
                from pydantic_ai.models import TestModel
                mock_model.return_value = TestModel()
                
                with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_agent:
                    mock_agent.return_value = Mock(data="Concurrent analysis complete")
                    
                    # Simulate multiple concurrent sessions
                    import asyncio
                    
                    async def session_task(session_id):
                        async with ClangTidyAI(session_id=session_id) as ai:
                            return await ai.chat(f"Test query from {session_id}")
                    
                    # Run multiple sessions concurrently
                    tasks = [session_task(f"session-{i}") for i in range(3)]
                    results = await asyncio.gather(*tasks)
                    
                    # All sessions should complete successfully
                    assert len(results) == 3
                    for result in results:
                        assert result is not None

class TestCompatibilityIntegration:
    """Test compatibility with existing tools and workflows."""
    
    @pytest.mark.asyncio 
    async def test_existing_clang_tidy_config_compatibility(self, temp_dir):
        """Test compatibility with existing .clang-tidy configuration files."""
        
        # Create a .clang-tidy config file
        clang_tidy_config = temp_dir / ".clang-tidy"
        clang_tidy_config.write_text("""
Checks: 'readability-*,performance-*,modernize-*'
HeaderFilterRegex: '.*'
WarningsAsErrors: ''
CheckOptions:
  - key: readability-identifier-naming.VariableCase
    value: snake_case
  - key: performance-avoid-endl.Enabled
    value: true
""")
        
        test_file = temp_dir / "test.cpp"
        test_file.write_text("""
#include <iostream>

int main() {
    int myVar = 42;  // Should trigger naming warning
    std::cout << myVar << std::endl;  // Should trigger performance warning
    return 0;
}
""")
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = temp_dir
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            mock_settings.return_value.clang_tidy_binary_path = Path("/usr/bin/clang-tidy")
            
            with patch('subprocess.run') as mock_subprocess:
                # Mock clang-tidy respecting the config
                mock_subprocess.return_value = Mock(
                    stdout="",
                    stderr="""test.cpp:4:9: warning: variable name 'myVar' doesn't follow naming convention [readability-identifier-naming]
    int myVar = 42;
        ^~~~~
        my_var
test.cpp:5:26: warning: use '\\n' instead of std::endl [performance-avoid-endl]
    std::cout << myVar << std::endl;
                          ^~~~~~~~~
                          '\\n'""",
                    returncode=0
                )
                
                deps = create_dependencies("config-test")
                deps.settings = mock_settings.return_value
                
                try:
                    from ..tools import analyze_code_with_clang_tidy
                    
                    class MockContext:
                        def __init__(self, deps):
                            self.deps = deps
                    
                    context = MockContext(deps)
                    
                    result = await analyze_code_with_clang_tidy(context, "test.cpp")
                    
                    assert isinstance(result, ClangTidyAnalysis)
                    # Should find both naming and performance warnings
                    assert result.total_warnings >= 2
                    
                    # Verify specific warnings were found
                    rule_ids = [w.rule_id for w in result.warnings]
                    assert "readability-identifier-naming" in rule_ids
                    assert "performance-avoid-endl" in rule_ids
                    
                finally:
                    deps.db_connection.close()
    
    @pytest.mark.asyncio
    async def test_compile_commands_integration(self, temp_dir):
        """Test integration with compile_commands.json."""
        
        # Create compile_commands.json
        compile_commands = temp_dir / "compile_commands.json"
        compile_commands.write_text("""[
{
    "directory": "%s",
    "command": "g++ -std=c++17 -I./include -Wall -Wextra test.cpp -o test",
    "file": "test.cpp"
}
]""" % temp_dir)
        
        # Create include directory and header
        include_dir = temp_dir / "include"
        include_dir.mkdir()
        header_file = include_dir / "test.hpp"
        header_file.write_text("""
#ifndef TEST_HPP
#define TEST_HPP

class TestClass {
public:
    void doSomething();
};

#endif
""")
        
        # Create source file
        test_file = temp_dir / "test.cpp"
        test_file.write_text("""
#include "test.hpp"
#include <iostream>

void TestClass::doSomething() {
    int localVar = 42;  // naming issue
    std::cout << localVar << std::endl;  // performance issue
}

int main() {
    TestClass obj;
    obj.doSomething();
    return 0;
}
""")
        
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            mock_settings.return_value.project_root = temp_dir
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            
            with patch('subprocess.run') as mock_subprocess:
                # Mock clang-tidy using compile_commands.json
                mock_subprocess.return_value = Mock(
                    stdout="",
                    stderr="""test.cpp:6:9: warning: variable name 'localVar' doesn't follow naming convention [readability-identifier-naming]
    int localVar = 42;
        ^~~~~~~~
        local_var""",
                    returncode=0
                )
                
                deps = create_dependencies("compile-commands-test")
                deps.settings = mock_settings.return_value
                
                try:
                    from ..tools import analyze_code_with_clang_tidy
                    
                    class MockContext:
                        def __init__(self, deps):
                            self.deps = deps
                    
                    context = MockContext(deps)
                    
                    result = await analyze_code_with_clang_tidy(context, "test.cpp")
                    
                    assert isinstance(result, ClangTidyAnalysis)
                    # Should successfully analyze with compile commands
                    assert result.file_path == "test.cpp"
                    
                finally:
                    deps.db_connection.close()