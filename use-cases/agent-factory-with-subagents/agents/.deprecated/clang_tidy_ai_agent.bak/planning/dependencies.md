# Dependencies Configuration - AI-Enhanced Clang-Tidy Agent

## Environment Configuration with python-dotenv

The agent follows Pydantic AI best practices using `python-dotenv` and `pydantic-settings` for proper configuration management.

### Required Environment Variables

```env
# LLM Provider Configuration
LLM_PROVIDER=openai
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-4
LLM_BASE_URL=https://api.openai.com/v1

# Agent-Specific Settings
CLANG_TIDY_AI_DB_PATH=./clang_tidy_ai.db
CLANG_TIDY_BINARY_PATH=/usr/bin/clang-tidy
CLANG_TIDY_LOG_LEVEL=INFO
CLANG_TIDY_MAX_WARNINGS=100

# Integration Settings
PROJECT_ROOT=/IdeaProjects/wire_ground
ENABLE_LEARNING_MODE=true
CACHE_ANALYSIS_RESULTS=true
```

### Settings Configuration Class

```python
from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from dotenv import load_dotenv
from pathlib import Path
from typing import Optional

class ClangTidyAISettings(BaseSettings):
    """Configuration settings for the Clang-Tidy AI Agent."""
    
    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8", 
        case_sensitive=False,
        extra="ignore"
    )
    
    # LLM Configuration
    llm_provider: str = Field(default="openai", description="LLM provider (openai, anthropic, gemini, ollama)")
    llm_api_key: str = Field(..., description="API key for the LLM provider")
    llm_model: str = Field(default="gpt-4", description="Model name to use")
    llm_base_url: str = Field(default="https://api.openai.com/v1", description="Base URL for LLM API")
    
    # Agent-Specific Configuration
    clang_tidy_ai_db_path: Path = Field(default=Path("./clang_tidy_ai.db"), description="SQLite database path for learning")
    clang_tidy_binary_path: Path = Field(default=Path("/usr/bin/clang-tidy"), description="Path to clang-tidy binary")
    clang_tidy_log_level: str = Field(default="INFO", description="Logging level")
    clang_tidy_max_warnings: int = Field(default=100, description="Maximum warnings to process per file")
    
    # Integration Settings
    project_root: Path = Field(default=Path("/IdeaProjects/wire_ground"), description="Project root directory")
    enable_learning_mode: bool = Field(default=True, description="Enable preference learning")
    cache_analysis_results: bool = Field(default=True, description="Cache clang-tidy results")
    
    def validate_paths(self) -> None:
        """Validate that required paths exist and are accessible."""
        if not self.clang_tidy_binary_path.exists():
            raise ValueError(f"clang-tidy binary not found at {self.clang_tidy_binary_path}")
        if not self.project_root.exists():
            raise ValueError(f"Project root directory not found at {self.project_root}")

def load_settings() -> ClangTidyAISettings:
    """Load and validate settings with proper error handling."""
    load_dotenv()
    
    try:
        settings = ClangTidyAISettings()
        settings.validate_paths()
        return settings
    except Exception as e:
        error_msg = f"Failed to load settings: {e}"
        if "llm_api_key" in str(e).lower():
            error_msg += "\nMake sure to set LLM_API_KEY in your .env file"
        raise ValueError(error_msg) from e
```

## Dependencies Class for Agent Context

```python
from dataclasses import dataclass
from typing import Optional
import sqlite3
import logging
from pathlib import Path

@dataclass
class ClangTidyDependencies:
    """Dependencies for the Clang-Tidy AI Agent."""
    
    # Core Configuration
    settings: ClangTidyAISettings
    
    # Database Connection
    db_connection: sqlite3.Connection
    
    # Logging
    logger: logging.Logger
    
    # Session Context
    session_id: str
    user_preferences: dict[str, any]
    
    # Clang-Tidy Integration
    clang_tidy_cache: dict[str, any]
    project_analysis_cache: Optional[dict] = None
    
    # Performance Tracking
    analysis_stats: dict[str, int] = None
    
    def __post_init__(self):
        """Initialize additional dependencies after dataclass creation."""
        if self.analysis_stats is None:
            self.analysis_stats = {"total_analyses": 0, "cache_hits": 0, "warnings_fixed": 0}

def create_dependencies(session_id: str = None) -> ClangTidyDependencies:
    """Create and initialize agent dependencies."""
    settings = load_settings()
    
    # Initialize database
    db_connection = sqlite3.connect(settings.clang_tidy_ai_db_path)
    init_database(db_connection)
    
    # Setup logging
    logger = setup_logging(settings.clang_tidy_log_level)
    
    # Load user preferences
    user_preferences = load_user_preferences(db_connection, session_id)
    
    return ClangTidyDependencies(
        settings=settings,
        db_connection=db_connection,
        logger=logger,
        session_id=session_id or generate_session_id(),
        user_preferences=user_preferences,
        clang_tidy_cache={}
    )
```

## Model Provider Configuration

```python
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.gemini import GeminiProvider
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.gemini import GeminiModel

def get_llm_model(settings: ClangTidyAISettings):
    """Get configured LLM model based on provider settings."""
    
    if settings.llm_provider.lower() == "openai":
        provider = OpenAIProvider(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key
        )
        return OpenAIModel(settings.llm_model, provider=provider)
    
    elif settings.llm_provider.lower() == "anthropic":
        provider = AnthropicProvider(api_key=settings.llm_api_key)
        return AnthropicModel(settings.llm_model, provider=provider)
    
    elif settings.llm_provider.lower() == "gemini":
        provider = GeminiProvider(api_key=settings.llm_api_key)
        return GeminiModel(settings.llm_model, provider=provider)
    
    else:
        raise ValueError(f"Unsupported LLM provider: {settings.llm_provider}")
```

## Python Package Requirements

```txt
# Core Pydantic AI
pydantic-ai==0.0.14
pydantic==2.7.0
pydantic-settings==2.2.1

# Environment Management
python-dotenv==1.0.1

# Database
sqlite3
sqlalchemy==2.0.25

# Async Support
asyncio
aiofiles==23.2.1

# Logging
structlog==24.1.0

# External Tool Integration
subprocess
pathlib
glob

# LLM Providers
openai>=1.12.0
anthropic>=0.18.0
google-generativeai>=0.4.0

# Development Tools
pytest==7.4.4
pytest-asyncio==0.21.1
black==23.12.1
ruff==0.1.9
```

## Database Schema

```sql
-- User preferences and learning
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    warning_type TEXT,
    preferred_strategy TEXT,
    context_tags TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analysis results cache
CREATE TABLE IF NOT EXISTS analysis_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT,
    file_hash TEXT,
    analysis_result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_path, file_hash)
);

-- Learning feedback
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    warning_id TEXT,
    recommended_fix TEXT,
    user_action TEXT,
    satisfaction_rating INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_session ON user_preferences(session_id);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_path ON analysis_cache(file_path);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback(session_id);
```

## Initialization Functions

```python
def init_database(connection: sqlite3.Connection) -> None:
    """Initialize SQLite database with required schema."""
    with open("sql/schema.sql", "r") as f:
        schema = f.read()
    connection.executescript(schema)
    connection.commit()

def setup_logging(log_level: str) -> logging.Logger:
    """Configure structured logging for the agent."""
    import structlog
    
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer()
        ],
        wrapper_class=structlog.stdlib.LoggerClass,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    
    logger = structlog.get_logger("clang_tidy_ai")
    logger.setLevel(getattr(logging, log_level.upper()))
    return logger

def load_user_preferences(connection: sqlite3.Connection, session_id: str) -> dict:
    """Load user preferences from database."""
    cursor = connection.cursor()
    cursor.execute(
        "SELECT warning_type, preferred_strategy, context_tags FROM user_preferences WHERE session_id = ?",
        (session_id,)
    )
    preferences = {}
    for row in cursor.fetchall():
        warning_type, strategy, tags = row
        preferences[warning_type] = {
            "preferred_strategy": strategy,
            "context_tags": tags.split(",") if tags else []
        }
    return preferences

def generate_session_id() -> str:
    """Generate unique session identifier."""
    import uuid
    return str(uuid.uuid4())[:8]
```

## Integration with Existing Infrastructure

### Script Integration Points
- **./scripts/clang_tidy_fixer.sh**: Enhanced with `--ai-mode` flag
- **./scripts/check_warnings.sh**: Optional AI analysis integration
- **./scripts/post_edit_check.sh**: AI-powered review mode

### Environment Variable Bridge
The agent respects existing environment variables while adding AI-specific configuration:
- Inherits `PROJECT_ROOT` from existing infrastructure
- Uses existing clang-tidy binary path detection
- Maintains compatibility with zero-warnings build system

This dependency configuration ensures seamless integration with the existing clang-tidy infrastructure while providing the foundation for AI-enhanced capabilities using proper Pydantic AI patterns.