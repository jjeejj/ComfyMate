"""Offline regressions for model routing, chat settings and proxy testing."""
import asyncio
import importlib
import json
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, patch

from py.providers.factory import LLMProviderFactory
from py.providers import AnthropicProvider, OpenAIProvider


class ProviderRegressionTests(unittest.TestCase):
    def test_explicit_openai_protocol_wins_over_model_and_name(self):
        for model in ("anthropic/claude-sonnet", "claude-local", "gpt-test"):
            with self.subTest(model=model):
                provider = LLMProviderFactory.create({
                    "api_type": "openai", "name": "Anthropic via proxy",
                    "base_url": "https://example.com/anthropic/v1", "model": model,
                })
                self.assertIsInstance(provider, OpenAIProvider)

    def test_anthropic_and_legacy_inference_are_preserved(self):
        for config in (
            {"api_type": "anthropic", "model": "any"},
            {"base_url": "https://api.anthropic.com/v1"},
            {"model": "claude-local"},
        ):
            with self.subTest(config=config):
                self.assertIsInstance(LLMProviderFactory.create(config), AnthropicProvider)
        self.assertIsInstance(LLMProviderFactory.create({"model": "gpt-test"}), OpenAIProvider)


class ServerRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="comfymate-test-")
        # Route imports create persistent directories. Isolate them and suppress legacy migrations.
        folder_paths = types.SimpleNamespace(get_user_directory=lambda: cls.directory.name)
        with patch.dict(sys.modules, {"folder_paths": folder_paths}), patch("shutil.copy2"):
            cls.server = importlib.import_module("py.server")

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def setUp(self):
        self.config = {
            "active_provider_id": "p", "active_model": "m",
            "temperature": 0.2, "max_tokens": 8192,
            "providers": [
                {"id": "p", "models": ["m"], "base_url": "https://example.com/v1",
                 "api_type": "openai", "api_key": "saved-key", "proxy": "http://old-proxy:7890",
                 "temperature": 0.7, "max_tokens": 4096},
                {"id": "second", "models": ["other"], "base_url": "https://second.example/v1",
                 "api_type": "openai", "temperature": 1.0, "max_tokens": 2048},
            ],
        }
        self.captured = []
        captured = self.captured

        class FakeClient:
            def __init__(self, config):
                captured.append(config)

            async def stream_chat(self, messages):
                yield {"type": "content", "text": "ok"}

            async def list_models(self):
                return ["m"]

        self.load_patch = patch.object(self.server, "load_config", return_value=self.config)
        self.client_patch = patch.object(self.server, "LLMClient", FakeClient)
        self.load_patch.start()
        self.client_patch.start()
        self.addCleanup(self.load_patch.stop)
        self.addCleanup(self.client_patch.stop)

    def chat(self, model_config=None):
        request = types.SimpleNamespace(json=AsyncMock(return_value={
            "messages": [{"role": "user", "content": "hi"}], "model_config": model_config or {},
        }))

        class Response:
            def __init__(self, **kwargs):
                self.events = []

            async def prepare(self, request):
                pass

            async def write(self, data):
                self.events.append(data)

            async def write_eof(self):
                pass

        with patch.object(self.server.web, "StreamResponse", Response):
            result = asyncio.run(self.server.handle_chat(request))
        self.assertIn(b"data: [DONE]\n\n", result.events)
        return self.captured[-1]

    def test_model_override_retains_global_generation_settings(self):
        for override in ({}, {"provider_id": "p", "model": "chosen"}, {"provider_id": "second", "model": "chosen"}):
            with self.subTest(override=override):
                profile = self.chat(override)
                self.assertEqual(profile["temperature"], 0.2)
                self.assertEqual(profile["max_tokens"], 8192)
                if override:
                    self.assertEqual(profile["model"], "chosen")
                    self.assertEqual(profile["provider_id"], override["provider_id"])

    def test_provider_defaults_apply_when_global_values_are_absent(self):
        self.config.pop("temperature")
        self.config.pop("max_tokens")
        profile = self.chat({"provider_id": "second"})
        self.assertEqual((profile["temperature"], profile["max_tokens"]), (1.0, 2048))
        self.assertEqual(profile["model"], "other")

    def test_connection_proxy_missing_explicit_and_cleared(self):
        for fields, expected in (
            ({}, "http://old-proxy:7890"),
            ({"proxy": "http://new-proxy:7890"}, "http://new-proxy:7890"),
            ({"proxy": ""}, ""),
        ):
            with self.subTest(fields=fields):
                request = types.SimpleNamespace(json=AsyncMock(return_value={
                    "id": "p", "base_url": "https://example.com/v1", "fetch_models_only": True, **fields,
                }))
                response = asyncio.run(self.server.handle_test_connection(request))
                self.assertEqual(json.loads(response.body)["status"], "ok")
                self.assertEqual(self.captured[-1]["proxy"], expected)
                self.assertEqual(self.captured[-1]["api_key"], "saved-key")


if __name__ == "__main__":
    unittest.main()
