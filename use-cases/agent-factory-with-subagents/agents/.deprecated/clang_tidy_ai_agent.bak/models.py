"""Pydantic models for structured data in the Clang-Tidy AI Agent."""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class Warning(BaseModel):
    """Represents a clang-tidy warning."""
    line_number: int = Field(..., description="Line number where warning occurs")
    column_number: int = Field(..., description="Column number where warning occurs") 
    rule_id: str = Field(..., description="Clang-tidy rule identifier")
    severity: str = Field(..., description="Warning severity level")
    message: str = Field(..., description="Warning message")
    suggested_fix: Optional[str] = Field(None, description="Suggested fix from clang-tidy")
    context_lines: List[str] = Field(default_factory=list, description="Surrounding code context")

class ClangTidyAnalysis(BaseModel):
    """Results from clang-tidy analysis of a file."""
    file_path: str = Field(..., description="Path to analyzed file")
    warnings: List[Warning] = Field(default_factory=list, description="List of warnings found")
    total_warnings: int = Field(..., description="Total number of warnings")
    analysis_timestamp: datetime = Field(default_factory=datetime.now, description="When analysis was performed")
    clang_tidy_version: str = Field(default="unknown", description="Version of clang-tidy used")

class FixStrategy(BaseModel):
    """Represents a strategy for fixing code issues."""
    name: str = Field(..., description="Name of the fix strategy")
    description: str = Field(..., description="Detailed description of the strategy")
    implementation_steps: List[str] = Field(default_factory=list, description="Step-by-step implementation")
    pros: List[str] = Field(default_factory=list, description="Advantages of this approach")
    cons: List[str] = Field(default_factory=list, description="Disadvantages of this approach")
    recommended: bool = Field(default=False, description="Whether this is the recommended approach")

class CodeExamples(BaseModel):
    """Before/after code examples."""
    problematic_code: str = Field(..., description="Code that triggers the warning")
    fixed_code: str = Field(..., description="Code after applying the fix")
    explanation: str = Field(..., description="Explanation of what changed and why")

class WarningExplanation(BaseModel):
    """Detailed explanation of a clang-tidy warning."""
    rule_id: str = Field(..., description="Clang-tidy rule identifier")
    rule_category: str = Field(..., description="Category of the rule (readability, performance, etc.)")
    problem_description: str = Field(..., description="What the problem is")
    why_it_matters: str = Field(..., description="Why this issue is important to fix")
    fix_strategies: List[FixStrategy] = Field(default_factory=list, description="Possible fix strategies")
    code_examples: CodeExamples = Field(..., description="Before/after code examples")
    related_concepts: List[str] = Field(default_factory=list, description="Related C++ concepts")
    severity_justification: str = Field(..., description="Why this has the given severity level")

class AlternativeApproach(BaseModel):
    """Alternative approach to fixing an issue."""
    strategy_name: str = Field(..., description="Name of the alternative strategy")
    description: str = Field(..., description="Description of this approach")
    when_to_use: str = Field(..., description="When this approach is most appropriate")
    complexity_rating: str = Field(..., description="Complexity rating (simple, moderate, complex)")

class FixRecommendation(BaseModel):
    """AI-powered recommendation for fixing code issues."""
    recommended_strategy: str = Field(..., description="The recommended fix strategy")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Confidence in recommendation (0-1)")
    rationale: str = Field(..., description="Why this strategy is recommended")
    implementation_plan: List[str] = Field(default_factory=list, description="Step-by-step implementation plan")
    alternative_approaches: List[AlternativeApproach] = Field(default_factory=list, description="Alternative approaches")
    estimated_complexity: str = Field(..., description="Estimated complexity of the fix")
    potential_side_effects: List[str] = Field(default_factory=list, description="Potential side effects to consider")

class PreferenceUpdate(BaseModel):
    """Result of updating user preferences."""
    success: bool = Field(..., description="Whether the update was successful")
    message: str = Field(..., description="Status message")
    preferences_count: int = Field(..., description="Total number of stored preferences")

class ProjectAnalysis(BaseModel):
    """Results from analyzing multiple files in a project."""
    total_files_analyzed: int = Field(..., description="Total number of files analyzed")
    total_warnings: int = Field(..., description="Total warnings across all files")
    warnings_by_category: dict[str, int] = Field(default_factory=dict, description="Warnings grouped by category")
    top_issues: List[Warning] = Field(default_factory=list, description="Most important issues to address")
    analysis_summary: str = Field(..., description="High-level summary of the analysis")
    recommendations: List[str] = Field(default_factory=list, description="Top-level recommendations")
    estimated_fix_time: str = Field(..., description="Estimated time to fix all issues")

class ConversationContext(BaseModel):
    """Context for conversational interactions."""
    session_id: str = Field(..., description="Unique session identifier")
    current_file: Optional[str] = Field(None, description="Currently discussed file")
    active_warnings: List[Warning] = Field(default_factory=list, description="Warnings being discussed")
    conversation_history: List[str] = Field(default_factory=list, description="Recent conversation points")
    user_expertise_level: str = Field(default="intermediate", description="User's expertise level")
    preferred_explanation_style: str = Field(default="detailed", description="User's preferred explanation style")