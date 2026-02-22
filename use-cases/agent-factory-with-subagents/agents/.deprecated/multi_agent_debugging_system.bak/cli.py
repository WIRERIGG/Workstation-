"""
Command-line interface for Multi-Agent Debugging System.
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Optional

import click
from .agent import analyze_cpp_code, AnalysisResult


@click.group()
@click.version_option()
def cli():
    """Multi-Agent Debugging System for C++ code analysis."""
    pass


@cli.command()
@click.argument('target_path', type=click.Path(exists=True))
@click.option('--analysis-mode', '-m',
              type=click.Choice(['static', 'dynamic', 'comprehensive']),
              default='comprehensive',
              help='Type of analysis to perform')
@click.option('--output-format', '-o',
              type=click.Choice(['json', 'human', 'both']),
              default='both',
              help='Output format')
@click.option('--max-parallel', '-p',
              type=int, default=4,
              help='Maximum parallel tool executions')
@click.option('--timeout', '-t',
              type=int, default=300,
              help='Analysis timeout in seconds')
@click.option('--output-file', '-f',
              type=click.Path(),
              help='Output file path (optional)')
@click.option('--verbose', '-v', is_flag=True,
              help='Verbose output')
def analyze(
    target_path: str,
    analysis_mode: str,
    output_format: str,
    max_parallel: int,
    timeout: int,
    output_file: Optional[str],
    verbose: bool
):
    """Analyze C++ code with multi-agent debugging system."""

    async def run_analysis():
        if verbose:
            click.echo(f"🚀 Starting {analysis_mode} analysis of {target_path}")
            click.echo(f"📊 Configuration: {max_parallel} parallel tools, {timeout}s timeout")

        try:
            result = await analyze_cpp_code(
                target_path=target_path,
                analysis_mode=analysis_mode,
                output_format=output_format,
                max_parallel_tools=max_parallel,
                timeout=timeout
            )

            # Display results
            if output_format in ['human', 'both']:
                click.echo("\n" + "="*60)
                click.echo("📋 MULTI-AGENT DEBUGGING ANALYSIS REPORT")
                click.echo("="*60)
                click.echo(result.human_readable_report)

                if verbose:
                    click.echo(f"\n📊 Analysis Summary:")
                    click.echo(f"   Session ID: {result.session_id}")
                    click.echo(f"   Execution Time: {result.execution_time:.2f}s")
                    click.echo(f"   Tools Executed: {', '.join(result.tools_executed)}")
                    click.echo(f"   Total Issues: {result.total_issues}")
                    click.echo(f"   Critical Issues: {result.critical_issues}")

            if output_format in ['json', 'both']:
                json_output = result.model_dump_json(indent=2)
                if output_format == 'json':
                    click.echo(json_output)
                elif verbose:
                    click.echo(f"\n📝 JSON Report available")

            # Save to file if requested
            if output_file:
                output_path = Path(output_file)
                if output_format == 'json':
                    output_path.write_text(result.model_dump_json(indent=2))
                else:
                    output_path.write_text(result.human_readable_report)
                click.echo(f"💾 Results saved to: {output_file}")

            # Exit code based on critical issues
            sys.exit(1 if result.critical_issues > 0 else 0)

        except Exception as e:
            click.echo(f"❌ Analysis failed: {str(e)}", err=True)
            sys.exit(1)

    # Run async analysis
    asyncio.run(run_analysis())


@cli.command()
@click.argument('target_path', type=click.Path(exists=True))
@click.option('--tools', '-t', multiple=True,
              type=click.Choice(['gdb', 'strace', 'ltrace', 'perf', 'cppcheck', 'clang-tidy', 'valgrind']),
              help='Specific tools to run')
def quick(target_path: str, tools: tuple):
    """Quick analysis with specific tools only."""

    async def run_quick_analysis():
        try:
            # Import here to avoid circular imports
            from .tools import run_debugging_tool
            from .dependencies import create_debugging_context, AgentDependencies, AnalysisMode
            from pydantic_ai import RunContext

            click.echo(f"🏃 Quick analysis of {target_path}")

            context = create_debugging_context(target_path, AnalysisMode.COMPREHENSIVE)
            deps = AgentDependencies(context=context, message_queue=[], results_cache={})

            selected_tools = list(tools) if tools else ['cppcheck', 'clang-tidy']

            results = []
            for tool in selected_tools:
                click.echo(f"   Running {tool}...")
                result = await run_debugging_tool(
                    RunContext(deps=deps),
                    tool,
                    target_path
                )
                results.append(result)

            # Quick summary
            total_issues = sum(len(r.get('issues', [])) for r in results)
            click.echo(f"\n📊 Quick Results:")
            click.echo(f"   Tools: {', '.join(selected_tools)}")
            click.echo(f"   Issues Found: {total_issues}")

            for result in results:
                if result.get('success') and result.get('issues'):
                    click.echo(f"\n{result['tool_name'].upper()}:")
                    for issue in result['issues'][:3]:  # Show top 3 issues
                        severity = issue.get('severity', 'unknown').upper()
                        message = issue.get('message', 'No message')[:80]
                        click.echo(f"   [{severity}] {message}")

        except Exception as e:
            click.echo(f"❌ Quick analysis failed: {str(e)}", err=True)
            sys.exit(1)

    asyncio.run(run_quick_analysis())


@cli.command()
def check():
    """Check system requirements and tool availability."""

    click.echo("🔧 Checking Multi-Agent Debugging System requirements...\n")

    # Check Python packages
    required_packages = [
        'pydantic_ai',
        'pydantic_settings',
        'click',
        'python-dotenv'
    ]

    for package in required_packages:
        try:
            __import__(package.replace('-', '_'))
            click.echo(f"✅ {package}")
        except ImportError:
            click.echo(f"❌ {package} - Missing")

    # Check system tools
    import subprocess
    system_tools = {
        'gdb': 'GNU Debugger',
        'strace': 'System call tracer',
        'ltrace': 'Library call tracer',
        'perf': 'Performance analysis tool',
        'cppcheck': 'Static analysis tool',
        'clang-tidy': 'Clang-based linter',
        'valgrind': 'Memory error detector'
    }

    click.echo("\n🛠️  System Tools:")
    for tool, description in system_tools.items():
        try:
            result = subprocess.run([tool, '--version'],
                                  capture_output=True,
                                  check=True)
            click.echo(f"✅ {tool} - {description}")
        except (subprocess.CalledProcessError, FileNotFoundError):
            click.echo(f"❌ {tool} - {description} (Not found)")

    # Check LLM configuration
    click.echo("\n🤖 LLM Configuration:")
    try:
        from .providers import validate_llm_configuration
        if validate_llm_configuration():
            click.echo("✅ LLM provider configured")
        else:
            click.echo("❌ LLM provider not configured")
    except Exception as e:
        click.echo(f"❌ LLM configuration error: {e}")

    click.echo("\n📝 Setup Instructions:")
    click.echo("   1. Install missing Python packages: pip install -r requirements.txt")
    click.echo("   2. Install missing system tools via package manager")
    click.echo("   3. Create .env file with LLM_API_KEY")
    click.echo("   4. Run 'multi-agent-debug analyze --help' for usage")


@cli.command()
@click.argument('target_path', type=click.Path(exists=True))
def demo(target_path: str):
    """Run demo analysis with detailed explanations."""

    async def run_demo():
        click.echo("🎯 Multi-Agent Debugging System Demo")
        click.echo("="*50)

        click.echo(f"\n📁 Target: {target_path}")
        click.echo("🤖 Agents: Lead, Tool Agents (GDB, Strace, Cppcheck, etc.), Detail, Plan")
        click.echo("📊 Mode: Comprehensive (static + dynamic)")

        click.echo("\n⏳ Starting comprehensive analysis...")
        click.echo("   This will demonstrate the multi-agent workflow:")
        click.echo("   1. 🎯 Plan Agent creates execution strategy")
        click.echo("   2. ⚡ Tool Agents run in parallel")
        click.echo("   3. 🔍 Detail Agent correlates findings")
        click.echo("   4. 📋 Lead Agent generates report")

        try:
            result = await analyze_cpp_code(
                target_path=target_path,
                analysis_mode="comprehensive",
                output_format="both",
                max_parallel_tools=3,
                timeout=180
            )

            click.echo(f"\n✅ Demo completed in {result.execution_time:.1f}s")
            click.echo(f"🔍 Analysis Results:")
            click.echo(f"   - Tools executed: {len(result.tools_executed)}")
            click.echo(f"   - Issues found: {result.total_issues}")
            click.echo(f"   - Critical issues: {result.critical_issues}")
            click.echo(f"   - Recommendations: {len(result.recommendations)}")

            if result.recommendations:
                click.echo(f"\n🎯 Top Recommendations:")
                for i, rec in enumerate(result.recommendations[:3], 1):
                    click.echo(f"   {i}. {rec}")

            click.echo("\n📊 Full report generated above ⬆️")

        except Exception as e:
            click.echo(f"❌ Demo failed: {str(e)}", err=True)

    asyncio.run(run_demo())


if __name__ == '__main__':
    cli()