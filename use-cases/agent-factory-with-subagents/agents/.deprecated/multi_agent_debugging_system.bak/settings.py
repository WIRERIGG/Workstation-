"""
Configuration management for Multi-Agent Debugging System.
"""

import os
from typing import Optional, List
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator, ConfigDict
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False
    )

    # LLM Configuration
    llm_provider: str = Field(default="openai")
    llm_api_key: str = Field(...)
    llm_model: str = Field(default="gpt-4")
    llm_base_url: Optional[str] = Field(default="https://api.openai.com/v1")

    # Analysis Configuration
    analysis_output_dir: str = Field(default="./debug_analysis_output")
    analysis_timeout: int = Field(default=300, description="Timeout in seconds")
    max_parallel_tools: int = Field(default=4, description="Maximum parallel tool executions")
    correlation_threshold: float = Field(default=0.7, description="Correlation confidence threshold")

    # Tool Paths
    gdb_path: str = Field(default="gdb")
    strace_path: str = Field(default="strace")
    ltrace_path: str = Field(default="ltrace")
    perf_path: str = Field(default="perf")
    cppcheck_path: str = Field(default="cppcheck")
    clang_tidy_path: str = Field(default="clang-tidy")
    valgrind_path: str = Field(default="valgrind")

    # Build Configuration
    build_dir: str = Field(default="./build")
    compiler: str = Field(default="g++")
    build_flags: List[str] = Field(default_factory=lambda: ["-g", "-O0", "-Wall"])

    # Logging
    log_level: str = Field(default="INFO")
    debug: bool = Field(default=False)

    @field_validator("llm_api_key")
    @classmethod
    def validate_api_key(cls, v):
        """Ensure API key is not empty."""
        if not v or v.strip() == "":
            raise ValueError("LLM API key cannot be empty")
        return v

    @field_validator("analysis_timeout")
    @classmethod
    def validate_timeout(cls, v):
        """Ensure timeout is reasonable."""
        if v < 30 or v > 1800:
            raise ValueError("Analysis timeout must be between 30 and 1800 seconds")
        return v


# Global settings instance
try:
    settings = Settings()
except Exception:
    # For testing, create settings with dummy values
    os.environ.setdefault("LLM_API_KEY", "test_key")
    settings = Settings()