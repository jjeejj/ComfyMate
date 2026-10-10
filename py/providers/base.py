from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, List, Optional


class BaseLLMProvider(ABC):
    """Abstract base class for all LLM providers in ComfyMate."""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.provider_id = config.get("id", "default")
        self.provider_name = config.get("name", "Unknown")
        self.base_url = config.get("base_url", "").rstrip("/")
        self.api_key = config.get("api_key", "").strip()
        self.model = config.get("model", "")
        self.temperature = float(config.get("temperature", 0.7))
        self.max_tokens = int(config.get("max_tokens", 4096))
        self.api_type = config.get("api_type", "openai")

    @abstractmethod
    async def stream_chat(
        self, messages: List[Dict[str, str]]
    ) -> AsyncGenerator[Dict[str, str], None]:
        """
        Stream chat completion tokens using SSE chunking.
        Yields: {"type": "content" | "thinking" | "error", "text": str}
        """
        pass

    @abstractmethod
    async def list_models(self) -> List[str]:
        """Fetch list of available models from the provider endpoint."""
        pass
