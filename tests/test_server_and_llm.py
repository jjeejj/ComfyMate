"""
Comprehensive unit tests for ComfyMate backend (config, context, llm, server).
"""

import asyncio
import os
import sys

# Ensure repository root is in python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from py.config import load_config, save_config
from py.context import build_system_prompt, format_context_block, prepare_messages
from py.llm import LLMClient


def test_system_prompt_customization():
    prompt = build_system_prompt("Always reply in Chinese.")
    assert "ComfyMate" in prompt
    assert "Always reply in Chinese." in prompt
    print("✅ System prompt customization test passed!")


def test_config_operations():
    original = load_config()
    try:
        test_cfg = {"active_model": "test-model-v1", "active_provider_id": "ollama_default"}
        saved = save_config(test_cfg)
        assert saved["active_model"] == "test-model-v1"
        assert saved["active_provider_id"] == "ollama_default"
        assert "providers" in saved
    finally:
        save_config(original)
    print("✅ Config save & restore test passed!")


def test_llm_client_initialization():
    # 1. OpenAI / OpenAI-compatible
    client_openai = LLMClient({
        "provider": "ollama",
        "api_type": "openai",
        "base_url": "http://localhost:11434/v1",
        "api_key": "test-key",
        "model": "deepseek-r1:8b",
    })
    headers = client_openai._get_headers()
    assert headers["Authorization"] == "Bearer test-key"
    assert headers["Content-Type"] == "application/json"
    assert client_openai.api_type == "openai"

    # 2. Anthropic Claude
    client_claude = LLMClient({
        "provider": "anthropic",
        "api_type": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "api_key": "sk-ant-test123",
        "model": "claude-3-7-sonnet-20250219",
    })
    headers_claude = client_claude._get_anthropic_headers()
    assert headers_claude["x-api-key"] == "sk-ant-test123"
    assert headers_claude["anthropic-version"] == "2023-06-01"
    assert headers_claude["Content-Type"] == "application/json"
    assert client_claude.api_type == "anthropic"

    print("✅ LLM client (OpenAI & Anthropic) headers & config test passed!")


def test_llm_client_model_substitution():
    client = LLMClient({
        "base_url": "https://openrouter.ai/api/v1",
        "api_key": "test",
        "api_type": "openai",
        "model": "google/gemma-4-31b-it:free",
    })
    assert client.model == "google/gemma-4-31b-it:free"

    # Anthropic with custom model
    client_claude = LLMClient({
        "base_url": "https://api.anthropic.com/v1",
        "api_key": "test",
        "api_type": "anthropic",
        "model": "claude-3-5-haiku-20241022",
    })
    assert client_claude.model == "claude-3-5-haiku-20241022"
    print("✅ LLM client model dynamic substitution test passed!")


def test_rich_context_extraction():
    context = {
        "selected_nodes": [
            {
                "id": 10,
                "type": "ControlNetApplyAdvanced",
                "title": "Apply ControlNet Canny",
                "mode": "Active",
                "widgets_values": {"strength": 0.8, "start_percent": 0.0, "end_percent": 0.75},
                "inputs": {
                    "positive": "Connected from Node #6 [Positive Prompt] (CONDITIONING)",
                    "negative": "Connected from Node #7 [Negative Prompt] (CONDITIONING)",
                    "control_net": "Connected from Node #12 [ControlNetLoader] (CONTROL_NET)",
                },
                "outputs": {
                    "positive": "Node #3 [KSampler]",
                    "negative": "Node #3 [KSampler]",
                },
            }
        ],
        "workflow_summary": {
            "total_nodes": 15,
            "nodes_desc": [
                "Node #4 [CheckpointLoaderSimple]",
                "Node #10 [ControlNetApplyAdvanced] inputs: [positive<-#6, negative<-#7, control_net<-#12]",
            ],
        },
        "error_info": None,
    }

    formatted = format_context_block(context)
    assert "Node #10 [Apply ControlNet Canny]" in formatted
    assert "Upstream Inputs" in formatted
    assert "Downstream Outputs" in formatted
    assert "strength" in formatted

    msgs = prepare_messages([{"role": "user", "content": "这个节点输入输出分别接什么？"}], context=context)
    assert len(msgs) == 2
    assert "Apply ControlNet Canny" in msgs[1]["content"]
    print("✅ Rich context bidirectional links test passed!")


def test_attachment_storage_and_resolution():
    import base64
    from py.server import ATTACHMENTS_DIR, resolve_attachment_to_base64

    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "test_img_12345.png"
    test_file_path = ATTACHMENTS_DIR / test_filename

    # 1x1 transparent PNG bytes
    png_bytes = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    with open(test_file_path, "wb") as f:
        f.write(png_bytes)

    try:
        # Test resolving local attachment URL
        local_url = f"/comfymate/api/attachment/{test_filename}"
        resolved = resolve_attachment_to_base64(local_url)
        assert resolved.startswith("data:image/png;base64,")
        assert "iVBORw0KGgoAAAANSUhEUgAAAAE" in resolved

        # Test resolving standard data URL (should pass through untouched)
        raw_data_url = "data:image/jpeg;base64,12345"
        assert resolve_attachment_to_base64(raw_data_url) == raw_data_url

        print("✅ Local attachment storage & base64 resolution test passed!")
    finally:
        if test_file_path.is_file():
            test_file_path.unlink()


def test_session_persistence():
    from py.sessions import (
        save_session,
        get_session,
        list_sessions,
        delete_session,
        sanitize_session_id,
    )

    # 1. Sanitize checks
    assert sanitize_session_id("../../etc/passwd") == "etcpasswd"
    assert sanitize_session_id("sess_123_abc-45") == "sess_123_abc-45"
    assert sanitize_session_id("") is None

    # 2. Save a session
    sess = save_session({
        "id": "test_sess_001",
        "title": "测试文生图工作流",
        "workflow_name": "video_minimax_h3_i2v",
        "messages": [
            {"role": "user", "content": "帮我看看这个工作流"},
            {"role": "assistant", "content": "好的，这个工作流是标准的SDXL文生图。"},
        ],
    })
    assert sess["id"] == "test_sess_001"
    assert sess["title"] == "测试文生图工作流"
    assert sess.get("workflow_name") == "video_minimax_h3_i2v"
    assert len(sess["messages"]) == 2

    try:
        # 3. Retrieve session
        loaded = get_session("test_sess_001")
        assert loaded is not None
        assert loaded["id"] == "test_sess_001"
        assert loaded["title"] == "测试文生图工作流"
        assert loaded.get("workflow_name") == "video_minimax_h3_i2v"
        assert len(loaded["messages"]) == 2

        # 4. List sessions
        sessions = list_sessions()
        assert any(s["id"] == "test_sess_001" for s in sessions)
        matched = next(s for s in sessions if s["id"] == "test_sess_001")
        assert matched["message_count"] == 2
        assert matched.get("workflow_name") == "video_minimax_h3_i2v"

        # 5. Auto-title derivation when title not provided
        sess2 = save_session({
            "id": "test_sess_002",
            "messages": [
                {"role": "user", "content": "KSampler报错原因是什么？\n详细分析一下"},
            ],
        })
        assert sess2["title"] == "KSampler报错原因是什么？"
        delete_session("test_sess_002")

        print("✅ Conversation session persistence test passed!")
    finally:
        delete_session("test_sess_001")


if __name__ == "__main__":
    test_system_prompt_customization()
    test_config_operations()
    test_llm_client_initialization()
    test_llm_client_model_substitution()
    test_rich_context_extraction()
    test_attachment_storage_and_resolution()
    test_session_persistence()


