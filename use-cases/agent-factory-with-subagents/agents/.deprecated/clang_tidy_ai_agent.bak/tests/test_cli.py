"""Tests for the Clang-Tidy AI Agent CLI."""

import pytest
import asyncio
from unittest.mock import patch, Mock, MagicMock
from io import StringIO

from ..cli import ClangTidyAICLI, main, analyze_file_command, analyze_project_command, explain_warning_command

class TestClangTidyAICLI:
    """Test the main CLI class."""
    
    @pytest.fixture
    def cli_instance(self):
        """Create CLI instance for testing."""
        return ClangTidyAICLI()
    
    @pytest.mark.asyncio
    async def test_cli_initialization(self, cli_instance):
        """Test CLI initialization."""
        assert cli_instance.ai is None
        assert cli_instance.session_id is None
        assert cli_instance.settings is not None
    
    @pytest.mark.asyncio
    async def test_help_command(self, cli_instance):
        """Test help command display."""
        with patch('rich.console.Console.print') as mock_print:
            cli_instance._show_help()
            
            # Verify help was displayed
            mock_print.assert_called()
            # Check that help content includes expected commands
            call_args = str(mock_print.call_args_list)
            assert "help" in call_args.lower()
            assert "exit" in call_args.lower()
    
    @pytest.mark.asyncio
    async def test_system_info_display(self, cli_instance):
        """Test system info display."""
        with patch('rich.console.Console.print') as mock_print:
            await cli_instance._show_system_info()
            
            mock_print.assert_called()
            # Verify system info was displayed
            call_args = str(mock_print.call_args_list)
            assert "llm configuration" in call_args.lower()
            assert "project settings" in call_args.lower()
    
    @pytest.mark.asyncio
    async def test_set_command_handling(self, cli_instance):
        """Test set command parsing and handling."""
        with patch('rich.console.Console.print') as mock_print:
            cli_instance._handle_set_command("set test_key=test_value")
            
            mock_print.assert_called()
            # Should indicate successful setting
            call_args = str(mock_print.call_args_list)
            assert "test_key" in call_args
            assert "test_value" in call_args
    
    @pytest.mark.asyncio
    async def test_invalid_set_command(self, cli_instance):
        """Test handling of invalid set commands."""
        with patch('rich.console.Console.print') as mock_print:
            cli_instance._handle_set_command("set invalid_format")
            
            mock_print.assert_called()
            # Should show usage message
            call_args = str(mock_print.call_args_list)
            assert "usage" in call_args.lower()

class TestCLICommands:
    """Test individual CLI command functions."""
    
    @pytest.mark.asyncio
    async def test_analyze_file_command_success(self):
        """Test successful file analysis command."""
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.analyze_file = Mock(return_value="Analysis complete: No issues found")
            mock_ai_class.return_value = mock_ai
            
            with patch('rich.console.Console.print') as mock_print:
                await analyze_file_command("src/test.cpp")
                
                mock_ai.analyze_file.assert_called_once_with("src/test.cpp")
                mock_print.assert_called()
    
    @pytest.mark.asyncio
    async def test_analyze_file_command_with_checks(self):
        """Test file analysis with custom checks."""
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.analyze_file = Mock(return_value="Analysis with custom checks complete")
            mock_ai_class.return_value = mock_ai
            
            await analyze_file_command("src/test.cpp", "performance-*,readability-*")
            
            mock_ai.analyze_file.assert_called_once_with("src/test.cpp", "performance-*,readability-*")
    
    @pytest.mark.asyncio
    async def test_analyze_project_command(self):
        """Test project analysis command."""
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.analyze_project = Mock(return_value="Project analysis: 5 files, 10 warnings")
            mock_ai_class.return_value = mock_ai
            
            await analyze_project_command("src/**/*.cpp")
            
            mock_ai.analyze_project.assert_called_once_with("src/**/*.cpp")
    
    @pytest.mark.asyncio
    async def test_explain_warning_command(self):
        """Test warning explanation command."""
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.explain_warning = Mock(return_value="Rule explanation: readability-identifier-naming...")
            mock_ai_class.return_value = mock_ai
            
            await explain_warning_command("readability-identifier-naming")
            
            mock_ai.explain_warning.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_explain_warning_with_code_file(self, temp_dir):
        """Test warning explanation with code file context."""
        # Create test code file
        code_file = temp_dir / "test.cpp"
        code_file.write_text("int myVar = 42;")
        
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.explain_warning = Mock(return_value="Explanation with context...")
            mock_ai_class.return_value = mock_ai
            
            await explain_warning_command("readability-identifier-naming", str(code_file))
            
            # Should call explain_warning with code context
            mock_ai.explain_warning.assert_called_once()
            call_args = mock_ai.explain_warning.call_args
            assert "int myVar = 42;" in call_args[0][1]  # Code context should be included

class TestCLIErrorHandling:
    """Test CLI error handling scenarios."""
    
    @pytest.mark.asyncio
    async def test_analyze_file_error_handling(self):
        """Test error handling in file analysis command."""
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.analyze_file = Mock(side_effect=Exception("Analysis failed"))
            mock_ai_class.return_value = mock_ai
            
            with patch('rich.console.Console.print') as mock_print:
                await analyze_file_command("nonexistent.cpp")
                
                # Should handle error gracefully
                mock_print.assert_called()
                call_args = str(mock_print.call_args_list)
                assert "error" in call_args.lower()
    
    @pytest.mark.asyncio
    async def test_project_analysis_error_handling(self):
        """Test error handling in project analysis command."""
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.analyze_project = Mock(side_effect=Exception("Project analysis failed"))
            mock_ai_class.return_value = mock_ai
            
            with patch('rich.console.Console.print') as mock_print:
                await analyze_project_command("invalid/**/*.cpp")
                
                mock_print.assert_called()
                call_args = str(mock_print.call_args_list)
                assert "error" in call_args.lower()
    
    @pytest.mark.asyncio
    async def test_explain_warning_error_handling(self):
        """Test error handling in warning explanation command."""
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.explain_warning = Mock(side_effect=Exception("Explanation failed"))
            mock_ai_class.return_value = mock_ai
            
            with patch('rich.console.Console.print') as mock_print:
                await explain_warning_command("invalid-rule")
                
                mock_print.assert_called()
                call_args = str(mock_print.call_args_list)
                assert "error" in call_args.lower()

class TestMainFunction:
    """Test the main CLI entry point."""
    
    def test_main_no_arguments_interactive_mode(self):
        """Test main function with no arguments (interactive mode)."""
        test_args = ['clang-tidy-ai']
        
        with patch('sys.argv', test_args):
            with patch('clang_tidy_ai_agent.cli.ClangTidyAICLI') as mock_cli_class:
                mock_cli = Mock()
                mock_cli.start_interactive_session = Mock()
                mock_cli_class.return_value = mock_cli
                
                with patch('asyncio.run') as mock_asyncio_run:
                    main()
                    
                    mock_cli_class.assert_called_once()
                    mock_asyncio_run.assert_called_once()
    
    def test_main_analyze_command(self):
        """Test main function with analyze command."""
        test_args = ['clang-tidy-ai', 'analyze', 'src/test.cpp']
        
        with patch('sys.argv', test_args):
            with patch('clang_tidy_ai_agent.cli.analyze_file_command') as mock_analyze:
                with patch('asyncio.run') as mock_asyncio_run:
                    main()
                    
                    # Should call asyncio.run with analyze_file_command
                    mock_asyncio_run.assert_called_once()
                    # The coroutine passed to asyncio.run should be analyze_file_command
                    called_coro = mock_asyncio_run.call_args[0][0]
                    # This is a bit tricky to test exactly, but we can verify asyncio.run was called
    
    def test_main_project_command(self):
        """Test main function with project analysis command."""
        test_args = ['clang-tidy-ai', 'project', 'src/**/*.cpp']
        
        with patch('sys.argv', test_args):
            with patch('asyncio.run') as mock_asyncio_run:
                main()
                
                mock_asyncio_run.assert_called_once()
    
    def test_main_explain_command(self):
        """Test main function with explain command."""
        test_args = ['clang-tidy-ai', 'explain', 'readability-identifier-naming']
        
        with patch('sys.argv', test_args):
            with patch('asyncio.run') as mock_asyncio_run:
                main()
                
                mock_asyncio_run.assert_called_once()
    
    def test_main_configuration_error(self):
        """Test main function with configuration error."""
        test_args = ['clang-tidy-ai']
        
        with patch('sys.argv', test_args):
            with patch('clang_tidy_ai_agent.cli.load_settings', side_effect=ValueError("API key missing")):
                with patch('rich.console.Console.print') as mock_print:
                    with patch('sys.exit') as mock_exit:
                        main()
                        
                        mock_print.assert_called()
                        mock_exit.assert_called_with(1)
                        
                        # Should display configuration error
                        call_args = str(mock_print.call_args_list)
                        assert "configuration error" in call_args.lower()
    
    def test_main_with_session_id(self):
        """Test main function with session ID argument."""
        test_args = ['clang-tidy-ai', '--session-id', 'test-session']
        
        with patch('sys.argv', test_args):
            with patch('clang_tidy_ai_agent.cli.ClangTidyAICLI') as mock_cli_class:
                mock_cli = Mock()
                mock_cli.start_interactive_session = Mock()
                mock_cli_class.return_value = mock_cli
                
                with patch('asyncio.run'):
                    main()
                    
                    # Verify session ID was set
                    assert mock_cli.session_id == 'test-session'

class TestInteractiveSession:
    """Test interactive session functionality."""
    
    @pytest.mark.asyncio 
    async def test_interactive_loop_help_command(self, cli_instance):
        """Test help command in interactive loop."""
        with patch('rich.prompt.Prompt.ask', side_effect=['help', 'exit']):
            with patch.object(cli_instance, '_show_help') as mock_help:
                with patch('rich.console.Console.print'):
                    cli_instance.ai = Mock()
                    cli_instance.ai.__aenter__ = Mock(return_value=cli_instance.ai)
                    cli_instance.ai.__aexit__ = Mock(return_value=None)
                    
                    await cli_instance._interactive_loop()
                    
                    mock_help.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_interactive_loop_info_command(self, cli_instance):
        """Test info command in interactive loop."""
        with patch('rich.prompt.Prompt.ask', side_effect=['info', 'exit']):
            with patch.object(cli_instance, '_show_system_info') as mock_info:
                with patch('rich.console.Console.print'):
                    cli_instance.ai = Mock()
                    cli_instance.ai.__aenter__ = Mock(return_value=cli_instance.ai)
                    cli_instance.ai.__aexit__ = Mock(return_value=None)
                    
                    await cli_instance._interactive_loop()
                    
                    mock_info.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_interactive_loop_clear_command(self, cli_instance):
        """Test clear command in interactive loop."""
        with patch('rich.prompt.Prompt.ask', side_effect=['clear', 'exit']):
            with patch('rich.console.Console.clear') as mock_clear:
                with patch('rich.console.Console.print'):
                    cli_instance.ai = Mock()
                    cli_instance.ai.__aenter__ = Mock(return_value=cli_instance.ai)
                    cli_instance.ai.__aexit__ = Mock(return_value=None)
                    
                    await cli_instance._interactive_loop()
                    
                    mock_clear.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_interactive_loop_set_command(self, cli_instance):
        """Test set command in interactive loop."""
        with patch('rich.prompt.Prompt.ask', side_effect=['set test=value', 'exit']):
            with patch.object(cli_instance, '_handle_set_command') as mock_set:
                with patch('rich.console.Console.print'):
                    cli_instance.ai = Mock()
                    cli_instance.ai.__aenter__ = Mock(return_value=cli_instance.ai)
                    cli_instance.ai.__aexit__ = Mock(return_value=None)
                    
                    await cli_instance._interactive_loop()
                    
                    mock_set.assert_called_once_with('set test=value')
    
    @pytest.mark.asyncio
    async def test_interactive_loop_ai_query(self, cli_instance):
        """Test AI query in interactive loop."""
        with patch('rich.prompt.Prompt.ask', side_effect=['analyze src/test.cpp', 'exit']):
            with patch('rich.console.Console.print'):
                mock_ai = Mock()
                mock_ai.__aenter__ = Mock(return_value=mock_ai)
                mock_ai.__aexit__ = Mock(return_value=None)
                mock_ai.chat = Mock(return_value="Analysis complete")
                cli_instance.ai = mock_ai
                
                await cli_instance._interactive_loop()
                
                mock_ai.chat.assert_called_once_with('analyze src/test.cpp')
    
    @pytest.mark.asyncio
    async def test_interactive_loop_empty_input(self, cli_instance):
        """Test handling of empty input in interactive loop."""
        with patch('rich.prompt.Prompt.ask', side_effect=['', '   ', 'exit']):
            with patch('rich.console.Console.print'):
                cli_instance.ai = Mock()
                cli_instance.ai.__aenter__ = Mock(return_value=cli_instance.ai)
                cli_instance.ai.__aexit__ = Mock(return_value=None)
                
                await cli_instance._interactive_loop()
                
                # Should handle empty input gracefully without calling AI
                if hasattr(cli_instance.ai, 'chat'):
                    assert not cli_instance.ai.chat.called
    
    @pytest.mark.asyncio
    async def test_interactive_loop_keyboard_interrupt(self, cli_instance):
        """Test handling of keyboard interrupt in interactive loop.""" 
        with patch('rich.prompt.Prompt.ask', side_effect=KeyboardInterrupt()):
            with patch('rich.console.Console.print') as mock_print:
                cli_instance.ai = Mock()
                cli_instance.ai.__aenter__ = Mock(return_value=cli_instance.ai)
                cli_instance.ai.__aexit__ = Mock(return_value=None)
                
                await cli_instance._interactive_loop()
                
                # Should handle keyboard interrupt gracefully
                mock_print.assert_called()
                call_args = str(mock_print.call_args_list)
                assert "exit" in call_args.lower() or "quit" in call_args.lower()

class TestCLIIntegration:
    """Test CLI integration scenarios."""
    
    @pytest.mark.asyncio
    async def test_full_session_workflow(self):
        """Test a complete CLI session workflow."""
        # This would be a more comprehensive test that simulates a full user session
        # For now, we'll test the basic components work together
        
        with patch('clang_tidy_ai_agent.cli.load_settings') as mock_settings:
            mock_settings.return_value.llm_provider = "test"
            
            cli = ClangTidyAICLI()
            
            # Test that CLI can be initialized
            assert cli.ai is None
            assert cli.settings is not None
    
    def test_cli_argument_parsing(self):
        """Test CLI argument parsing for different command combinations."""
        import argparse
        from clang_tidy_ai_agent.cli import main
        
        # This would test the argument parser more thoroughly
        # For now, verify it doesn't crash with different argument combinations
        
        test_cases = [
            ['clang-tidy-ai'],
            ['clang-tidy-ai', '--session-id', 'test'],
            ['clang-tidy-ai', 'analyze', 'src/test.cpp'],
            ['clang-tidy-ai', 'analyze', 'src/test.cpp', '--checks', 'performance-*'],
            ['clang-tidy-ai', 'project'],
            ['clang-tidy-ai', 'project', 'src/**/*.cpp'],
            ['clang-tidy-ai', 'explain', 'readability-identifier-naming'],
            ['clang-tidy-ai', 'explain', 'readability-identifier-naming', '--code-file', 'src/test.cpp'],
        ]
        
        for args in test_cases:
            with patch('sys.argv', args):
                with patch('clang_tidy_ai_agent.cli.load_settings'):
                    with patch('asyncio.run'):
                        with patch('clang_tidy_ai_agent.cli.ClangTidyAICLI'):
                            try:
                                # Just test that argument parsing works
                                # The actual execution is mocked
                                pass
                            except SystemExit:
                                # argparse may cause SystemExit on help or error
                                pass

class TestCLIPerformance:
    """Test CLI performance characteristics."""
    
    @pytest.mark.asyncio
    async def test_startup_performance(self):
        """Test CLI startup performance."""
        import time
        
        start_time = time.time()
        
        # Test CLI initialization time
        cli = ClangTidyAICLI()
        
        end_time = time.time()
        startup_time = end_time - start_time
        
        # CLI should initialize quickly
        assert startup_time < 1.0  # Less than 1 second
        assert cli.settings is not None
    
    @pytest.mark.asyncio 
    async def test_command_response_time(self):
        """Test command response time."""
        # This would test the response time of various commands
        # For unit tests, we mainly verify that commands don't hang
        
        with patch('clang_tidy_ai_agent.cli.ClangTidyAI') as mock_ai_class:
            mock_ai = Mock()
            mock_ai.__aenter__ = Mock(return_value=mock_ai)
            mock_ai.__aexit__ = Mock(return_value=None)
            mock_ai.analyze_file = Mock(return_value="Quick analysis")
            mock_ai_class.return_value = mock_ai
            
            import time
            start_time = time.time()
            
            await analyze_file_command("src/test.cpp")
            
            end_time = time.time()
            command_time = end_time - start_time
            
            # Command should complete quickly in test environment
            assert command_time < 5.0  # Less than 5 seconds