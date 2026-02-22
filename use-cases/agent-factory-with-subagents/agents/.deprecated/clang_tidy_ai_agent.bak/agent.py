"""Main AI-Enhanced Clang-Tidy Agent implementation using Pydantic AI."""

from pydantic_ai import Agent, RunContext
try:
    from .dependencies import ClangTidyDependencies, create_dependencies
    from .providers import get_llm_model
    from .settings import load_settings
    from .prompts import SYSTEM_PROMPT
    from .tools import (
        analyze_code_with_clang_tidy,
        explain_warning,
        recommend_fix_strategy, 
        update_user_preferences,
        batch_analyze_project
    )
    from .models import (
        ClangTidyAnalysis,
        WarningExplanation, 
        FixRecommendation,
        PreferenceUpdate,
        ProjectAnalysis,
        Warning
    )
except ImportError:
    # Fallback for direct execution
    from dependencies import ClangTidyDependencies, create_dependencies
    from providers import get_llm_model
    from settings import load_settings
    from prompts import SYSTEM_PROMPT
    from tools import (
        analyze_code_with_clang_tidy,
        explain_warning,
        recommend_fix_strategy, 
        update_user_preferences,
        batch_analyze_project
    )
    from models import (
        ClangTidyAnalysis,
        WarningExplanation, 
        FixRecommendation,
        PreferenceUpdate,
        ProjectAnalysis,
        Warning
    )

# Load settings and create model
settings = load_settings()
model = get_llm_model(settings)

# Create the main agent
clang_tidy_agent = Agent(
    model,
    deps_type=ClangTidyDependencies,
    system_prompt=SYSTEM_PROMPT
)

# Register tools with the agent
@clang_tidy_agent.tool
async def analyze_file(
    ctx: RunContext[ClangTidyDependencies],
    file_path: str,
    check_filters: str = "readability-*,performance-*,modernize-*"
) -> ClangTidyAnalysis:
    """Analyze a C++ file with clang-tidy and return structured results."""
    return await analyze_code_with_clang_tidy(ctx, file_path, check_filters)

@clang_tidy_agent.tool
async def explain_warning_detail(
    ctx: RunContext[ClangTidyDependencies],
    warning_rule_id: str,
    code_context: str,
    user_level: str = "intermediate"
) -> WarningExplanation:
    """Get detailed explanation of a clang-tidy warning."""
    return await explain_warning(ctx, warning_rule_id, code_context, user_level)

@clang_tidy_agent.tool
async def get_fix_recommendation(
    ctx: RunContext[ClangTidyDependencies],
    warning: Warning,
    surrounding_code: str,
    project_style_guide: str = None
) -> FixRecommendation:
    """Get intelligent fix recommendation for a warning."""
    return await recommend_fix_strategy(ctx, warning, surrounding_code, project_style_guide)

@clang_tidy_agent.tool
async def save_user_preference(
    ctx: RunContext[ClangTidyDependencies],
    user_choice: str,
    warning_type: str,
    context_tags: list[str] = None
) -> PreferenceUpdate:
    """Save user preference for future recommendations."""
    return await update_user_preferences(ctx, user_choice, warning_type, context_tags)

@clang_tidy_agent.tool
async def analyze_project(
    ctx: RunContext[ClangTidyDependencies],
    directory_pattern: str = "src/**/*.cpp",
    priority_checks: list[str] = None
) -> ProjectAnalysis:
    """Analyze multiple files in the project."""
    return await batch_analyze_project(ctx, directory_pattern, priority_checks)

# Convenience functions for different interaction modes

async def interactive_analysis(file_path: str, session_id: str = None) -> str:
    """Interactive analysis of a single file with conversational interface."""
    dependencies = create_dependencies(session_id)
    
    try:
        result = await clang_tidy_agent.run(
            f"Please analyze the file '{file_path}' with clang-tidy and provide an interactive, educational explanation of any issues found.",
            deps=dependencies
        )
        return result.output
    finally:
        dependencies.db_connection.close()

async def explain_warning_interactive(
    warning_rule_id: str, 
    code_context: str,
    user_level: str = "intermediate",
    session_id: str = None
) -> str:
    """Interactive explanation of a specific warning."""
    dependencies = create_dependencies(session_id)
    
    try:
        result = await clang_tidy_agent.run(
            f"Please explain the clang-tidy warning '{warning_rule_id}' in detail. The code context is:\n\n{code_context}\n\nUser level: {user_level}",
            deps=dependencies
        )
        return result.output
    finally:
        dependencies.db_connection.close()

async def recommend_fix_interactive(
    warning_description: str,
    code_context: str,
    session_id: str = None
) -> str:
    """Interactive fix recommendation with strategy discussion."""
    dependencies = create_dependencies(session_id)
    
    try:
        result = await clang_tidy_agent.run(
            f"I have this clang-tidy warning: '{warning_description}'\n\nCode context:\n{code_context}\n\nPlease analyze this and recommend the best fix strategy with detailed explanation.",
            deps=dependencies
        )
        return result.output
    finally:
        dependencies.db_connection.close()

async def project_overview(
    directory_pattern: str = "src/**/*.cpp",
    session_id: str = None
) -> str:
    """Interactive project-wide analysis and recommendations."""
    dependencies = create_dependencies(session_id)
    
    try:
        result = await clang_tidy_agent.run(
            f"Please analyze the project files matching '{directory_pattern}' and provide a comprehensive overview of code quality issues and recommendations for improvement.",
            deps=dependencies
        )
        return result.output
    finally:
        dependencies.db_connection.close()

async def conversational_code_review(
    conversation_starter: str,
    session_id: str = None
) -> str:
    """Start a conversational code review session."""
    dependencies = create_dependencies(session_id)
    
    try:
        result = await clang_tidy_agent.run(
            conversation_starter,
            deps=dependencies
        )
        return result.output
    finally:
        dependencies.db_connection.close()

# Main entry points for different usage modes

class ClangTidyAI:
    """Main interface for the AI-Enhanced Clang-Tidy Agent."""
    
    def __init__(self, session_id: str = None):
        self.session_id = session_id
        self._dependencies = None
    
    def __enter__(self):
        self._dependencies = create_dependencies(self.session_id)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._dependencies:
            self._dependencies.db_connection.close()
    
    async def __aenter__(self):
        self._dependencies = create_dependencies(self.session_id)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._dependencies:
            self._dependencies.db_connection.close()
    
    async def analyze_file(self, file_path: str, check_filters: str = None) -> str:
        """Analyze a single file with interactive explanation."""
        if not self._dependencies:
            raise RuntimeError("ClangTidyAI must be used as a context manager")
        
        query = f"Please analyze '{file_path}' with clang-tidy"
        if check_filters:
            query += f" using checks: {check_filters}"
        query += ". Provide detailed, educational explanations of any issues found."
        
        result = await clang_tidy_agent.run(query, deps=self._dependencies)
        return result.output
    
    async def explain_warning(self, rule_id: str, code: str, level: str = "intermediate") -> str:
        """Get detailed explanation of a warning."""
        if not self._dependencies:
            raise RuntimeError("ClangTidyAI must be used as a context manager")
        
        result = await clang_tidy_agent.run(
            f"Explain the clang-tidy rule '{rule_id}' for this code:\n\n{code}\n\nUser expertise: {level}",
            deps=self._dependencies
        )
        return result.output
    
    async def get_fix_recommendation(self, warning_desc: str, code: str) -> str:
        """Get intelligent fix recommendations."""
        if not self._dependencies:
            raise RuntimeError("ClangTidyAI must be used as a context manager")
        
        result = await clang_tidy_agent.run(
            f"Warning: {warning_desc}\n\nCode:\n{code}\n\nPlease recommend the best fix strategy with detailed analysis.",
            deps=self._dependencies
        )
        return result.output
    
    async def analyze_project(self, pattern: str = "src/**/*.cpp") -> str:
        """Analyze multiple files in the project."""
        if not self._dependencies:
            raise RuntimeError("ClangTidyAI must be used as a context manager")
        
        result = await clang_tidy_agent.run(
            f"Please analyze all files matching '{pattern}' and provide a comprehensive code quality overview with prioritized recommendations.",
            deps=self._dependencies
        )
        return result.output
    
    async def chat(self, message: str) -> str:
        """Have a conversational interaction about code quality."""
        if not self._dependencies:
            raise RuntimeError("ClangTidyAI must be used as a context manager")
        
        result = await clang_tidy_agent.run(message, deps=self._dependencies)
        return result.output

# Example usage patterns
if __name__ == "__main__":
    import asyncio
    
    async def example_usage():
        """Example of how to use the Clang-Tidy AI Agent."""
        
        # Single file analysis
        print("=== Single File Analysis ===")
        result = await interactive_analysis("src/main.cpp")
        print(result)
        
        print("\n=== Warning Explanation ===")
        explanation = await explain_warning_interactive(
            "readability-identifier-naming",
            "int myVar = 42;",
            "beginner"
        )
        print(explanation)
        
        print("\n=== Fix Recommendation ===")
        recommendation = await recommend_fix_interactive(
            "readability-identifier-naming: variable name 'myVar' doesn't follow naming convention",
            "int myVar = 42;\nstd::cout << myVar << std::endl;"
        )
        print(recommendation)
        
        print("\n=== Project Overview ===")
        overview = await project_overview()
        print(overview)
        
        # Using context manager for session persistence
        print("\n=== Conversational Session ===")
        async with ClangTidyAI(session_id="example") as ai:
            response1 = await ai.chat("What are the most common clang-tidy issues in C++ projects?")
            print(response1)
            
            response2 = await ai.chat("Can you analyze src/main.cpp and explain any performance issues?")
            print(response2)
    
    # Uncomment to run example
    # asyncio.run(example_usage())