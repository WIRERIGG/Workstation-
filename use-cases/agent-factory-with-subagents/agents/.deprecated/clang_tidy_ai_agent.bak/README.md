# 🤖 AI-Enhanced Clang-Tidy Fixer Agent

An intelligent code quality assistant that combines the power of clang-tidy static analysis with AI-powered explanations, conversational interfaces, and context-aware fix recommendations. Built with Pydantic AI for robust, type-safe interactions.

## Features

### 🧠 **AI-Enhanced Analysis**
- **Intelligent Fix Strategy Selection**: AI analyzes code context and recommends optimal fix approaches
- **Context-Aware Code Analysis**: Understands code architecture and relationships for better recommendations
- **Natural Language Explanations**: Human-readable explanations of what fixes do and why they matter
- **Conversational Interface**: Interactive dialogue about code quality and improvement strategies

### 🔧 **Comprehensive Integration**  
- **Seamless Clang-Tidy Integration**: Works with existing clang-tidy infrastructure and scripts
- **Multi-Provider LLM Support**: Compatible with OpenAI, Anthropic Claude, Google Gemini, and Ollama
- **Learning System**: Adapts recommendations based on user preferences and feedback
- **Batch Analysis**: Process multiple files with intelligent prioritization

### 📚 **Educational Focus**
- **Learning-Oriented Explanations**: Helps developers understand C++ best practices
- **Rule Category Education**: Explains readability, performance, security, and modernization concepts  
- **Code Quality Mentoring**: Acts as an experienced mentor for code improvement

## Quick Start

### Installation

1. **Clone or navigate to the agent directory**:
```bash
cd agents/clang_tidy_ai_agent
```

2. **Install dependencies**:
```bash
pip install -r requirements.txt
```

3. **Configure environment variables**:
```bash
cp .env.example .env
# Edit .env with your LLM provider API key
```

4. **Start interactive session**:
```bash
python -m cli
```

### Environment Configuration

Required environment variables in `.env`:

```env
# LLM Provider (choose one)
LLM_PROVIDER=openai
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-4o-mini

# Project Settings
PROJECT_ROOT=/IdeaProjects/wire_ground
CLANG_TIDY_BINARY_PATH=/usr/bin/clang-tidy
```

## Usage Examples

### Interactive Command Line

```bash
# Start interactive session
python -m cli

# Analyze specific file
python -m cli analyze src/main.cpp

# Analyze project files  
python -m cli project "src/**/*.cpp"

# Explain a clang-tidy rule
python -m cli explain readability-identifier-naming
```

### Programmatic Usage

```python
from clang_tidy_ai_agent import ClangTidyAI

# Context manager for session persistence
async with ClangTidyAI(session_id="my_session") as ai:
    # Analyze a file
    result = await ai.analyze_file("src/main.cpp")
    print(result)
    
    # Get warning explanation
    explanation = await ai.explain_warning(
        "readability-identifier-naming", 
        "int myVar = 42;"
    )
    print(explanation)
    
    # Get fix recommendation
    recommendation = await ai.get_fix_recommendation(
        "Variable naming doesn't follow convention",
        "int myVar = 42;\nstd::cout << myVar << std::endl;"
    )
    print(recommendation)
    
    # Conversational interaction
    response = await ai.chat("What are the most important C++ code quality practices?")
    print(response)
```

## Supported LLM Providers

### OpenAI (Recommended)
```env
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

### Anthropic Claude
```env
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-3-sonnet-20240229
```

### Google Gemini
```env
LLM_PROVIDER=gemini
LLM_API_KEY=...
LLM_MODEL=gemini-pro
```

### Ollama (Local)
```env
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=llama2
```

## Core Capabilities

### 1. Interactive File Analysis
Ask the AI to analyze specific files with educational explanations:

```
> Analyze src/main.cpp for performance issues

🤖 I'll analyze src/main.cpp focusing on performance issues...

Found 3 performance-related warnings:
1. **Line 45**: Inefficient string concatenation in loop
   - **Issue**: Using += operator for string concatenation in tight loops
   - **Impact**: O(n²) complexity due to repeated memory allocations
   - **Fix**: Use std::stringstream or reserve() capacity
   ...
```

### 2. Warning Explanations
Get detailed, educational explanations of clang-tidy rules:

```
> Explain the readability-identifier-naming warning

🤖 The readability-identifier-naming rule ensures consistent naming conventions...

**What it checks**: Variable, function, and class naming patterns
**Why it matters**: Consistent naming improves code readability and maintainability
**Common patterns**: camelCase, snake_case, PascalCase
**Best practices**: Choose one convention and apply consistently across your project
...
```

### 3. Intelligent Fix Recommendations
Get context-aware fix strategies with detailed analysis:

```
> I have a performance warning about inefficient vector operations

🤖 Let me analyze the context and recommend the best fix strategy...

**Recommended Strategy**: Reserve vector capacity
**Confidence**: 92%
**Rationale**: Based on the loop pattern and growth characteristics, pre-reserving capacity will eliminate multiple reallocations
**Implementation**:
1. Calculate expected final size
2. Call vector.reserve(expected_size) before the loop
3. Verify performance improvement with benchmarking
...
```

### 4. Project-Wide Analysis
Analyze entire projects with intelligent prioritization:

```
> Analyze all files in src/ directory

🤖 Analyzing 47 files in your project...

**Summary**: Found 156 issues across 8 categories
**Top Issues**:
- 45 readability issues (mostly naming conventions)  
- 32 performance opportunities (vector operations, string handling)
- 23 modernization suggestions (use auto, range-based loops)

**Recommendations**:
1. Start with performance issues in hot paths (src/core/*.cpp)
2. Batch fix naming conventions with automated tools
3. Gradually modernize legacy code patterns
...
```

## Advanced Features

### Learning System
The agent learns from your preferences to provide better recommendations:

```python
# The agent remembers your choices and adapts
await ai.chat("I prefer snake_case naming - remember this preference")

# Future recommendations will account for your preference
await ai.analyze_file("src/utils.cpp")  # Will favor snake_case solutions
```

### Integration with Existing Scripts
The agent can enhance your existing clang-tidy workflows:

```bash
# Enhanced version of existing scripts
./scripts/clang_tidy_fixer.sh --ai-mode  # AI-powered fix selection
./scripts/check_warnings.sh --explain    # Get AI explanations
```

### Batch Processing
Analyze multiple files efficiently:

```python
# Analyze specific file patterns
await ai.analyze_project("tests/**/*.cpp")

# Focus on specific warning categories  
await ai.analyze_project("src/**/*.cpp", ["performance-*", "cert-*"])
```

## Educational Benefits

### Code Quality Learning
- **Pattern Recognition**: Learn to identify problematic code patterns
- **Best Practice Education**: Understand why certain practices are recommended
- **Context-Aware Guidance**: Get explanations tailored to your specific code

### Mentorship Experience
- **Interactive Guidance**: Ask questions and get detailed explanations
- **Strategy Discussion**: Explore different approaches to fixing issues
- **Continuous Learning**: Build expertise through guided practice

## Integration with Existing Infrastructure

### Compatibility
- ✅ Works with existing zero-warnings build system
- ✅ Compatible with current clang-tidy scripts in `./scripts/`  
- ✅ Maintains integration with CLion and development workflow
- ✅ Respects existing git hooks and prevention systems

### Enhancement, Not Replacement
The AI agent enhances rather than replaces your existing tools:
- **Automated fixes**: Still available through traditional scripts
- **AI insights**: Added layer of intelligence and education
- **Flexible usage**: Use AI mode when you want explanation and learning
- **Traditional mode**: Continue using existing automation when appropriate

## Architecture

```
clang_tidy_ai_agent/
├── agent.py              # Main Pydantic AI agent
├── cli.py                # Interactive command-line interface  
├── tools.py              # Clang-tidy integration tools
├── models.py             # Pydantic data models
├── providers.py          # LLM provider configuration
├── dependencies.py       # Dependency injection and context
├── settings.py           # Configuration management
├── prompts.py            # System prompts
└── planning/             # Design documentation
    ├── INITIAL.md        # Requirements specification
    ├── prompts.md        # Prompt design
    ├── tools.md          # Tool specifications  
    └── dependencies.md   # Dependency configuration
```

## Performance & Security

### Performance
- **Caching**: Analysis results are cached to avoid redundant processing
- **Async Operations**: Non-blocking operations for better responsiveness  
- **Batch Processing**: Efficient analysis of multiple files
- **Smart Defaults**: Optimized for common use cases

### Security
- **API Key Protection**: Secure handling of LLM provider credentials
- **Local Processing**: Option to use Ollama for sensitive codebases
- **Data Privacy**: Code analysis can be performed locally when needed
- **Audit Trail**: Track all AI-assisted changes for compliance

## Troubleshooting

### Common Issues

**API Key not set**:
```bash
Configuration Error: llm_api_key field required
```
Solution: Set `LLM_API_KEY` in your `.env` file

**Clang-tidy not found**:
```bash
Warning: clang-tidy binary not found
```
Solution: Install clang-tidy or update `CLANG_TIDY_BINARY_PATH` in `.env`

**Import errors**:
```bash
ModuleNotFoundError: No module named 'pydantic_ai'
```
Solution: `pip install -r requirements.txt`

### Support

For issues or questions:
1. Check the planning documentation in `planning/`
2. Review example usage in `agent.py` 
3. Test with the interactive CLI: `python -m cli`

## Contributing

The agent is built with the AI Agent Factory framework and follows Pydantic AI best practices:

- **Structured Development**: All components are type-safe with Pydantic models
- **Tool-Based Architecture**: Each capability is implemented as a proper Pydantic AI tool
- **Educational Focus**: Code quality improvements with learning-oriented explanations
- **Extensible Design**: Easy to add new providers, tools, and capabilities

## License

Built as part of the AI Agent Factory framework for enhancing development workflows with intelligent, educational AI assistance.