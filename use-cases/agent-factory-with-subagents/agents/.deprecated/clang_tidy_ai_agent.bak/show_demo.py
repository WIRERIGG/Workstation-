#!/usr/bin/env python3
"""Show all demo examples in sequence."""

import sys
import os

# Add the current directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

from rich.console import Console
from rich.panel import Panel
from rich.markdown import Markdown
import time

console = Console()

def demo_analysis_result():
    """Show what a typical analysis result would look like."""
    return """
## 🔍 Analysis Results for src/demo.cpp

I found **3 code quality issues** that we should address:

### 1. Performance Issue - Avoid std::endl (Line 21)
- **Problem**: Using `std::endl` instead of `'\\n'` 
- **Impact**: Unnecessary buffer flushing hurts performance in loops
- **Fix**: Replace `std::endl` with `'\\n'` for better performance
- **Rule**: `performance-avoid-endl`

### 2. Readability Issue - Magic Numbers (Line 15)  
- **Problem**: Hard-coded number `1000` without explanation
- **Impact**: Reduces code maintainability and readability
- **Fix**: Replace with a named constant like `const int MAX_ITEMS = 1000;`
- **Rule**: `readability-magic-numbers`

### 3. Modernization Issue - Default Member Initializer (Line 7)
- **Problem**: Member variable `myVar` should use default initialization
- **Impact**: More concise and clear initialization
- **Fix**: Use `int myVar{0};` instead of constructor initialization
- **Rule**: `modernize-use-default-member-init`

## 💡 **AI Recommendations**

**Priority**: Start with the **performance issue** in the output loop - this will have immediate impact.

**Next Steps**:
1. Replace `std::endl` with `'\\n'` 
2. Extract the magic number `1000` to a named constant
3. Modernize the member initialization

**Learning Opportunity**: These are common C++ patterns that improve both performance and maintainability!

Would you like me to explain any of these issues in more detail or help you implement the fixes?
"""

def demo_warning_explanation():
    """Show what a warning explanation looks like."""
    return """
## 📚 Understanding: performance-avoid-endl

### What This Rule Checks
The `performance-avoid-endl` rule detects when you use `std::endl` in performance-critical code, particularly in loops.

### Why It Matters  
- **Performance Impact**: `std::endl` not only adds a newline but also **flushes the output buffer**
- **In Loops**: This means every iteration forces a buffer flush - very expensive!
- **Better Alternative**: Use `'\\n'` which just adds a newline without flushing

### Before vs After
```cpp
// ❌ Before (slow)
for (const auto& item : dataVec) {
    std::cout << item << std::endl;  // Flushes every iteration!
}

// ✅ After (fast)  
for (const auto& item : dataVec) {
    std::cout << item << '\\n';       // Just adds newline
}
```

### Real-World Impact
- **Small datasets**: Barely noticeable
- **Large datasets**: Can be 10-100x slower!
- **Production code**: Always prefer `'\\n'` in loops

### When std::endl IS Appropriate
- End of program output
- After important messages you want immediately visible
- Debugging output where you need immediate visibility

The key is **intentional flushing** vs **accidental performance drain**!
"""

def demo_fix_recommendation():
    """Show what a fix recommendation looks like."""
    return """
## 🛠️ Fix Strategy Recommendation

### Recommended Approach: **Quick Performance Fix**
**Confidence**: 95% ⭐⭐⭐⭐⭐

### Why This Strategy?
1. **Immediate Impact**: Performance improvement visible right away
2. **Low Risk**: Simple character replacement, hard to break
3. **Learning Value**: Demonstrates important C++ performance principle
4. **Quick Win**: Builds confidence for tackling larger issues

### Implementation Plan
```cpp
// Step 1: Locate the problematic line (Line 21)
std::cout << item << std::endl;

// Step 2: Replace std::endl with '\\n'  
std::cout << item << '\\n';

// Step 3: Test to ensure output looks the same
```

### Verification Steps
1. **Compile**: `g++ -std=c++17 src/demo.cpp -o demo`
2. **Run**: `./demo` - output should look identical  
3. **Benchmark** (optional): Time the execution to see improvement

### Alternative Approaches
- **Batch approach**: Fix all performance issues at once
- **Conservative**: Fix one issue, test thoroughly, then continue
- **Comprehensive**: Address all 3 issues in a single commit

### Estimated Impact
- **Time to fix**: 30 seconds
- **Performance gain**: 5-50x faster (depending on data size)
- **Maintenance improvement**: More idiomatic C++

Ready to make this change? I can walk you through each step!
"""

def main():
    """Show all demo examples."""
    console.print(Panel.fit(
        "[bold blue]🤖 AI-Enhanced Clang-Tidy Assistant - DEMO[/bold blue]\n"
        "Intelligent code analysis with educational AI explanations",
        title="Demo Showcase"
    ))
    
    console.print("\n" + "="*70)
    console.print("[bold cyan]1. 📊 File Analysis Example[/bold cyan]")
    console.print("="*70)
    console.print(Markdown(demo_analysis_result()))
    
    console.print("\n" + "="*70)
    console.print("[bold cyan]2. 📚 Warning Explanation Example[/bold cyan]")
    console.print("="*70)
    console.print(Markdown(demo_warning_explanation()))
    
    console.print("\n" + "="*70)
    console.print("[bold cyan]3. 🛠️ Fix Recommendation Example[/bold cyan]")
    console.print("="*70)
    console.print(Markdown(demo_fix_recommendation()))
    
    console.print("\n" + "="*70)
    console.print("[bold green]🎉 Demo Complete![/bold green]")
    console.print("="*70)
    
    console.print(Panel.fit(
        "[bold yellow]Key Features Demonstrated:[/bold yellow]\n\n"
        "✅ Intelligent code analysis with clang-tidy integration\n"
        "✅ Educational explanations of code quality issues\n" 
        "✅ Context-aware fix recommendations with confidence scoring\n"
        "✅ Natural language teaching about C++ best practices\n"
        "✅ Interactive guidance for implementation steps\n\n"
        "[bold blue]To use with real LLM APIs:[/bold blue]\n"
        "1. Set LLM_API_KEY in .env file\n"
        "2. Choose provider: openai, anthropic, gemini, ollama\n" 
        "3. Run: python3 run_cli.py",
        title="✨ AI-Enhanced Clang-Tidy Agent ✨"
    ))

if __name__ == "__main__":
    main()