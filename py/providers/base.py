import os
import sys
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, List, Optional


def normalize_proxy_url(proxy: Optional[str]) -> Optional[str]:
    """Ensure proxy string has a valid URL scheme for aiohttp (defaults to http://)."""
    if not proxy:
        return None
    p = str(proxy).strip()
    if not p:
        return None
    if not p.startswith(("http://", "https://", "socks5://", "socks5h://")):
        p = f"http://{p}"
    return p


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

    def is_local_url(self) -> bool:
        """Check if base_url points to a local network address (Ollama, LM Studio, etc.)."""
        url = self.base_url.lower()
        return any(h in url for h in ("localhost", "127.0.0.1", "0.0.0.0", "192.168.", "10.", ".local", ".lan"))

    def get_proxy(self) -> Optional[str]:
        """
        Resolve proxy for remote providers across Windows, macOS, and Linux.
        Automatically skips local loopback services (Ollama, LM Studio).
        """
        if self.is_local_url():
            return None

        # 1. Explicit proxy in provider config
        cfg_proxy = normalize_proxy_url(self.config.get("proxy"))
        if cfg_proxy:
            return cfg_proxy

        # 2. Environment variables (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, etc.)
        for env_var in ("https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY", "http_proxy", "HTTP_PROXY"):
            val = os.environ.get(env_var)
            if val and val.strip():
                normalized = normalize_proxy_url(val)
                if normalized:
                    return normalized

        # 3. Standard system proxy detection (urllib.request.getproxies())
        # Automatically detects macOS SystemConfiguration and Windows Registry on standard Python
        try:
            import urllib.request
            sys_proxies = urllib.request.getproxies()
            if sys_proxies:
                val = sys_proxies.get("https") or sys_proxies.get("http") or sys_proxies.get("all")
                normalized = normalize_proxy_url(val)
                if normalized:
                    return normalized
        except Exception:
            pass

        # 4. Windows Registry fallback (guarantees detection on Windows embedded/portable Python)
        if sys.platform == "win32":
            try:
                import winreg
                reg_path = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, reg_path) as key:
                    proxy_enable, _ = winreg.QueryValueEx(key, "ProxyEnable")
                    if proxy_enable:
                        proxy_server, _ = winreg.QueryValueEx(key, "ProxyServer")
                        if proxy_server:
                            raw = str(proxy_server).strip()
                            if "=" in raw:
                                p_dict = {}
                                for part in raw.split(";"):
                                    if "=" in part:
                                        proto, addr = part.split("=", 1)
                                        p_dict[proto.strip()] = addr.strip()
                                target = p_dict.get("https") or p_dict.get("http") or next(iter(p_dict.values()), None)
                                normalized = normalize_proxy_url(target)
                                if normalized:
                                    return normalized
                            else:
                                normalized = normalize_proxy_url(raw)
                                if normalized:
                                    return normalized
            except Exception:
                pass

        return None

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
