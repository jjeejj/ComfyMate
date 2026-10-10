import json
import logging
from typing import Any, AsyncGenerator, Dict, List

try:
    import aiohttp
except ImportError:
    aiohttp = None

from .base import BaseLLMProvider

logger = logging.getLogger("ComfyMate.Providers.OpenAI")


class OpenAIProvider(BaseLLMProvider):
    """Provider for official OpenAI and OpenAI-compatible endpoints (Ollama, LM Studio, DeepSeek, etc.)."""

    def _get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def stream_chat(
        self, messages: List[Dict[str, str]]
    ) -> AsyncGenerator[Dict[str, str], None]:
        if aiohttp is None:
            yield {
                "type": "error",
                "text": "aiohttp 模块未安装。在标准 ComfyUI 环境中此模块默认自带；如果在独立环境测试，请运行 pip install aiohttp。",
            }
            return

        url = f"{self.base_url}/chat/completions"

        formatted_messages = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            images = m.get("images", [])
            if images and role == "user":
                content_parts = []
                if content:
                    content_parts.append({"type": "text", "text": str(content)})
                for img in images:
                    if isinstance(img, str) and img.strip():
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {"url": img.strip()}
                        })
                formatted_messages.append({"role": role, "content": content_parts})
            else:
                formatted_messages.append({"role": role, "content": content})

        payload = {
            "model": self.model,
            "messages": formatted_messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": True,
        }

        timeout = aiohttp.ClientTimeout(total=180)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            try:
                async with session.post(
                    url, json=payload, headers=self._get_headers()
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        try:
                            err_json = json.loads(error_text)
                            if "error" in err_json:
                                err_obj = err_json["error"]
                                if isinstance(err_obj, dict):
                                    msg = err_obj.get("message") or ""
                                    if "metadata" in err_obj and isinstance(err_obj["metadata"], dict):
                                        raw_msg = err_obj["metadata"].get("raw")
                                        if raw_msg and raw_msg != msg:
                                            msg = f"{msg}\n{raw_msg}" if msg else raw_msg
                                    error_text = msg or error_text
                                elif isinstance(err_obj, str):
                                    error_text = err_obj
                        except Exception:
                            pass
                        yield {
                            "type": "error",
                            "text": f"模型服务返回错误 (HTTP {resp.status}):\n{error_text}",
                        }
                        return

                    buffer = ""
                    async for line in resp.content:
                        line_str = line.decode("utf-8", errors="replace")
                        buffer += line_str
                        while "\n" in buffer:
                            chunk_line, buffer = buffer.split("\n", 1)
                            chunk_line = chunk_line.strip()
                            if not chunk_line:
                                continue
                            if chunk_line.startswith("data: "):
                                data_str = chunk_line[6:].strip()
                                if data_str == "[DONE]":
                                    return
                                try:
                                    data_json = json.loads(data_str)
                                    choices = data_json.get("choices", [])
                                    if choices:
                                        delta = choices[0].get("delta", {})

                                        # Handle reasoning/thinking content (e.g. DeepSeek-R1, Ollama)
                                        reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                                        if reasoning:
                                            yield {"type": "thinking", "text": reasoning}

                                        # Regular content
                                        content = delta.get("content", "")
                                        if content:
                                            yield {"type": "content", "text": content}
                                except json.JSONDecodeError:
                                    continue
            except aiohttp.ClientConnectorError as e:
                yield {
                    "type": "error",
                    "text": f"无法连接到模型服务 ({self.base_url})。请检查本地模型服务或代理是否已启动。\n详情: {e}",
                }
            except Exception as e:
                logger.error(f"OpenAI stream error: {e}", exc_info=True)
                yield {"type": "error", "text": f"调用大模型异常: {str(e)}"}

    async def list_models(self) -> List[str]:
        if aiohttp is None:
            raise RuntimeError("aiohttp library is required to fetch models.")
        url = f"{self.base_url}/models"
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            try:
                async with session.get(url, headers=self._get_headers()) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        model_list = data.get("data", [])
                        models = []
                        for m in model_list:
                            if isinstance(m, dict) and "id" in m:
                                models.append(m["id"])
                            elif isinstance(m, str):
                                models.append(m)
                        return models
                    else:
                        error_text = await resp.text()
                        raise RuntimeError(f"HTTP {resp.status}: {error_text[:200]}")
            except Exception as e:
                logger.warning(f"Failed to fetch models from {url}: {e}")
                raise e
