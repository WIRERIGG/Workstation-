"""
Settings for Awareness Orchestrator — Notesnook TypeScript/React monorepo.

Adapted from RIGGWIRE-EA-LIVE awareness_orchestrator/settings.py.
"""

from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from typing import Optional


class OrchestratorSettings(BaseSettings):
    """Configuration for the awareness orchestrator."""

    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        env_prefix="NOTESNOOK_"
    )

    # LLM Configuration
    llm_provider: str = Field(
        default="anthropic",
        description="LLM provider (anthropic, openai, etc.)"
    )
    llm_model: str = Field(
        default="claude-sonnet-4-5-20250929",
        description="Model to use for analysis"
    )
    llm_api_key: Optional[str] = Field(
        default=None,
        description="API key for the LLM provider"
    )

    # Agent Configuration
    max_concurrent_agents: int = Field(
        default=3,
        description="Max agents to run in parallel"
    )
    enable_learning: bool = Field(
        default=True,
        description="Enable pattern recognition and learning"
    )
    enable_logging: bool = Field(
        default=True,
        description="Enable detailed logging"
    )

    # Project Configuration
    project_root: str = Field(
        default=".",
        description="Path to Notesnook monorepo root"
    )
    primary_test_command: str = Field(
        default="npm run test:core",
        description="Primary test command"
    )
    lint_command: str = Field(
        default="npm run lint",
        description="Lint command"
    )

    # Packages to analyze by default
    default_packages: str = Field(
        default="core,editor,crypto,common,ui",
        description="Comma-separated list of default packages to analyze"
    )


def load_settings() -> OrchestratorSettings:
    """Load orchestrator settings."""
    try:
        return OrchestratorSettings()
    except Exception as e:
        # Return defaults if .env is missing
        return OrchestratorSettings(
            llm_provider="anthropic",
            llm_model="claude-sonnet-4-5-20250929"
        )
