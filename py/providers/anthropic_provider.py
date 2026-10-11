import json
import logging
from typing import Any, AsyncGenerator, Dict, List

try:
    import aiohttp
except ImportError:
    aiohttp = None

from .base import BaseLLMProvider

logger = logging.getLogger("ComfyMate.Providers.Anthropic")


class AnthropicProvider(BaseLLMProvider):
    """Provider for Anthropic Claude native Messages API protocol."""

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        }
        if self.api_key:
            headers["x-api-key"] = self.api_key
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

        if self.base_url.endswith("/v1"):
            url = f"{self.base_url}/messages"
        else:
            url = f"{self.base_url}/v1/messages"

        # Anthropic requires system prompt outside messages array
        system_prompt = ""
        anthropic_messages = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            images = m.get("images", [])
            if role == "system":
                if system_prompt:
                    system_prompt += "\n\n" + str(content)
                else:
                    system_prompt = str(content)
            elif role in ("user", "assistant"):
                if images and role == "user":
                    content_parts = []
                    for img in images:
                        if isinstance(img, str) and ";base64," in img:
                            header, b64_data = img.split(";base64,", 1)
                            media_type = header.replace("data:", "").strip() if header.startswith("data:") else "image/png"
                            content_parts.append({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": b64_data.strip(),
                                }
                            })
                    if content:
                        content_parts.append({"type": "text", "text": str(content)})
                    anthropic_messages.append({"role": role, "content": content_parts})
                else:
                    anthropic_messages.append({"role": role, "content": str(content or "")})

        if not anthropic_messages:
            anthropic_messages = [{"role": "user", "content": "Hello"}]

        # Ensure alternating user/assistant messages
        merged_messages: List[Dict[str, Any]] = []
        for m in anthropic_messages:
            if merged_messages and merged_messages[-1]["role"] == m["role"]:
                prev_c = merged_messages[-1]["content"]
                curr_c = m["content"]
                if isinstance(prev_c, str) and isinstance(curr_c, str):
                    merged_messages[-1]["content"] += "\n\n" + curr_c
                elif isinstance(prev_c, list) and isinstance(curr_c, list):
                    merged_messages[-1]["content"].extend(curr_c)
                elif isinstance(prev_c, list) and isinstance(curr_c, str):
                    merged_messages[-1]["content"].append({"type": "text", "text": curr_c})
                elif isinstance(prev_c, str) and isinstance(curr_c, list):
                    merged_messages[-1]["content"] = [{"type": "text", "text": prev_c}] + curr_c
            else:
                merged_messages.append(dict(m))

        if merged_messages and merged_messages[0]["role"] != "user":
            merged_messages.insert(0, {"role": "user", "content": "..."})

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": merged_messages,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "stream": True,
        }
        if system_prompt:
            payload["system"] = system_prompt

        timeout = aiohttp.ClientTimeout(total=180)
        proxy = self.get_proxy()
        async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
            try:
                async with session.post(
                    url, json=payload, headers=self._get_headers(), proxy=proxy
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        yield {
                            "type": "error",
                            "text": f"Anthropic API Error (HTTP {resp.status}): {error_text}",
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
                                    event_type = data_json.get("type")
                                    if event_type == "content_block_delta":
                                        delta = data_json.get("delta", {})
                                        delta_type = delta.get("type")
                                        if delta_type == "text_delta":
                                            text = delta.get("text", "")
                                            if text:
                                                yield {"type": "content", "text": text}
                                        elif delta_type == "thinking_delta":
                                            thinking = delta.get("thinking", "")
                                            if thinking:
                                                yield {"type": "thinking", "text": thinking}
                                    elif event_type == "error":
                                        err_obj = data_json.get("error", {})
                                        yield {
                                            "type": "error",
                                            "text": f"Anthropic error: {err_obj.get('message', str(err_obj))}",
                                        }
                                except json.JSONDecodeError:
                                    continue
            except aiohttp.ClientConnectorError as e:
                proxy_hint = f"\n(检测到代理: {proxy})" if proxy else "\n(未检测到代理。若访问海外服务，请开启系统代理或在终端设置 HTTP_PROXY/HTTPS_PROXY)"
                yield {
                    "type": "error",
                    "text": f"无法连接到 Anthropic 模型服务 ({self.base_url})。\n详情: {e}{proxy_hint}",
                }
            except Exception as e:
                logger.error(f"Anthropic stream error: {e}", exc_info=True)
                yield {"type": "error", "text": f"调用 Anthropic 模型异常: {str(e)}"}

    async def list_models(self) -> List[str]:
        if self.base_url.endswith("/v1"):
            url = f"{self.base_url}/models"
        else:
            url = f"{self.base_url}/v1/models"
        timeout = aiohttp.ClientTimeout(total=15)
        proxy = self.get_proxy()
        async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
            try:
                async with session.get(url, headers=self._get_headers(), proxy=proxy) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        model_list = data.get("data", [])
                        models = [m["id"] for m in model_list if isinstance(m, dict) and "id" in m]
                        if models:
                            return models
                    elif resp.status in (401, 403):
                        error_text = await resp.text()
                        raise RuntimeError(f"Anthropic 认证失败 (HTTP {resp.status}): {error_text[:200]}")
            except RuntimeError:
                raise
            except Exception as e:
                logger.warning(f"Failed to fetch models from Anthropic {url}: {e}")

        catalog = [
            "claude-3-7-sonnet-20250219",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
        ]
        if self.model and self.model not in catalog:
            return [self.model] + catalog
        return catalog
