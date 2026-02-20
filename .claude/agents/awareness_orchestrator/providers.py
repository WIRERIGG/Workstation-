"""
LLM Provider abstraction for Notesnook agents.

Adapted from RIGGWIRE-EA-LIVE awareness_orchestrator/providers.py.
"""

import os
from typing import Optional

from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIModel


def get_llm_model(
    provider: Optional[str] = None,
    model_name: Optional[str] = None,
    api_key: Optional[str] = None
) -> Model:
    """
    Get the configured LLM model.

    Args:
        provider: LLM provider name (anthropic, openai). Defaults to env or anthropic.
        model_name: Model identifier. Defaults to env or claude-sonnet-4-5-20250929.
        api_key: API key. Defaults to env variable.

    Returns:
        Configured Pydantic AI model instance.
    """
    provider = provider or os.getenv("NOTESNOOK_LLM_PROVIDER", "anthropic")
    model_name = model_name or os.getenv("NOTESNOOK_LLM_MODEL", "claude-sonnet-4-5-20250929")

    if provider == "anthropic":
        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        return AnthropicModel(model_name, api_key=api_key)
    elif provider == "openai":
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        return OpenAIModel(model_name, api_key=api_key)
    else:
        # Default to Anthropic
        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        return AnthropicModel(model_name, api_key=api_key)
