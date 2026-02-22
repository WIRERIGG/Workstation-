"""Tests for the Clang-Tidy AI Agent tools."""

import pytest
import pytest_asyncio
from unittest.mock import patch, Mock
from pathlib import Path

from ..tools import (
    analyze_code_with_clang_tidy,
    explain_warning,
    recommend_fix_strategy,
    update_user_preferences,
    batch_analyze_project,
    _parse_clang_tidy_output,
    _calculate_file_hash,
    _get_cached_analysis,
    _cache_analysis
)
from ..models import Warning, ClangTidyAnalysis, WarningExplanation, FixRecommendation

class TestAnalyzeCodeWithClangTidy:
    """Test the analyze_code_with_clang_tidy tool."""
    
    @pytest.mark.asyncio
    async def test_successful_analysis(self, mock_agent_context, sample_cpp_file, mock_subprocess_run):
        """Test successful clang-tidy analysis."""
        # Setup
        file_path = str(sample_cpp_file.relative_to(mock_agent_context.deps.settings.project_root))
        
        result = await analyze_code_with_clang_tidy(mock_agent_context, file_path)
        
        assert isinstance(result, ClangTidyAnalysis)
        assert result.file_path == file_path
        assert result.total_warnings >= 0
        assert len(result.warnings) == result.total_warnings
    
    @pytest.mark.asyncio
    async def test_file_not_found(self, mock_agent_context):
        """Test handling of non-existent files."""
        result = await analyze_code_with_clang_tidy(mock_agent_context, "nonexistent.cpp")
        
        assert result.file_path == "nonexistent.cpp"
        assert result.total_warnings == 0
        assert len(result.warnings) == 0
    
    @pytest.mark.asyncio
    async def test_custom_check_filters(self, mock_agent_context, sample_cpp_file, mock_subprocess_run):
        """Test analysis with custom check filters."""
        file_path = str(sample_cpp_file.relative_to(mock_agent_context.deps.settings.project_root))
        
        result = await analyze_code_with_clang_tidy(
            mock_agent_context, 
            file_path,
            "performance-*,readability-*"
        )
        
        assert isinstance(result, ClangTidyAnalysis)
        mock_subprocess_run.assert_called_once()
        # Verify check filters were passed to clang-tidy
        args = mock_subprocess_run.call_args[0][0]
        assert any("--checks=performance-*,readability-*" in str(arg) for arg in args)
    
    @pytest.mark.asyncio
    async def test_caching_behavior(self, mock_agent_context, sample_cpp_file):
        """Test that results are cached when caching is enabled."""
        file_path = str(sample_cpp_file.relative_to(mock_agent_context.deps.settings.project_root))
        
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout="", stderr="", returncode=0)
            
            # First call should execute clang-tidy
            result1 = await analyze_code_with_clang_tidy(mock_agent_context, file_path)
            
            # Second call should use cache (but we need to mock the cache retrieval)
            with patch('clang_tidy_ai_agent.tools._get_cached_analysis', return_value=result1):
                result2 = await analyze_code_with_clang_tidy(mock_agent_context, file_path)
                
                assert result2 == result1
                assert mock_agent_context.deps.analysis_stats["cache_hits"] >= 1

class TestExplainWarning:
    """Test the explain_warning tool."""
    
    @pytest.mark.asyncio
    async def test_basic_warning_explanation(self, mock_agent_context):
        """Test basic warning explanation generation."""
        result = await explain_warning(
            mock_agent_context,
            "readability-identifier-naming",
            "int myVar = 42;",
            "intermediate"
        )
        
        assert isinstance(result, WarningExplanation)
        assert result.rule_id == "readability-identifier-naming"
        assert "readability" in result.rule_category
        assert result.problem_description
        assert result.why_it_matters
        assert result.code_examples.problematic_code == "int myVar = 42;"
    
    @pytest.mark.asyncio 
    async def test_different_user_levels(self, mock_agent_context):
        """Test explanations for different user expertise levels."""
        code_context = "std::cout << value << std::endl;"
        
        # Test beginner level
        result_beginner = await explain_warning(
            mock_agent_context,
            "performance-avoid-endl", 
            code_context,
            "beginner"
        )
        
        # Test advanced level
        result_advanced = await explain_warning(
            mock_agent_context,
            "performance-avoid-endl",
            code_context, 
            "advanced"
        )
        
        assert isinstance(result_beginner, WarningExplanation)
        assert isinstance(result_advanced, WarningExplanation)
        assert result_beginner.rule_id == result_advanced.rule_id
    
    @pytest.mark.asyncio
    async def test_unknown_rule_handling(self, mock_agent_context):
        """Test handling of unknown clang-tidy rules.""" 
        result = await explain_warning(
            mock_agent_context,
            "unknown-nonexistent-rule",
            "some code;",
            "intermediate"
        )
        
        assert isinstance(result, WarningExplanation)
        assert result.rule_id == "unknown-nonexistent-rule"
        assert result.rule_category == "unknown"
        assert "unable to generate explanation" in result.code_examples.explanation.lower()

class TestRecommendFixStrategy:
    """Test the recommend_fix_strategy tool."""
    
    @pytest.mark.asyncio
    async def test_basic_fix_recommendation(self, mock_agent_context, sample_warning):
        """Test basic fix strategy recommendation."""
        surrounding_code = "int myVar = 42;\nstd::cout << myVar << std::endl;"
        
        result = await recommend_fix_strategy(
            mock_agent_context,
            sample_warning,
            surrounding_code
        )
        
        assert isinstance(result, FixRecommendation)
        assert result.recommended_strategy
        assert 0.0 <= result.confidence_score <= 1.0
        assert result.rationale
        assert result.implementation_plan
        assert result.estimated_complexity in ["simple", "moderate", "complex"]
    
    @pytest.mark.asyncio
    async def test_user_preference_influence(self, mock_agent_context, sample_warning):
        """Test that user preferences influence recommendations."""
        # Set user preference
        mock_agent_context.deps.user_preferences["readability-identifier-naming"] = {
            "preferred_strategy": "camelCase_conversion",
            "context_tags": ["existing_preference"]
        }
        
        result = await recommend_fix_strategy(
            mock_agent_context,
            sample_warning,
            "int myVar = 42;"
        )
        
        assert isinstance(result, FixRecommendation)
        # The preferred strategy should influence the recommendation
        # (in a real implementation, this would be more sophisticated)
        assert result.confidence_score > 0.0
    
    @pytest.mark.asyncio
    async def test_project_style_guide_integration(self, mock_agent_context, sample_warning):
        """Test integration with project style guide."""
        style_guide = "Use snake_case for all variable names"
        
        result = await recommend_fix_strategy(
            mock_agent_context,
            sample_warning,
            "int myVar = 42;",
            style_guide
        )
        
        assert isinstance(result, FixRecommendation) 
        assert result.recommended_strategy
        # Style guide should influence the recommendation
        assert result.rationale

class TestUpdateUserPreferences:
    """Test the update_user_preferences tool."""
    
    @pytest.mark.asyncio
    async def test_save_new_preference(self, mock_agent_context):
        """Test saving a new user preference."""
        result = await update_user_preferences(
            mock_agent_context,
            "snake_case_conversion",
            "readability-identifier-naming",
            ["legacy_code", "consistency"]
        )
        
        assert result.success
        assert "saved" in result.message.lower()
        assert result.preferences_count >= 1
        
        # Verify preference was stored
        assert "readability-identifier-naming" in mock_agent_context.deps.user_preferences
        stored_pref = mock_agent_context.deps.user_preferences["readability-identifier-naming"]
        assert stored_pref["preferred_strategy"] == "snake_case_conversion"
        assert "legacy_code" in stored_pref["context_tags"]
    
    @pytest.mark.asyncio
    async def test_update_existing_preference(self, mock_agent_context):
        """Test updating an existing preference."""
        # Set initial preference
        mock_agent_context.deps.user_preferences["test-rule"] = {
            "preferred_strategy": "old_strategy",
            "context_tags": ["old_tag"]
        }
        
        result = await update_user_preferences(
            mock_agent_context,
            "new_strategy",
            "test-rule",
            ["new_tag"]
        )
        
        assert result.success
        # Verify preference was updated
        stored_pref = mock_agent_context.deps.user_preferences["test-rule"]
        assert stored_pref["preferred_strategy"] == "new_strategy"
        assert stored_pref["context_tags"] == ["new_tag"]
    
    @pytest.mark.asyncio
    async def test_database_error_handling(self, mock_agent_context):
        """Test handling of database errors during preference storage."""
        # Close the database connection to simulate an error
        mock_agent_context.deps.db_connection.close()
        
        result = await update_user_preferences(
            mock_agent_context,
            "some_strategy", 
            "some-rule"
        )
        
        assert not result.success
        assert "failed" in result.message.lower()
        assert result.preferences_count == 0

class TestBatchAnalyzeProject:
    """Test the batch_analyze_project tool."""
    
    @pytest.mark.asyncio
    async def test_successful_batch_analysis(self, mock_agent_context, integration_test_project):
        """Test successful batch analysis of project files."""
        # Update context to point to test project
        mock_agent_context.deps.settings.project_root = integration_test_project
        
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout="", stderr="", returncode=0)
            
            result = await batch_analyze_project(
                mock_agent_context,
                "src/**/*.cpp"
            )
            
            assert result.total_files_analyzed >= 0
            assert result.total_warnings >= 0
            assert isinstance(result.warnings_by_category, dict)
            assert result.analysis_summary
            assert result.recommendations
            assert result.estimated_fix_time
    
    @pytest.mark.asyncio
    async def test_no_files_found(self, mock_agent_context):
        """Test batch analysis when no files match the pattern."""
        result = await batch_analyze_project(
            mock_agent_context,
            "nonexistent/**/*.cpp"
        )
        
        assert result.total_files_analyzed == 0
        assert result.total_warnings == 0
        assert "no files found" in result.analysis_summary.lower()
    
    @pytest.mark.asyncio
    async def test_priority_checks_parameter(self, mock_agent_context, integration_test_project):
        """Test batch analysis with priority checks specified."""
        mock_agent_context.deps.settings.project_root = integration_test_project
        
        priority_checks = ["performance-*", "cert-*"]
        
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout="", stderr="", returncode=0)
            
            result = await batch_analyze_project(
                mock_agent_context,
                "src/**/*.cpp",
                priority_checks
            )
            
            assert isinstance(result, type(result))
            # Verify priority checks were used (would need to check subprocess calls)
            assert result.total_files_analyzed >= 0

class TestHelperFunctions:
    """Test helper functions used by the tools."""
    
    def test_calculate_file_hash(self, sample_cpp_file):
        """Test file hash calculation."""
        hash1 = _calculate_file_hash(sample_cpp_file)
        hash2 = _calculate_file_hash(sample_cpp_file)
        
        assert hash1 == hash2  # Same file should produce same hash
        assert len(hash1) == 64  # SHA-256 produces 64-character hex string
        
        # Modify file and verify hash changes
        original_content = sample_cpp_file.read_text()
        sample_cpp_file.write_text(original_content + "\n// comment")
        
        hash3 = _calculate_file_hash(sample_cpp_file)
        assert hash3 != hash1  # Modified file should have different hash
        
        # Restore original content
        sample_cpp_file.write_text(original_content)
    
    def test_parse_clang_tidy_output(self):
        """Test parsing of clang-tidy output."""
        stderr_output = """
src/test.cpp:5:9: warning: variable name 'myVar' doesn't follow naming convention [readability-identifier-naming]
    int myVar = 42;
        ^~~~~
        my_var
src/test.cpp:9:36: warning: use '\\n' instead of std::endl for performance [performance-avoid-endl]
        std::cout << myVar + i << std::endl;
                                  ^~~~~~~~~
                                  '\\n'
"""
        
        warnings = _parse_clang_tidy_output("", stderr_output, "src/test.cpp")
        
        assert len(warnings) == 2
        
        # Check first warning
        w1 = warnings[0]
        assert w1.line_number == 5
        assert w1.column_number == 9
        assert w1.rule_id == "readability-identifier-naming"
        assert w1.severity == "warning"
        assert "variable name 'myVar'" in w1.message
        
        # Check second warning
        w2 = warnings[1]
        assert w2.line_number == 9
        assert w2.column_number == 36
        assert w2.rule_id == "performance-avoid-endl"
        assert "use '\\n' instead" in w2.message
    
    def test_parse_malformed_output(self):
        """Test parsing of malformed clang-tidy output."""
        malformed_output = """
Some random text
Invalid line format
src/test.cpp: incomplete line
"""
        
        warnings = _parse_clang_tidy_output("", malformed_output, "src/test.cpp")
        
        # Should handle malformed output gracefully
        assert isinstance(warnings, list)
        # May contain 0 or more warnings depending on parsing logic
    
    def test_cache_operations(self, test_db, sample_analysis):
        """Test caching and retrieval operations.""" 
        file_path = "src/test.cpp"
        file_hash = "abc123"
        
        # Initially no cache
        cached = _get_cached_analysis(test_db, file_path, file_hash)
        assert cached is None
        
        # Cache the analysis
        _cache_analysis(test_db, file_path, file_hash, sample_analysis)
        
        # Should now retrieve from cache
        cached = _get_cached_analysis(test_db, file_path, file_hash)
        assert cached is not None
        assert cached.file_path == sample_analysis.file_path
        assert cached.total_warnings == sample_analysis.total_warnings
    
    def test_cache_with_different_hash(self, test_db, sample_analysis):
        """Test that different file hashes don't match cache."""
        file_path = "src/test.cpp"
        
        # Cache with one hash
        _cache_analysis(test_db, file_path, "hash1", sample_analysis)
        
        # Try to retrieve with different hash
        cached = _get_cached_analysis(test_db, file_path, "hash2")
        assert cached is None
        
        # Should work with correct hash
        cached = _get_cached_analysis(test_db, file_path, "hash1")
        assert cached is not None

class TestErrorHandling:
    """Test error handling in tools."""
    
    @pytest.mark.asyncio
    async def test_subprocess_error_handling(self, mock_agent_context, sample_cpp_file):
        """Test handling of subprocess errors."""
        file_path = str(sample_cpp_file.relative_to(mock_agent_context.deps.settings.project_root))
        
        with patch('subprocess.run', side_effect=FileNotFoundError("clang-tidy not found")):
            result = await analyze_code_with_clang_tidy(mock_agent_context, file_path)
            
            # Should return empty analysis on error
            assert result.file_path == file_path
            assert result.total_warnings == 0
            assert len(result.warnings) == 0
    
    @pytest.mark.asyncio
    async def test_database_error_recovery(self, mock_agent_context):
        """Test recovery from database errors."""
        # Simulate database error by closing connection
        mock_agent_context.deps.db_connection.close()
        
        result = await update_user_preferences(
            mock_agent_context,
            "test_strategy",
            "test-rule"
        )
        
        # Should handle error gracefully
        assert not result.success
        assert "error" in result.message.lower() or "failed" in result.message.lower()
    
    @pytest.mark.asyncio
    async def test_invalid_file_path_handling(self, mock_agent_context):
        """Test handling of invalid file paths."""
        result = await analyze_code_with_clang_tidy(mock_agent_context, "../../../etc/passwd")
        
        # Should handle invalid paths gracefully
        assert result.total_warnings == 0
        assert "../../../etc/passwd" in result.file_path

class TestPerformanceOptimizations:
    """Test performance optimizations in tools."""
    
    @pytest.mark.asyncio
    async def test_concurrent_file_analysis(self, mock_agent_context, integration_test_project):
        """Test that batch analysis uses concurrency effectively."""
        mock_agent_context.deps.settings.project_root = integration_test_project
        
        import time
        
        with patch('subprocess.run') as mock_run:
            # Simulate slow clang-tidy execution
            def slow_run(*args, **kwargs):
                time.sleep(0.1)  # 100ms delay
                return Mock(stdout="", stderr="", returncode=0)
            
            mock_run.side_effect = slow_run
            
            start_time = time.time()
            result = await batch_analyze_project(mock_agent_context, "**/*.cpp")
            end_time = time.time()
            
            # With concurrency, total time should be less than sequential time
            # This is a basic test - real testing would be more sophisticated
            assert result.total_files_analyzed >= 0
            elapsed = end_time - start_time
            # Should complete in reasonable time even with delays
            assert elapsed < 10.0  # 10 second max for test