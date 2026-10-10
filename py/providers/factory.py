from typing import Any, Dict

from .base import BaseLLMProvider
from .openai_provider import OpenAIProvider
from .anthropic_provider import AnthropicProvider


class LLMProviderFactory:
    """Factory to create appropriate LLM provider based on configuration."""

    @staticmethod
    def create(config: Dict[str, Any]) -> BaseLLMProvider:
        cfg = dict(config)
        api_type = (cfg.get("api_type") or "").strip().lower()
        base_url = (cfg.get("base_url") or "").strip().lower()
        model = (cfg.get("model") or "").strip().lower()
        name = (cfg.get("name") or "").strip().lower()

        # Determine if Anthropic
        if api_type == "anthropic" or "anthropic" in base_url or "claude" in model or "anthropic" in name:
            cfg["api_type"] = "anthropic"
            return AnthropicProvider(cfg)

        # Default: OpenAI / OpenAI-compatible
        cfg["api_type"] = "openai"
        return OpenAIProvider(cfg)
