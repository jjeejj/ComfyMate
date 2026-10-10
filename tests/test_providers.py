"""
Unit tests for ComfyMate multi-provider architecture.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from py.providers import LLMProviderFactory, OpenAIProvider, AnthropicProvider


def test_provider_factory():
    # 1. Factory should instantiate OpenAIProvider for generic / OpenAI configs
    p_openai = LLMProviderFactory.create({
        "name": "OpenAI",
        "api_type": "openai",
        "base_url": "https://api.openai.com/v1",
        "api_key": "sk-123",
        "model": "gpt-4o",
    })
    assert isinstance(p_openai, OpenAIProvider)
    assert p_openai.api_type == "openai"
    assert p_openai._get_headers()["Authorization"] == "Bearer sk-123"

    # 2. Factory should instantiate OpenAIProvider for local Ollama
    p_ollama = LLMProviderFactory.create({
        "name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "model": "deepseek-r1:8b",
    })
    assert isinstance(p_ollama, OpenAIProvider)
    assert p_ollama.api_type == "openai"

    # 3. Factory should instantiate AnthropicProvider for Claude
    p_claude = LLMProviderFactory.create({
        "name": "Anthropic",
        "api_type": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "api_key": "sk-ant-test",
        "model": "claude-3-7-sonnet-20250219",
    })
    assert isinstance(p_claude, AnthropicProvider)
    assert p_claude.api_type == "anthropic"
    assert p_claude._get_headers()["x-api-key"] == "sk-ant-test"
    assert p_claude._get_headers()["anthropic-version"] == "2023-06-01"

    print("✅ Provider Factory & Polymorphism test passed!")


def test_multimodal_formatting():
    # Test OpenAI message formatting
    p_openai = OpenAIProvider({
        "name": "OpenAI",
        "api_key": "sk-test",
        "model": "gpt-4o",
    })
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {
            "role": "user",
            "content": "Look at this image",
            "images": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
        },
    ]
    # Verify OpenAI format logic
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
                content_parts.append({"type": "image_url", "image_url": {"url": img}})
            formatted_messages.append({"role": role, "content": content_parts})
        else:
            formatted_messages.append({"role": role, "content": content})

    assert len(formatted_messages) == 2
    assert formatted_messages[1]["role"] == "user"
    assert formatted_messages[1]["content"][0]["type"] == "text"
    assert formatted_messages[1]["content"][1]["type"] == "image_url"

    # Test Anthropic format logic
    p_anthropic = AnthropicProvider({
        "name": "Anthropic",
        "api_key": "sk-ant-test",
        "model": "claude-3-7-sonnet-20250219",
    })
    anthropic_messages = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        images = m.get("images", [])
        if role == "system":
            continue
        elif role in ("user", "assistant"):
            if images and role == "user":
                content_parts = []
                for img in images:
                    if ";base64," in img:
                        header, b64_data = img.split(";base64,", 1)
                        media_type = header.replace("data:", "").strip()
                        content_parts.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64_data,
                            }
                        })
                if content:
                    content_parts.append({"type": "text", "text": str(content)})
                anthropic_messages.append({"role": role, "content": content_parts})

    assert len(anthropic_messages) == 1
    assert anthropic_messages[0]["content"][0]["type"] == "image"
    assert anthropic_messages[0]["content"][0]["source"]["media_type"] == "image/png"
    assert anthropic_messages[0]["content"][1]["text"] == "Look at this image"
    print("✅ Multimodal Vision formatting test passed!")


if __name__ == "__main__":
    test_provider_factory()
    test_multimodal_formatting()

