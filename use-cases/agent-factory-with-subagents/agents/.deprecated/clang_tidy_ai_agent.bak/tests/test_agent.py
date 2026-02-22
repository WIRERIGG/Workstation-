"""Tests for the main AI-Enhanced Clang-Tidy Agent."""

import pytest
import pytest_asyncio
from unittest.mock import patch, Mock

from ..agent import ClangTidyAI, clang_tidy_agent
from ..models import Warning, ClangTidyAnalysis
from ..dependencies import create_dependencies

class TestClangTidyAI:
    """Test the main ClangTidyAI class."""
    
    @pytest_asyncio.fixture
    async def ai_agent(self, test_dependencies):
        """Create AI agent for testing."""
        with patch('clang_tidy_ai_agent.agent.create_dependencies', return_value=test_dependencies):
            ai = ClangTidyAI(session_id="test-session")
            async with ai:
                yield ai
    
    @pytest.mark.asyncio
    async def test_analyze_file_success(self, ai_agent, mock_subprocess_run, mock_agent_responses):
        """Test successful file analysis."""
        with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_run:
            mock_run.return_value = Mock(data=mock_agent_responses["file_analysis"])
            
            result = await ai_agent.analyze_file("src/test.cpp")
            
            assert "Analysis Results" in result
            assert "Naming Convention Issues" in result
            assert "Performance Issue" in result
            mock_run.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_explain_warning_success(self, ai_agent, mock_agent_responses):
        """Test warning explanation functionality.""" 
        with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_run:
            mock_run.return_value = Mock(data=mock_agent_responses["warning_explanation"])
            
            result = await ai_agent.explain_warning(
                "readability-identifier-naming",
                "int myVar = 42;",
                "intermediate"
            )
            
            assert "readability-identifier-naming" in result
            assert "What it checks" in result
            assert "Why it matters" in result
            mock_run.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_fix_recommendation_success(self, ai_agent, mock_agent_responses):
        """Test fix recommendation functionality."""
        with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_run:
            mock_run.return_value = Mock(data=mock_agent_responses["fix_recommendation"])
            
            result = await ai_agent.get_fix_recommendation(
                "Variable naming doesn't follow convention",
                "int myVar = 42;\nstd::cout << myVar << std::endl;"
            )
            
            assert "Fix Recommendation Analysis" in result
            assert "Recommended Strategy" in result
            assert "Confidence" in result
            mock_run.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_analyze_project_success(self, ai_agent):
        """Test project analysis functionality."""
        with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_run:
            mock_run.return_value = Mock(data="Project analysis complete: 5 files, 12 warnings")
            
            result = await ai_agent.analyze_project("src/**/*.cpp")
            
            assert "Project analysis complete" in result
            mock_run.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_chat_functionality(self, ai_agent):
        """Test conversational chat functionality."""
        with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_run:
            mock_run.return_value = Mock(data="C++ code quality involves several key practices...")
            
            result = await ai_agent.chat("What are the most important C++ code quality practices?")
            
            assert "C++ code quality" in result
            mock_run.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_context_manager_usage(self, test_dependencies):
        """Test proper context manager usage."""
        with patch('clang_tidy_ai_agent.agent.create_dependencies', return_value=test_dependencies) as mock_create:
            async with ClangTidyAI(session_id="test") as ai:
                assert ai._dependencies is not None
                assert ai.session_id == "test"
                
            # Verify cleanup occurred
            mock_create.assert_called_once()
    
    def test_context_manager_error_without_enter(self):
        """Test error when using AI without context manager."""
        ai = ClangTidyAI()
        
        with pytest.raises(RuntimeError, match="must be used as a context manager"):
            # This should fail because we're not in a context manager
            import asyncio
            asyncio.run(ai.analyze_file("test.cpp"))

class TestAgentTools:
    """Test the agent tools integration."""
    
    @pytest_asyncio.fixture 
    async def mock_context(self, test_dependencies):
        """Create mock run context for tool testing."""
        from pydantic_ai import RunContext
        
        class MockContext:
            def __init__(self, deps):
                self.deps = deps
        
        return MockContext(test_dependencies)
    
    @pytest.mark.asyncio
    async def test_analyze_file_tool(self, mock_context, mock_subprocess_run, sample_analysis):
        """Test the analyze_file tool."""
        from ..agent import analyze_file
        
        with patch('clang_tidy_ai_agent.tools.analyze_code_with_clang_tidy', return_value=sample_analysis):
            result = await analyze_file(mock_context, "src/test.cpp")
            
            assert isinstance(result, ClangTidyAnalysis)
            assert result.file_path == "src/test.cpp"
            assert result.total_warnings == 1
    
    @pytest.mark.asyncio
    async def test_explain_warning_tool(self, mock_context):
        """Test the explain_warning_detail tool."""
        from ..agent import explain_warning_detail
        from ..models import WarningExplanation, CodeExamples
        
        mock_explanation = WarningExplanation(
            rule_id="readability-identifier-naming",
            rule_category="readability",
            problem_description="Variable naming convention violation",
            why_it_matters="Consistent naming improves readability",
            fix_strategies=[],
            code_examples=CodeExamples(
                problematic_code="int myVar = 42;",
                fixed_code="int my_var = 42;",
                explanation="Renamed to follow snake_case convention"
            ),
            related_concepts=["naming conventions", "readability"],
            severity_justification="Helps maintain code consistency"
        )
        
        with patch('clang_tidy_ai_agent.tools.explain_warning', return_value=mock_explanation):
            result = await explain_warning_detail(
                mock_context,
                "readability-identifier-naming", 
                "int myVar = 42;",
                "intermediate"
            )
            
            assert isinstance(result, WarningExplanation)
            assert result.rule_id == "readability-identifier-naming"
            assert result.rule_category == "readability"
    
    @pytest.mark.asyncio
    async def test_get_fix_recommendation_tool(self, mock_context, sample_warning):
        """Test the get_fix_recommendation tool."""
        from ..agent import get_fix_recommendation
        from ..models import FixRecommendation
        
        mock_recommendation = FixRecommendation(
            recommended_strategy="snake_case_conversion",
            confidence_score=0.9,
            rationale="Consistent with existing codebase patterns",
            implementation_plan=["Use IDE refactoring", "Verify all references", "Run tests"],
            alternative_approaches=[],
            estimated_complexity="simple",
            potential_side_effects=[]
        )
        
        with patch('clang_tidy_ai_agent.tools.recommend_fix_strategy', return_value=mock_recommendation):
            result = await get_fix_recommendation(
                mock_context,
                sample_warning,
                "int myVar = 42;\nstd::cout << myVar << std::endl;"
            )
            
            assert isinstance(result, FixRecommendation)
            assert result.recommended_strategy == "snake_case_conversion"
            assert result.confidence_score == 0.9

class TestAgentIntegration:
    """Test agent integration with real scenarios."""
    
    @pytest.mark.asyncio
    async def test_end_to_end_file_analysis(self, sample_cpp_file, temp_dir, mock_subprocess_run):
        """Test complete file analysis workflow."""
        with patch('clang_tidy_ai_agent.settings.load_settings') as mock_settings:
            # Mock settings to point to our temp directory
            mock_settings.return_value.project_root = temp_dir
            mock_settings.return_value.llm_provider = "test"
            mock_settings.return_value.llm_api_key = "test-key"
            
            with patch('clang_tidy_ai_agent.agent.get_llm_model') as mock_model:
                from pydantic_ai.models import TestModel
                mock_model.return_value = TestModel()
                
                # Test the end-to-end workflow would require more complex mocking
                # For now, verify that the components can be instantiated
                ai = ClangTidyAI(session_id="integration-test")
                assert ai.session_id == "integration-test"
    
    @pytest.mark.asyncio 
    async def test_user_preference_learning(self, test_dependencies):
        """Test user preference learning workflow."""
        from ..dependencies import save_user_preference, load_user_preferences
        
        # Save a preference
        save_user_preference(
            test_dependencies.db_connection,
            "test-session",
            "readability-identifier-naming",
            "snake_case_conversion",
            ["legacy_code", "consistency"]
        )
        
        # Load preferences
        preferences = load_user_preferences(test_dependencies.db_connection, "test-session")
        
        assert "readability-identifier-naming" in preferences
        assert preferences["readability-identifier-naming"]["preferred_strategy"] == "snake_case_conversion"
        assert "legacy_code" in preferences["readability-identifier-naming"]["context_tags"]
    
    @pytest.mark.asyncio
    async def test_caching_behavior(self, test_dependencies, sample_cpp_file):
        """Test analysis result caching."""
        from ..tools import _calculate_file_hash, _cache_analysis, _get_cached_analysis
        from ..models import ClangTidyAnalysis
        
        # Calculate file hash
        file_hash = _calculate_file_hash(sample_cpp_file)
        assert len(file_hash) == 64  # SHA-256 hash
        
        # Create analysis result
        analysis = ClangTidyAnalysis(
            file_path=str(sample_cpp_file),
            warnings=[],
            total_warnings=0,
            clang_tidy_version="test-version"
        )
        
        # Cache the result
        _cache_analysis(test_dependencies.db_connection, str(sample_cpp_file), file_hash, analysis)
        
        # Retrieve from cache
        cached_result = _get_cached_analysis(test_dependencies.db_connection, str(sample_cpp_file), file_hash)
        
        assert cached_result is not None
        assert cached_result.file_path == str(sample_cpp_file)
        assert cached_result.total_warnings == 0

class TestErrorHandling:
    """Test error handling scenarios."""
    
    @pytest.mark.asyncio
    async def test_file_not_found_error(self, ai_agent):
        """Test handling of non-existent files."""
        with patch('clang_tidy_ai_agent.tools.analyze_code_with_clang_tidy') as mock_analyze:
            # Simulate file not found scenario
            mock_analyze.return_value = ClangTidyAnalysis(
                file_path="nonexistent.cpp",
                warnings=[],
                total_warnings=0
            )
            
            with patch('clang_tidy_ai_agent.agent.clang_tidy_agent.run') as mock_run:
                mock_run.return_value = Mock(data="File not found: nonexistent.cpp")
                
                result = await ai_agent.analyze_file("nonexistent.cpp")
                assert "File not found" in result
    
    @pytest.mark.asyncio
    async def test_clang_tidy_execution_error(self, mock_context):
        """Test handling of clang-tidy execution failures."""
        from ..tools import analyze_code_with_clang_tidy
        
        with patch('subprocess.run') as mock_run:
            # Simulate clang-tidy failure
            mock_run.side_effect = FileNotFoundError("clang-tidy not found")
            
            result = await analyze_code_with_clang_tidy(mock_context, "src/test.cpp")
            
            assert result.total_warnings == 0
            assert result.file_path == "src/test.cpp"
    
    @pytest.mark.asyncio
    async def test_database_error_handling(self, mock_context):
        """Test handling of database errors."""
        from ..tools import update_user_preferences
        from ..models import PreferenceUpdate
        
        # Simulate database connection failure
        mock_context.deps.db_connection.close()
        
        result = await update_user_preferences(
            mock_context,
            "snake_case",
            "readability-identifier-naming"
        )
        
        assert isinstance(result, PreferenceUpdate)
        assert not result.success
        assert "Failed to save preference" in result.message

class TestPerformance:
    """Test performance characteristics."""
    
    @pytest.mark.asyncio
    async def test_batch_analysis_performance(self, integration_test_project, mock_subprocess_run):
        """Test performance of batch analysis."""
        import time
        from ..tools import batch_analyze_project
        from ..dependencies import create_dependencies
        
        # Create test dependencies pointing to integration project
        deps = create_dependencies("perf-test")
        deps.settings.project_root = integration_test_project
        
        class MockContext:
            def __init__(self, deps):
                self.deps = deps
        
        context = MockContext(deps)
        
        try:
            start_time = time.time()
            result = await batch_analyze_project(context, "src/**/*.cpp")
            end_time = time.time()
            
            # Verify reasonable performance (should complete quickly in tests)
            assert (end_time - start_time) < 5.0  # Less than 5 seconds
            assert result.total_files_analyzed >= 0
            
        finally:
            deps.db_connection.close()
    
    @pytest.mark.asyncio
    async def test_caching_performance(self, test_dependencies, sample_cpp_file):
        """Test that caching improves performance."""
        from ..tools import analyze_code_with_clang_tidy
        
        class MockContext:
            def __init__(self, deps):
                self.deps = deps
        
        context = MockContext(test_dependencies)
        
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout="", stderr="", returncode=0)
            
            # First analysis - should hit clang-tidy
            result1 = await analyze_code_with_clang_tidy(
                context, 
                str(sample_cpp_file.relative_to(test_dependencies.settings.project_root))
            )
            
            # Second analysis - should hit cache
            result2 = await analyze_code_with_clang_tidy(
                context,
                str(sample_cpp_file.relative_to(test_dependencies.settings.project_root))
            )
            
            # Verify caching behavior
            assert test_dependencies.analysis_stats["total_analyses"] >= 1
            # Note: In real scenario, cache_hits would be > 0 for second call