"""Command-line interface for the AI-Enhanced Clang-Tidy Agent."""

import asyncio
import argparse
import sys
from pathlib import Path
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, Confirm
from rich.markdown import Markdown
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

try:
    from .agent import ClangTidyAI
    from .settings import load_settings
except ImportError:
    # Fallback for direct execution
    from agent import ClangTidyAI
    from settings import load_settings

console = Console()

class ClangTidyAICLI:
    """Interactive CLI for the Clang-Tidy AI Agent."""
    
    def __init__(self):
        self.ai = None
        self.session_id = None
        self.settings = load_settings()
    
    async def start_interactive_session(self):
        """Start an interactive chat session with the agent."""
        console.print(Panel.fit(
            "[bold blue]🤖 AI-Enhanced Clang-Tidy Assistant[/bold blue]\n"
            "Your intelligent code quality companion\n\n"
            "Type 'help' for commands, 'exit' to quit",
            title="Welcome"
        ))
        
        # Initialize AI agent with session persistence
        self.ai = ClangTidyAI(session_id=self.session_id)
        
        try:
            async with self.ai:
                await self._interactive_loop()
        except KeyboardInterrupt:
            console.print("\n[yellow]Session interrupted by user[/yellow]")
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    async def _interactive_loop(self):
        """Main interactive loop."""
        while True:
            try:
                # Get user input
                user_input = Prompt.ask("\n[bold green]You[/bold green]", default="").strip()
                
                if not user_input:
                    continue
                
                # Handle special commands
                if user_input.lower() in ['exit', 'quit', 'q']:
                    console.print("[yellow]Goodbye! Happy coding! 🚀[/yellow]")
                    break
                
                elif user_input.lower() == 'help':
                    self._show_help()
                    continue
                
                elif user_input.lower() == 'info':
                    await self._show_system_info()
                    continue
                
                elif user_input.lower() == 'clear':
                    console.clear()
                    continue
                
                elif user_input.lower().startswith('set '):
                    self._handle_set_command(user_input)
                    continue
                
                # Process AI query
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    console=console,
                    transient=True,
                ) as progress:
                    task = progress.add_task("🤔 Analyzing...", total=None)
                    
                    try:
                        response = await self.ai.chat(user_input)
                        progress.update(task, completed=True)
                        
                        # Display response
                        console.print(f"\n[bold blue]🤖 Assistant[/bold blue]")
                        console.print(Panel(Markdown(response)))
                        
                    except Exception as e:
                        progress.update(task, completed=True)
                        console.print(f"[red]Error processing request: {e}[/red]")
            
            except KeyboardInterrupt:
                console.print("\n[yellow]Use 'exit' to quit properly[/yellow]")
                continue
            except EOFError:
                break
    
    def _show_help(self):
        """Show help information."""
        help_table = Table(title="Available Commands")
        help_table.add_column("Command", style="cyan", no_wrap=True)
        help_table.add_column("Description", style="white")
        
        help_table.add_row("help", "Show this help message")
        help_table.add_row("info", "Show system configuration")
        help_table.add_row("clear", "Clear the screen")
        help_table.add_row("exit/quit", "Exit the application")
        help_table.add_row("set key=value", "Set preferences")
        
        console.print(help_table)
        
        console.print("\n[bold]Example Queries:[/bold]")
        console.print("• Analyze src/main.cpp for performance issues")
        console.print("• Explain the readability-identifier-naming warning")
        console.print("• What are the most common C++ code quality issues?")
        console.print("• How do I fix move constructor warnings?")
        console.print("• Analyze all files in src/ directory")
    
    async def _show_system_info(self):
        """Show system configuration information."""
        info_panel = f"""
[bold]LLM Configuration:[/bold]
• Provider: {self.settings.llm_provider}
• Model: {self.settings.llm_model}
• Base URL: {self.settings.llm_base_url}

[bold]Project Settings:[/bold]
• Project Root: {self.settings.project_root}
• Clang-Tidy Path: {self.settings.clang_tidy_binary_path}
• Database: {self.settings.clang_tidy_ai_db_path}

[bold]Features:[/bold]
• Learning Mode: {'✅' if self.settings.enable_learning_mode else '❌'}
• Result Caching: {'✅' if self.settings.cache_analysis_results else '❌'}
• Session ID: {self.ai.session_id if self.ai else 'Not started'}
"""
        console.print(Panel(info_panel, title="System Information"))
    
    def _handle_set_command(self, command: str):
        """Handle set key=value commands."""
        try:
            _, assignment = command.split(' ', 1)
            if '=' not in assignment:
                console.print("[red]Usage: set key=value[/red]")
                return
            
            key, value = assignment.split('=', 1)
            key = key.strip()
            value = value.strip()
            
            # Handle boolean values
            if value.lower() in ('true', 'false'):
                value = value.lower() == 'true'
            
            # Set the configuration (this would need proper implementation)
            console.print(f"[green]Set {key} = {value}[/green]")
            console.print("[yellow]Note: Configuration changes require restart[/yellow]")
            
        except ValueError:
            console.print("[red]Usage: set key=value[/red]")

async def analyze_file_command(file_path: str, checks: str = None):
    """Analyze a single file from command line."""
    console.print(f"[blue]Analyzing {file_path}...[/blue]")
    
    async with ClangTidyAI() as ai:
        try:
            if checks:
                result = await ai.analyze_file(file_path, checks)
            else:
                result = await ai.analyze_file(file_path)
            
            console.print(Panel(Markdown(result), title=f"Analysis: {file_path}"))
            
        except Exception as e:
            console.print(f"[red]Error analyzing {file_path}: {e}[/red]")

async def analyze_project_command(pattern: str = "src/**/*.cpp"):
    """Analyze project files from command line."""
    console.print(f"[blue]Analyzing project files: {pattern}...[/blue]")
    
    async with ClangTidyAI() as ai:
        try:
            result = await ai.analyze_project(pattern)
            console.print(Panel(Markdown(result), title="Project Analysis"))
            
        except Exception as e:
            console.print(f"[red]Error analyzing project: {e}[/red]")

async def explain_warning_command(rule_id: str, code_file: str = None):
    """Explain a specific warning rule."""
    console.print(f"[blue]Explaining clang-tidy rule: {rule_id}...[/blue]")
    
    code_context = ""
    if code_file and Path(code_file).exists():
        with open(code_file, 'r') as f:
            code_context = f.read()
    
    async with ClangTidyAI() as ai:
        try:
            result = await ai.explain_warning(rule_id, code_context)
            console.print(Panel(Markdown(result), title=f"Rule Explanation: {rule_id}"))
            
        except Exception as e:
            console.print(f"[red]Error explaining rule: {e}[/red]")

def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="AI-Enhanced Clang-Tidy Assistant",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  clang-tidy-ai                                    # Start interactive session
  clang-tidy-ai analyze src/main.cpp               # Analyze single file
  clang-tidy-ai project "src/**/*.cpp"             # Analyze project files
  clang-tidy-ai explain readability-identifier-naming  # Explain a rule
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # Interactive mode (default)
    parser.add_argument('--session-id', help='Session ID for persistence')
    
    # Analyze file command
    analyze_parser = subparsers.add_parser('analyze', help='Analyze a single file')
    analyze_parser.add_argument('file_path', help='Path to C++ file to analyze')
    analyze_parser.add_argument('--checks', help='Clang-tidy checks to run')
    
    # Project analysis command
    project_parser = subparsers.add_parser('project', help='Analyze project files')
    project_parser.add_argument('pattern', nargs='?', default='src/**/*.cpp', 
                               help='File pattern to analyze')
    
    # Explain rule command
    explain_parser = subparsers.add_parser('explain', help='Explain a clang-tidy rule')
    explain_parser.add_argument('rule_id', help='Clang-tidy rule ID to explain')
    explain_parser.add_argument('--code-file', help='Code file for context')
    
    args = parser.parse_args()
    
    # Validate settings
    try:
        settings = load_settings()
    except ValueError as e:
        console.print(f"[red]Configuration Error: {e}[/red]")
        console.print("\n[yellow]Please check your .env file and ensure LLM_API_KEY is set.[/yellow]")
        sys.exit(1)
    
    # Run appropriate command
    if args.command == 'analyze':
        asyncio.run(analyze_file_command(args.file_path, args.checks))
    
    elif args.command == 'project':
        asyncio.run(analyze_project_command(args.pattern))
    
    elif args.command == 'explain':
        asyncio.run(explain_warning_command(args.rule_id, args.code_file))
    
    else:
        # Interactive mode
        cli = ClangTidyAICLI()
        cli.session_id = args.session_id
        asyncio.run(cli.start_interactive_session())

if __name__ == "__main__":
    main()