import logging
from typing import Any, AsyncGenerator, Dict, List

from .providers import BaseLLMProvider, LLMProviderFactory

logger = logging.getLogger("ComfyMate.LLM")


class LLMClient:
    """
    Unified client facade for ComfyMate.
    Delegates to specialized provider implementations (OpenAI, Anthropic, etc.).
    """

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.provider: BaseLLMProvider = LLMProviderFactory.create(config)
        self.api_type = self.provider.api_type
        self.base_url = self.provider.base_url
        self.api_key = self.provider.api_key
        self.model = self.provider.model
        self.temperature = self.provider.temperature
        self.max_tokens = self.provider.max_tokens

    def _get_headers(self) -> Dict[str, str]:
        """Backward-compatible header getter."""
        if hasattr(self.provider, "_get_headers"):
            return self.provider._get_headers()
        return {}

    def _get_anthropic_headers(self) -> Dict[str, str]:
        """Backward-compatible Anthropic header getter."""
        if hasattr(self.provider, "_get_headers") and self.api_type == "anthropic":
            return self.provider._get_headers()
        return {}

    async def stream_chat(
        self, messages: List[Dict[str, str]]
    ) -> AsyncGenerator[Dict[str, str], None]:
        async for chunk in self.provider.stream_chat(messages):
            yield chunk

    async def list_models(self) -> List[str]:
        return await self.provider.list_models()
