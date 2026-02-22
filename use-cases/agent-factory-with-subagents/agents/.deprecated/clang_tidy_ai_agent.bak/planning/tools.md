# Tool Specifications - AI-Enhanced Clang-Tidy Agent

## Tool Architecture Overview

The Clang-Tidy AI Agent uses Pydantic AI's tool system to integrate with existing clang-tidy infrastructure and provide intelligent code analysis capabilities. All tools follow the `@agent.tool` decorator pattern with proper parameter validation and error handling.

## Core Tools (Essential Functions)

### 1. analyze_code_with_clang_tidy

**Purpose**: Execute clang-tidy analysis on specified files and return structured results  
**Decorator**: `@agent.tool`  
**Context Required**: Yes - needs file system access

```python
@agent.tool
async def analyze_code_with_clang_tidy(
    ctx: RunContext[ClangTidyDependencies],
    file_path: str,
    check_filters: str = "readability-*,performance-*,modernize-*"
) -> ClangTidyAnalysis:
    """
    Run clang-tidy analysis on a specific file with configurable check filters.
    
    Args:
        file_path: Path to C++ file to analyze (relative to project root)
        check_filters: Comma-separated list of clang-tidy checks to run
        
    Returns:
        ClangTidyAnalysis with warnings, suggestions, and context information
    """
```

**Parameters**:
- `file_path` (str): Required - Path to the source file to analyze
- `check_filters` (str): Optional - Clang-tidy check categories to run (default: common checks)

**Return Model**:
```python
class ClangTidyAnalysis(BaseModel):
    file_path: str
    warnings: list[Warning]
    total_warnings: int
    analysis_timestamp: datetime
    clang_tidy_version: str
    
class Warning(BaseModel):
    line_number: int
    column_number: int
    rule_id: str
    severity: str
    message: str
    suggested_fix: Optional[str]
    context_lines: list[str]
```

**Error Handling**:
- File not found: Return structured error with helpful message
- Clang-tidy execution failure: Capture stderr and provide diagnostic info
- Invalid check filters: Validate against known clang-tidy rules

### 2. explain_warning

**Purpose**: Provide detailed, educational explanations of clang-tidy warnings with context  
**Decorator**: `@agent.tool`  
**Context Required**: Yes - needs access to codebase and learning system

```python
@agent.tool
async def explain_warning(
    ctx: RunContext[ClangTidyDependencies],
    warning_rule_id: str,
    code_context: str,
    user_level: str = "intermediate"
) -> WarningExplanation:
    """
    Generate detailed explanation of a clang-tidy warning with educational context.
    
    Args:
        warning_rule_id: The clang-tidy rule identifier (e.g., 'readability-identifier-naming')
        code_context: The actual code that triggered the warning
        user_level: User expertise level (beginner, intermediate, advanced)
        
    Returns:
        WarningExplanation with detailed analysis and learning content
    """
```

**Parameters**:
- `warning_rule_id` (str): Required - Clang-tidy rule identifier
- `code_context` (str): Required - Code snippet that triggered the warning
- `user_level` (str): Optional - Adjust explanation complexity (default: "intermediate")

**Return Model**:
```python
class WarningExplanation(BaseModel):
    rule_id: str
    rule_category: str
    problem_description: str
    why_it_matters: str
    fix_strategies: list[FixStrategy]
    code_examples: CodeExamples
    related_concepts: list[str]
    severity_justification: str

class FixStrategy(BaseModel):
    name: str
    description: str
    implementation_steps: list[str]
    pros: list[str]
    cons: list[str]
    recommended: bool

class CodeExamples(BaseModel):
    problematic_code: str
    fixed_code: str
    explanation: str
```

### 3. recommend_fix_strategy

**Purpose**: Analyze code context and recommend the best fix approach using AI intelligence  
**Decorator**: `@agent.tool`  
**Context Required**: Yes - needs access to codebase analysis and user preferences

```python
@agent.tool
async def recommend_fix_strategy(
    ctx: RunContext[ClangTidyDependencies],
    warning: Warning,
    surrounding_code: str,
    project_style_guide: Optional[str] = None
) -> FixRecommendation:
    """
    Analyze code context and recommend optimal fix strategy using AI intelligence.
    
    Args:
        warning: The clang-tidy warning object
        surrounding_code: Broader code context around the warning
        project_style_guide: Optional project-specific style preferences
        
    Returns:
        FixRecommendation with intelligent strategy selection and rationale
    """
```

**Parameters**:
- `warning` (Warning): Required - The warning object from clang-tidy analysis
- `surrounding_code` (str): Required - Context code for intelligent analysis
- `project_style_guide` (Optional[str]): Optional - Project-specific coding standards

**Return Model**:
```python
class FixRecommendation(BaseModel):
    recommended_strategy: str
    confidence_score: float
    rationale: str
    implementation_plan: list[str]
    alternative_approaches: list[AlternativeApproach]
    estimated_complexity: str
    potential_side_effects: list[str]

class AlternativeApproach(BaseModel):
    strategy_name: str
    description: str
    when_to_use: str
    complexity_rating: str
```

## Integration Tools (Supporting Functions)

### 4. update_user_preferences

**Purpose**: Learn from user choices to improve future recommendations  
**Decorator**: `@agent.tool`  
**Context Required**: Yes - needs database access

```python
@agent.tool
async def update_user_preferences(
    ctx: RunContext[ClangTidyDependencies],
    user_choice: str,
    warning_type: str,
    context_tags: list[str]
) -> PreferenceUpdate:
    """
    Record user preferences to improve future fix recommendations.
    
    Args:
        user_choice: The fix strategy the user selected
        warning_type: Type of warning this preference applies to
        context_tags: Contextual tags for this preference (e.g., ['performance', 'legacy-code'])
        
    Returns:
        PreferenceUpdate confirmation with learning system status
    """
```

### 5. batch_analyze_project

**Purpose**: Analyze multiple files in the project for comprehensive quality assessment  
**Decorator**: `@agent.tool`  
**Context Required**: Yes - needs file system access and project context

```python
@agent.tool
async def batch_analyze_project(
    ctx: RunContext[ClangTidyDependencies],
    directory_pattern: str = "src/**/*.cpp",
    priority_checks: list[str] = None
) -> ProjectAnalysis:
    """
    Run clang-tidy analysis across multiple files with intelligent prioritization.
    
    Args:
        directory_pattern: Glob pattern for files to analyze
        priority_checks: List of high-priority check categories to emphasize
        
    Returns:
        ProjectAnalysis with aggregated results and recommendations
    """
```

## Tool Integration Patterns

### Error Handling Strategy
All tools implement consistent error handling:
- **Validation Errors**: Use Pydantic validation for parameter checking
- **External Tool Failures**: Capture and structure error messages helpfully
- **Graceful Degradation**: Provide partial results when possible
- **User-Friendly Messages**: Convert technical errors to actionable guidance

### Performance Considerations
- **Async Execution**: All tools are async-compatible for better responsiveness
- **Result Caching**: Cache clang-tidy results to avoid redundant analysis
- **Progress Reporting**: For long-running operations, provide status updates
- **Resource Management**: Proper cleanup of temporary files and processes

### Security Measures
- **Path Validation**: Ensure file paths are within allowed project directories
- **Input Sanitization**: Clean user input before passing to external tools
- **API Key Protection**: Secure handling of LLM provider credentials
- **Code Privacy**: Option to disable cloud analysis for sensitive codebases

## Tool Dependencies

### External Tool Requirements
- **clang-tidy**: Version 15+ with comprehensive rule sets
- **File System Access**: Read/write permissions for project directory
- **Process Execution**: Ability to spawn clang-tidy subprocess
- **SQLite Database**: For preference learning and caching

### Pydantic AI Dependencies
- **RunContext**: Access to ClangTidyDependencies for all tools
- **Model Validation**: Structured input/output validation
- **Error Propagation**: Proper exception handling in agent context
- **Async Support**: All tools designed for async execution patterns

This tool specification provides the foundation for implementing intelligent, context-aware clang-tidy integration with proper Pydantic AI patterns and comprehensive error handling.