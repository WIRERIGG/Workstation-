# Agent References
## Production Agents Used by Factory

**Last Updated**: 2025-09-30

This file documents which production agents from `.claude/agents/` are referenced by the agent factory. All agents listed here are the **authoritative implementations** and should be used instead of creating duplicates.

---

## 🚨 IMPORTANT: No Duplicates Policy

**The agent factory MUST NOT contain duplicate implementations** of agents that already exist in `.claude/agents/`. Instead:

1. **Reference** production agents by path
2. **Import** production agents as dependencies
3. **Extend** production agents with factory-specific wrappers if needed
4. **NEVER** copy production agents into factory directory

---

## 📋 Production Agent Registry

### Static Analysis Agents

#### 1. Clang-Tidy AI Agent
**Location**: `/.claude/agents/clang_tidy_ai_agent/`
**Capabilities**: Comprehensive C++ static analysis with 8 specialized subagents
**Use Instead Of**: ~~`agents/clang_tidy_ai_agent/`~~ (removed duplicate)
**Documentation**: `/.claude/agents/clang_tidy_ai_agent/README.md`
**CLI**: `python -m claude.agents.clang_tidy_ai_agent.cli`

**Subagents**:
- clang-tidy-analyzer
- clang-tidy-critical-fixer
- clang-tidy-safety-fixer
- clang-tidy-quality-fixer
- clang-tidy-strategist
- clang-tidy-validator
- clang-tidy-fixer
- zero-warnings-enforcer

**Integration Example**:
```python
# Factory agent should import, not duplicate
from claude.agents.clang_tidy_ai_agent import ClangTidyAI

async with ClangTidyAI() as agent:
    result = await agent.analyze_file("src/code.cpp")
```

---

### Dynamic Analysis Agents

#### 2. Multi-Agent Debugging System
**Location**: `/.claude/agents/multi_agent_debugging_system/`
**Capabilities**: 7-tool orchestrated debugging (gdb, strace, ltrace, perf, cppcheck, clang-tidy, valgrind)
**Use Instead Of**: ~~`agents/multi_agent_debugging_system/`~~ (removed duplicate)
**Documentation**: `/.claude/agents/multi_agent_debugging_system/README.md`
**CLI**: `python -m claude.agents.multi_agent_debugging_system.cli`

**Tool Agents**:
- GDB Agent
- Strace Agent
- Ltrace Agent
- Perf Agent
- Cppcheck Agent
- Clang-Tidy Agent
- Valgrind Agent

**Integration Example**:
```python
from claude.agents.multi_agent_debugging_system import analyze_cpp_code

result = await analyze_cpp_code(
    target_path="binary",
    analysis_mode="comprehensive"
)
```

---

#### 3. Valgrind Pydantic Tool
**Location**: `/.claude/agents/valgrind_pydantic_tool/`
**Capabilities**: Full Valgrind suite with AI integration
**Documentation**: `/.claude/agents/valgrind_pydantic_tool/IMPLEMENTATION_COMPLETE.md`

**Valgrind Tools**:
- Memcheck (memory leaks)
- Helgrind (thread safety)
- Cachegrind (cache profiling)
- Callgrind (call graphs)
- Massif (heap profiling)
- DRD (data races)
- Exp-bbv (basic blocks)

**Integration Example**:
```python
from claude.agents.valgrind_pydantic_tool import ValgrindAnalyzer

analyzer = ValgrindAnalyzer()
result = analyzer("./binary", ai_analyze=True)
```

---

### Performance Optimization Agents

#### 4. BLITZFIRE Performance Optimizer
**Location**: `/.claude/agents/blitzfire_cpp_optimizer/`
**Capabilities**: Performance optimization (I/O, SIMD, memory patterns)
**Documentation**: `/.claude/agents/blitzfire_cpp_optimizer/README.md`
**Note**: Consolidated from 3 BLITZFIRE agents

**Optimization Categories**:
- Buffered I/O (10-100x speedup)
- SIMD vectorization
- Memory access patterns
- Algorithm complexity

---

### Build & Resolution Agents

#### 5. Never-Fail Build Resolver
**Location**: `/.claude/agents/never_fail_build_resolver/`
**Capabilities**: Systematic build problem resolution
**Documentation**: `/.claude/agents/never_fail_build_resolver/README.md`

**Features**:
- Automatic build error detection
- Multi-layer error analysis
- Learning from failures
- Guaranteed resolution

---

### Meta-Orchestration

#### 6. Awareness Orchestrator
**Location**: `/.claude/agents/awareness_orchestrator/`
**Capabilities**: Meta-orchestration across all agents
**Documentation**: `/.claude/agents/awareness_orchestrator/COMPLETE_THREE_PHASE_SUMMARY.md`

**Components** (9):
1. Context Chaining System
2. Validation Pipeline
3. Learning Database
4. Build System Adapter
5. Prompt Templates
6. Progress Reporter
7. Pattern Recognition
8. Proactive Suggestions
9. Metrics Dashboard

**Integration Example**:
```python
from claude.agents.awareness_orchestrator import AwarenessOrchestrator

orchestrator = AwarenessOrchestrator()
result = orchestrator.orchestrate_workflow("target.cpp")
```

---

## 🏭 Factory-Specific Agents (Unique to Factory)

These agents are **unique** to the factory and don't duplicate production agents:

### 1. CPP Project Organizer
**Location**: `agents/cpp_project_organizer/`
**Purpose**: C++ project structure management
**Status**: ✅ Unique (no production equivalent)

### 2. RAG Agent
**Location**: `agents/rag_agent/`
**Purpose**: RAG/knowledge base operations
**Status**: ✅ Unique (no production equivalent)

---

## 📜 Script Utilities (For Reference)

### Active Scripts
- `scripts/cpp_phd_agent.py` - C++ expert advisory (unique)
- `scripts/claude_passive_analysis_agent.py` - Background monitoring (unique)
- `scripts/test_cpp_agent.py` - Testing utility (unique)

### Deprecated Scripts (Use Production Agents Instead)
- ~~`scripts/intelligent_clang_tidy_agent.py`~~ → Use `clang_tidy_ai_agent`
- ~~`scripts/blitzfire_agent.py`~~ → Use `blitzfire_cpp_optimizer`

---

## 🔗 Import Patterns

### Correct Import Pattern (Factory → Production)
```python
# ✅ CORRECT: Import from production
from claude.agents.clang_tidy_ai_agent import ClangTidyAI
from claude.agents.multi_agent_debugging_system import analyze_cpp_code
from claude.agents.awareness_orchestrator import AwarenessOrchestrator
```

### Incorrect Pattern (Duplicating)
```python
# ❌ WRONG: Don't duplicate production agents
# This creates maintenance burden and version conflicts
from agents.clang_tidy_ai_agent import ClangTidyAI  # DON'T DO THIS
```

---

## 🚀 Adding New Agents to Factory

When adding a new agent to the factory, follow this checklist:

### Pre-Creation Checklist
- [ ] Check if similar agent exists in `.claude/agents/`
- [ ] Check if similar agent exists in `scripts/`
- [ ] Review capability overlap with existing agents
- [ ] Verify this is truly unique functionality

### If Similar Agent Exists
- [ ] **DO NOT** create duplicate
- [ ] Import existing agent instead
- [ ] Add wrapper if factory-specific logic needed
- [ ] Document in this AGENT_REFERENCE.md

### If Truly Unique
- [ ] Document why it's unique
- [ ] Create in `agents/[new_agent_name]/`
- [ ] Add to "Factory-Specific Agents" section above
- [ ] Consider if it should eventually move to production

---

## 📊 Agent Capability Matrix

| Agent | Static | Dynamic | Performance | Build | AI | Orchestration |
|-------|--------|---------|-------------|-------|-----|---------------|
| clang_tidy_ai_agent | ✅✅✅ | ❌ | ⚡ | ❌ | ✅ | 8 subagents |
| multi_agent_debugging | ✅ | ✅✅✅ | ✅ | ❌ | ✅ | 7 tools |
| valgrind_pydantic_tool | ❌ | ✅✅✅ | ✅ | ❌ | ✅ | Single |
| blitzfire_optimizer | ⚡ | ⚡ | ✅✅✅ | ❌ | ✅ | Single |
| never_fail_resolver | ⚡ | ⚡ | ❌ | ✅✅✅ | ✅ | Single |
| awareness_orchestrator | ⚡ | ⚡ | ⚡ | ⚡ | ✅ | ✅✅✅ |
| cpp_project_organizer | ❌ | ❌ | ❌ | ⚡ | ⚡ | Single |
| rag_agent | ❌ | ❌ | ❌ | ❌ | ✅ | Single |

**No capability overlaps!** Each agent has unique primary focus.

---

## 🔧 Maintenance

### When Production Agent Updates
1. Factory automatically benefits (imports production version)
2. No need to sync duplicates (no duplicates exist!)
3. Check if factory wrappers need updates

### When Deprecating Production Agent
1. Update this reference document
2. Update factory imports
3. Add migration guide

### Annual Review
- Review this document annually
- Verify all references are current
- Check for new production agents to integrate
- Identify factory agents that should move to production

---

## 📞 Questions?

- **Agent duplicates?** Check this file first before creating
- **Need new capability?** Check production agents first
- **Integration help?** See examples above
- **Still unsure?** Review `.claude/agents/AGENT_CONSOLIDATION_ANALYSIS.md`

---

**Maintained By**: Wire Ground Agent Team
**Last Audit**: 2025-09-30
**Next Audit Due**: 2026-09-30