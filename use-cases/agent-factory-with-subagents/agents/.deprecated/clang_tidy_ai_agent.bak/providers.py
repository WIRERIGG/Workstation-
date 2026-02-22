"""Model providers configuration for the Clang-Tidy AI Agent."""

from pydantic_ai.models import Model
try:
    from .settings import ClangTidyAISettings
except ImportError:
    from settings import ClangTidyAISettings

def get_llm_model(settings: ClangTidyAISettings) -> Model:
    """Get configured LLM model based on provider settings."""
    
    provider_name = settings.llm_provider.lower()
    
    if provider_name == "openai":
        from pydantic_ai.models.openai import OpenAIModel
        return OpenAIModel(
            model_name=settings.llm_model,
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key
        )
    
    elif provider_name == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider
        provider = AnthropicProvider(api_key=settings.llm_api_key)
        return AnthropicModel(settings.llm_model, provider=provider)
    
    elif provider_name == "gemini":
        from pydantic_ai.models.gemini import GeminiModel
        return GeminiModel(
            model_name=settings.llm_model,
            api_key=settings.llm_api_key
        )
    
    elif provider_name == "ollama":
        from pydantic_ai.models.ollama import OllamaModel
        return OllamaModel(
            model_name=settings.llm_model,
            base_url=settings.llm_base_url or "http://localhost:11434"
        )
    
    elif provider_name == "test":
        # Test mode - use TestModel for demonstration
        from pydantic_ai.models.test import TestModel
        return TestModel()
    
    else:
        raise ValueError(f"Unsupported LLM provider: {settings.llm_provider}. Supported: openai, anthropic, gemini, ollama, test")