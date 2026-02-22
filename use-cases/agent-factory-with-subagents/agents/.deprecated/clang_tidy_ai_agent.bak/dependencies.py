"""Dependencies and context management for the Clang-Tidy AI Agent."""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any
import sqlite3
import logging
import uuid
from pathlib import Path
try:
    from .settings import ClangTidyAISettings, load_settings
except ImportError:
    from settings import ClangTidyAISettings, load_settings

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
    user_preferences: Dict[str, Any] = field(default_factory=dict)
    
    # Clang-Tidy Integration
    clang_tidy_cache: Dict[str, Any] = field(default_factory=dict)
    project_analysis_cache: Optional[Dict] = None
    
    # Performance Tracking
    analysis_stats: Dict[str, int] = field(default_factory=lambda: {
        "total_analyses": 0,
        "cache_hits": 0, 
        "warnings_fixed": 0
    })

def create_dependencies(session_id: str = None) -> ClangTidyDependencies:
    """Create and initialize agent dependencies."""
    settings = load_settings()
    
    # Initialize database
    db_connection = sqlite3.connect(settings.clang_tidy_ai_db_path)
    init_database(db_connection)
    
    # Setup logging
    logger = setup_logging(settings.clang_tidy_log_level)
    
    # Generate session ID if not provided
    if session_id is None:
        session_id = generate_session_id()
    
    # Load user preferences
    user_preferences = load_user_preferences(db_connection, session_id)
    
    return ClangTidyDependencies(
        settings=settings,
        db_connection=db_connection,
        logger=logger,
        session_id=session_id,
        user_preferences=user_preferences,
        clang_tidy_cache={},
        project_analysis_cache=None
    )

def init_database(connection: sqlite3.Connection) -> None:
    """Initialize SQLite database with required schema."""
    schema = """
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
    """
    
    connection.executescript(schema)
    connection.commit()

def setup_logging(log_level: str) -> logging.Logger:
    """Configure structured logging for the agent."""
    logger = logging.getLogger("clang_tidy_ai")
    logger.setLevel(getattr(logging, log_level.upper()))
    
    # Create handler if not exists
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    
    return logger

def load_user_preferences(connection: sqlite3.Connection, session_id: str) -> Dict[str, Any]:
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
    return str(uuid.uuid4())[:8]

def save_user_preference(
    connection: sqlite3.Connection,
    session_id: str,
    warning_type: str,
    preferred_strategy: str,
    context_tags: list[str] = None
) -> None:
    """Save user preference to database."""
    cursor = connection.cursor()
    tags_str = ",".join(context_tags) if context_tags else ""
    
    cursor.execute("""
        INSERT INTO user_preferences (session_id, warning_type, preferred_strategy, context_tags)
        VALUES (?, ?, ?, ?)
    """, (session_id, warning_type, preferred_strategy, tags_str))
    
    connection.commit()

def record_feedback(
    connection: sqlite3.Connection,
    session_id: str,
    warning_id: str,
    recommended_fix: str,
    user_action: str,
    satisfaction_rating: int = None
) -> None:
    """Record user feedback for learning system."""
    cursor = connection.cursor()
    cursor.execute("""
        INSERT INTO feedback (session_id, warning_id, recommended_fix, user_action, satisfaction_rating)
        VALUES (?, ?, ?, ?, ?)
    """, (session_id, warning_id, recommended_fix, user_action, satisfaction_rating))
    
    connection.commit()