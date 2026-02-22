"""Configuration settings for the Clang-Tidy AI Agent."""

from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from dotenv import load_dotenv
from pathlib import Path
from typing import Optional
import logging

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
    llm_model: str = Field(default="gpt-4o-mini", description="Model name to use")
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
        if not self.project_root.exists():
            raise ValueError(f"Project root directory not found at {self.project_root}")
        
        # Check for clang-tidy binary in common locations
        possible_paths = [
            self.clang_tidy_binary_path,
            Path("/usr/bin/clang-tidy"),
            Path("/usr/local/bin/clang-tidy"),
            Path("/opt/homebrew/bin/clang-tidy")
        ]
        
        clang_tidy_found = False
        for path in possible_paths:
            if path.exists():
                self.clang_tidy_binary_path = path
                clang_tidy_found = True
                break
        
        if not clang_tidy_found:
            print(f"Warning: clang-tidy binary not found. Searched in: {[str(p) for p in possible_paths]}")

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