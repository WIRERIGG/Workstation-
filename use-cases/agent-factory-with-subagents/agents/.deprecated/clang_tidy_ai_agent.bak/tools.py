"""Tools for the Clang-Tidy AI Agent."""

import subprocess
import hashlib
import json
import asyncio
from pathlib import Path
from typing import List, Optional
from pydantic_ai import RunContext

try:
    from .dependencies import ClangTidyDependencies, save_user_preference, record_feedback
    from .models import (
        ClangTidyAnalysis, Warning, WarningExplanation, FixRecommendation, 
        PreferenceUpdate, ProjectAnalysis, CodeExamples, FixStrategy, AlternativeApproach
    )
except ImportError:
    from dependencies import ClangTidyDependencies, save_user_preference, record_feedback
    from models import (
        ClangTidyAnalysis, Warning, WarningExplanation, FixRecommendation, 
        PreferenceUpdate, ProjectAnalysis, CodeExamples, FixStrategy, AlternativeApproach
    )

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
    deps = ctx.deps
    logger = deps.logger
    
    try:
        # Resolve full path
        full_path = deps.settings.project_root / file_path
        if not full_path.exists():
            logger.error(f"File not found: {full_path}")
            return ClangTidyAnalysis(
                file_path=file_path,
                total_warnings=0,
                warnings=[]
            )
        
        # Check cache first
        if deps.settings.cache_analysis_results:
            file_hash = _calculate_file_hash(full_path)
            cached_result = _get_cached_analysis(deps.db_connection, file_path, file_hash)
            if cached_result:
                deps.analysis_stats["cache_hits"] += 1
                logger.info(f"Using cached analysis for {file_path}")
                return cached_result
        
        # Run clang-tidy
        cmd = [
            str(deps.settings.clang_tidy_binary_path),
            f"--checks={check_filters}",
            "--format-style=file",
            "--export-fixes=-",
            str(full_path),
            "--",
            "-I/usr/include",
            "-I/usr/include/c++/12"
        ]
        
        logger.info(f"Running clang-tidy on {file_path}")
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=deps.settings.project_root)
        
        # Parse output
        warnings = _parse_clang_tidy_output(result.stdout, result.stderr, file_path)
        
        analysis = ClangTidyAnalysis(
            file_path=file_path,
            warnings=warnings,
            total_warnings=len(warnings),
            clang_tidy_version=_get_clang_tidy_version(deps.settings.clang_tidy_binary_path)
        )
        
        # Cache result
        if deps.settings.cache_analysis_results:
            _cache_analysis(deps.db_connection, file_path, file_hash, analysis)
        
        deps.analysis_stats["total_analyses"] += 1
        logger.info(f"Analysis complete: found {len(warnings)} warnings in {file_path}")
        
        return analysis
        
    except Exception as e:
        logger.error(f"Error analyzing {file_path}: {e}")
        return ClangTidyAnalysis(
            file_path=file_path,
            total_warnings=0,
            warnings=[]
        )

async def explain_warning(
    ctx: RunContext[ClangTidyDependencies],
    warning_rule_id: str,
    code_context: str,
    user_level: str = "intermediate"
) -> WarningExplanation:
    """
    Generate detailed explanation of a clang-tidy warning with educational context.
    
    Args:
        warning_rule_id: The clang-tidy rule identifier
        code_context: The actual code that triggered the warning
        user_level: User expertise level (beginner, intermediate, advanced)
        
    Returns:
        WarningExplanation with detailed analysis and learning content
    """
    deps = ctx.deps
    logger = deps.logger
    
    try:
        # Get rule information
        rule_info = _get_rule_information(warning_rule_id)
        
        # Create example fix strategies
        strategies = _generate_fix_strategies(warning_rule_id, code_context)
        
        # Generate code examples
        examples = _generate_code_examples(warning_rule_id, code_context)
        
        explanation = WarningExplanation(
            rule_id=warning_rule_id,
            rule_category=rule_info["category"],
            problem_description=rule_info["description"],
            why_it_matters=rule_info["importance"],
            fix_strategies=strategies,
            code_examples=examples,
            related_concepts=rule_info["related_concepts"],
            severity_justification=rule_info["severity_explanation"]
        )
        
        logger.info(f"Generated explanation for rule {warning_rule_id}")
        return explanation
        
    except Exception as e:
        logger.error(f"Error explaining warning {warning_rule_id}: {e}")
        # Return a minimal explanation
        return WarningExplanation(
            rule_id=warning_rule_id,
            rule_category="unknown",
            problem_description=f"Clang-tidy rule {warning_rule_id} was triggered",
            why_it_matters="This rule helps maintain code quality",
            code_examples=CodeExamples(
                problematic_code=code_context,
                fixed_code="// Fix not available",
                explanation="Unable to generate explanation"
            ),
            severity_justification="Standard clang-tidy rule"
        )

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
    deps = ctx.deps
    logger = deps.logger
    
    try:
        # Check user preferences
        preferred_strategy = deps.user_preferences.get(warning.rule_id, {}).get("preferred_strategy")
        
        # Analyze code context for complexity
        complexity = _analyze_code_complexity(surrounding_code)
        
        # Generate recommendations based on warning type and context
        strategies = _generate_contextual_strategies(warning, surrounding_code, complexity)
        
        # Select best strategy
        recommended = _select_best_strategy(strategies, preferred_strategy, complexity)
        
        # Generate alternatives
        alternatives = _generate_alternatives(strategies, recommended)
        
        recommendation = FixRecommendation(
            recommended_strategy=recommended["name"],
            confidence_score=recommended["confidence"],
            rationale=recommended["rationale"],
            implementation_plan=recommended["steps"],
            alternative_approaches=alternatives,
            estimated_complexity=complexity,
            potential_side_effects=recommended.get("side_effects", [])
        )
        
        logger.info(f"Generated fix recommendation for {warning.rule_id}")
        return recommendation
        
    except Exception as e:
        logger.error(f"Error generating recommendation for {warning.rule_id}: {e}")
        return FixRecommendation(
            recommended_strategy="manual_review",
            confidence_score=0.5,
            rationale="Unable to analyze context automatically",
            implementation_plan=["Review the warning manually", "Apply appropriate fix"],
            estimated_complexity="unknown"
        )

async def update_user_preferences(
    ctx: RunContext[ClangTidyDependencies],
    user_choice: str,
    warning_type: str,
    context_tags: List[str] = None
) -> PreferenceUpdate:
    """
    Record user preferences to improve future fix recommendations.
    
    Args:
        user_choice: The fix strategy the user selected
        warning_type: Type of warning this preference applies to
        context_tags: Contextual tags for this preference
        
    Returns:
        PreferenceUpdate confirmation with learning system status
    """
    deps = ctx.deps
    logger = deps.logger
    
    try:
        # Save to database
        save_user_preference(
            deps.db_connection,
            deps.session_id,
            warning_type,
            user_choice,
            context_tags or []
        )
        
        # Update in-memory preferences
        deps.user_preferences[warning_type] = {
            "preferred_strategy": user_choice,
            "context_tags": context_tags or []
        }
        
        # Count total preferences
        cursor = deps.db_connection.cursor()
        cursor.execute("SELECT COUNT(*) FROM user_preferences WHERE session_id = ?", (deps.session_id,))
        count = cursor.fetchone()[0]
        
        logger.info(f"Updated preference for {warning_type}: {user_choice}")
        
        return PreferenceUpdate(
            success=True,
            message=f"Preference saved for {warning_type}",
            preferences_count=count
        )
        
    except Exception as e:
        logger.error(f"Error updating preferences: {e}")
        return PreferenceUpdate(
            success=False,
            message=f"Failed to save preference: {e}",
            preferences_count=0
        )

async def batch_analyze_project(
    ctx: RunContext[ClangTidyDependencies],
    directory_pattern: str = "src/**/*.cpp",
    priority_checks: List[str] = None
) -> ProjectAnalysis:
    """
    Run clang-tidy analysis across multiple files with intelligent prioritization.
    
    Args:
        directory_pattern: Glob pattern for files to analyze
        priority_checks: List of high-priority check categories to emphasize
        
    Returns:
        ProjectAnalysis with aggregated results and recommendations
    """
    deps = ctx.deps
    logger = deps.logger
    
    try:
        # Find files matching pattern
        files = list(deps.settings.project_root.glob(directory_pattern))
        
        if not files:
            logger.warning(f"No files found matching pattern: {directory_pattern}")
            return ProjectAnalysis(
                total_files_analyzed=0,
                total_warnings=0,
                analysis_summary="No files found to analyze"
            )
        
        logger.info(f"Starting batch analysis of {len(files)} files")
        
        # Analyze files in parallel (limit concurrency)
        semaphore = asyncio.Semaphore(4)  # Limit to 4 concurrent analyses
        
        async def analyze_single_file(file_path):
            async with semaphore:
                relative_path = str(file_path.relative_to(deps.settings.project_root))
                check_filters = ",".join(priority_checks) if priority_checks else "readability-*,performance-*,modernize-*"
                return await analyze_code_with_clang_tidy(ctx, relative_path, check_filters)
        
        # Run analyses
        analyses = await asyncio.gather(*[analyze_single_file(f) for f in files])
        
        # Aggregate results
        total_warnings = sum(a.total_warnings for a in analyses)
        warnings_by_category = {}
        all_warnings = []
        
        for analysis in analyses:
            for warning in analysis.warnings:
                all_warnings.append(warning)
                category = _get_rule_category(warning.rule_id)
                warnings_by_category[category] = warnings_by_category.get(category, 0) + 1
        
        # Find top issues (sort by severity and frequency)
        top_issues = _prioritize_warnings(all_warnings)[:10]
        
        # Generate summary and recommendations
        summary = _generate_project_summary(len(files), total_warnings, warnings_by_category)
        recommendations = _generate_project_recommendations(warnings_by_category, top_issues)
        
        project_analysis = ProjectAnalysis(
            total_files_analyzed=len(files),
            total_warnings=total_warnings,
            warnings_by_category=warnings_by_category,
            top_issues=top_issues,
            analysis_summary=summary,
            recommendations=recommendations,
            estimated_fix_time=_estimate_fix_time(total_warnings)
        )
        
        logger.info(f"Batch analysis complete: {total_warnings} warnings across {len(files)} files")
        return project_analysis
        
    except Exception as e:
        logger.error(f"Error in batch analysis: {e}")
        return ProjectAnalysis(
            total_files_analyzed=0,
            total_warnings=0,
            analysis_summary=f"Analysis failed: {e}"
        )

# Helper functions

def _calculate_file_hash(file_path: Path) -> str:
    """Calculate SHA-256 hash of file contents."""
    with open(file_path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()

def _get_cached_analysis(connection, file_path: str, file_hash: str) -> Optional[ClangTidyAnalysis]:
    """Retrieve cached analysis result."""
    cursor = connection.cursor()
    cursor.execute(
        "SELECT analysis_result FROM analysis_cache WHERE file_path = ? AND file_hash = ?",
        (file_path, file_hash)
    )
    result = cursor.fetchone()
    if result:
        try:
            return ClangTidyAnalysis.model_validate_json(result[0])
        except Exception:
            return None
    return None

def _cache_analysis(connection, file_path: str, file_hash: str, analysis: ClangTidyAnalysis) -> None:
    """Cache analysis result."""
    cursor = connection.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO analysis_cache (file_path, file_hash, analysis_result) VALUES (?, ?, ?)",
        (file_path, file_hash, analysis.model_dump_json())
    )
    connection.commit()

def _parse_clang_tidy_output(stdout: str, stderr: str, file_path: str) -> List[Warning]:
    """Parse clang-tidy output into Warning objects."""
    warnings = []
    
    # Parse stdout which contains the actual warnings (when using --export-fixes=-)
    lines = stdout.split('\n')
    for line in lines:
        if file_path in line and ('warning:' in line or 'error:' in line):
            try:
                # Parse format: file:line:col: severity: message [rule]
                parts = line.split(':', 3)
                if len(parts) >= 4:
                    line_num = int(parts[1]) if parts[1].isdigit() else 0
                    col_num = int(parts[2]) if parts[2].isdigit() else 0
                    
                    rest = parts[3].strip()
                    if ': ' in rest:
                        severity_msg = rest.split(': ', 1)
                        severity = severity_msg[0]
                        message_rule = severity_msg[1]
                        
                        # Extract rule from [rule-name] at end
                        rule_id = "unknown"
                        if '[' in message_rule and ']' in message_rule:
                            rule_start = message_rule.rfind('[')
                            rule_end = message_rule.rfind(']')
                            if rule_start < rule_end:
                                rule_id = message_rule[rule_start+1:rule_end]
                                message_rule = message_rule[:rule_start].strip()
                        
                        warnings.append(Warning(
                            line_number=line_num,
                            column_number=col_num,
                            rule_id=rule_id,
                            severity=severity,
                            message=message_rule,
                            context_lines=[]
                        ))
            except (ValueError, IndexError):
                # Skip malformed lines
                continue
    
    return warnings

def _get_clang_tidy_version(clang_tidy_path: Path) -> str:
    """Get clang-tidy version."""
    try:
        result = subprocess.run([str(clang_tidy_path), '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip().split('\n')[0]
    except Exception:
        pass
    return "unknown"

def _get_rule_information(rule_id: str) -> dict:
    """Get information about a clang-tidy rule."""
    # This would ideally query clang-tidy documentation or a knowledge base
    # For now, return basic information based on rule patterns
    
    rule_categories = {
        'readability': 'Code readability and clarity',
        'performance': 'Performance optimizations', 
        'modernize': 'Modern C++ practices',
        'bugprone': 'Bug prevention',
        'cert': 'CERT secure coding standards',
        'cppcoreguidelines': 'C++ Core Guidelines compliance',
        'google': 'Google style guide compliance',
        'llvm': 'LLVM coding standards'
    }
    
    category = "misc"
    for cat, desc in rule_categories.items():
        if rule_id.startswith(cat + '-'):
            category = cat
            break
    
    return {
        "category": category,
        "description": f"Rule {rule_id} helps maintain {category} standards",
        "importance": f"This rule is important for {category} in C++ codebases",
        "related_concepts": [category, "C++ best practices"],
        "severity_explanation": f"This rule has standard {category} severity"
    }

def _generate_fix_strategies(rule_id: str, code_context: str) -> List[FixStrategy]:
    """Generate fix strategies for a warning."""
    # Basic strategy generation based on rule patterns
    strategies = []
    
    if 'naming' in rule_id:
        strategies.append(FixStrategy(
            name="rename_identifiers",
            description="Rename identifiers to follow naming conventions",
            implementation_steps=["Identify non-compliant names", "Rename using IDE refactoring", "Verify all references updated"],
            pros=["Improves code readability", "Follows team conventions"],
            cons=["May require updating documentation"],
            recommended=True
        ))
    
    if 'performance' in rule_id:
        strategies.append(FixStrategy(
            name="optimize_performance",
            description="Apply performance optimization",
            implementation_steps=["Analyze performance bottleneck", "Apply recommended optimization", "Measure performance impact"],
            pros=["Improves execution speed", "Reduces resource usage"],
            cons=["May increase code complexity"],
            recommended=True
        ))
    
    # Always include a manual review option
    strategies.append(FixStrategy(
        name="manual_review",
        description="Review and fix manually",
        implementation_steps=["Read warning message carefully", "Research the rule", "Apply appropriate fix"],
        pros=["Full control over fix", "Learning opportunity"],
        cons=["Takes more time", "May miss nuances"],
        recommended=False
    ))
    
    return strategies

def _generate_code_examples(rule_id: str, code_context: str) -> CodeExamples:
    """Generate before/after code examples."""
    return CodeExamples(
        problematic_code=code_context,
        fixed_code=f"// Fixed version of:\n{code_context}",
        explanation=f"This fix addresses the {rule_id} warning by improving code quality"
    )

def _analyze_code_complexity(code: str) -> str:
    """Analyze code complexity for fix recommendations."""
    lines = len(code.split('\n'))
    if lines < 10:
        return "simple"
    elif lines < 50:
        return "moderate"
    else:
        return "complex"

def _generate_contextual_strategies(warning: Warning, code: str, complexity: str) -> List[dict]:
    """Generate contextual fix strategies."""
    strategies = [
        {
            "name": "automatic_fix",
            "confidence": 0.8,
            "rationale": f"Standard fix for {warning.rule_id}",
            "steps": ["Apply clang-tidy suggested fix", "Review changes", "Test functionality"],
            "side_effects": ["May change code behavior"]
        },
        {
            "name": "manual_review",
            "confidence": 0.9,
            "rationale": "Safe approach with full control",
            "steps": ["Analyze warning context", "Research best practices", "Implement fix manually"],
            "side_effects": []
        }
    ]
    return strategies

def _select_best_strategy(strategies: List[dict], preferred: str, complexity: str) -> dict:
    """Select the best fix strategy."""
    if preferred:
        for strategy in strategies:
            if strategy["name"] == preferred:
                return strategy
    
    # Default to highest confidence strategy
    return max(strategies, key=lambda s: s["confidence"])

def _generate_alternatives(strategies: List[dict], recommended: dict) -> List[AlternativeApproach]:
    """Generate alternative approaches."""
    alternatives = []
    for strategy in strategies:
        if strategy["name"] != recommended["name"]:
            alternatives.append(AlternativeApproach(
                strategy_name=strategy["name"],
                description=strategy["rationale"],
                when_to_use="When the recommended approach is not suitable",
                complexity_rating="moderate"
            ))
    return alternatives

def _get_rule_category(rule_id: str) -> str:
    """Get category for a rule ID."""
    if '-' in rule_id:
        return rule_id.split('-')[0]
    return "misc"

def _prioritize_warnings(warnings: List[Warning]) -> List[Warning]:
    """Prioritize warnings by severity and frequency."""
    severity_order = {"error": 3, "warning": 2, "note": 1}
    return sorted(warnings, key=lambda w: severity_order.get(w.severity, 0), reverse=True)

def _generate_project_summary(files: int, warnings: int, categories: dict) -> str:
    """Generate project analysis summary."""
    return f"Analyzed {files} files and found {warnings} total issues. Top categories: {', '.join(list(categories.keys())[:3])}"

def _generate_project_recommendations(categories: dict, top_issues: List[Warning]) -> List[str]:
    """Generate project-level recommendations."""
    recommendations = []
    
    if categories.get("performance", 0) > 10:
        recommendations.append("Consider focusing on performance optimizations")
    
    if categories.get("readability", 0) > 20:
        recommendations.append("Improve code readability with naming and formatting fixes")
    
    if not recommendations:
        recommendations.append("Address highest priority warnings first")
    
    return recommendations

def _estimate_fix_time(warning_count: int) -> str:
    """Estimate time to fix warnings."""
    if warning_count < 10:
        return "1-2 hours"
    elif warning_count < 50:
        return "half day"
    elif warning_count < 100:
        return "1-2 days"
    else:
        return "several days"