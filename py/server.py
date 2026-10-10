import asyncio
import base64
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

try:
    from aiohttp import web
except ImportError:
    web = None

from .config import load_config, save_config, get_active_provider_and_model
from .context import prepare_messages
from .llm import LLMClient
from .sessions import (
    list_sessions,
    get_session,
    save_session,
    delete_session,
)

logger = logging.getLogger("ComfyMate")


def get_attachments_dir() -> Path:
    """Return persistent attachments directory.
    Uses ComfyUI's user directory if available, so attachments survive node updates.
    """
    local_dir = Path(__file__).resolve().parent.parent / "storage" / "attachments"
    try:
        import folder_paths
        user_dir = Path(folder_paths.get_user_directory())
        target = user_dir / "comfymate" / "attachments"
        target.mkdir(parents=True, exist_ok=True)
        return target
    except Exception:
        local_dir.mkdir(parents=True, exist_ok=True)
        return local_dir


ATTACHMENTS_DIR = get_attachments_dir()
MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB limit

# Try to get ComfyUI's PromptServer instance
try:
    import server
    prompt_server = server.PromptServer.instance
    app = prompt_server.app
except Exception:
    logger.warning("ComfyUI server.PromptServer instance not found. Running in standalone mode.")
    app = None


def _mask_config(cfg: dict) -> dict:
    """Return a deep copy of config with all provider API keys safely masked."""
    safe_cfg = json.loads(json.dumps(cfg))
    for p in safe_cfg.get("providers", []):
        if p.get("api_key"):
            key = str(p["api_key"])
            if len(key) > 8:
                p["api_key_masked"] = key[:4] + "..." + key[-4:]
            else:
                p["api_key_masked"] = "********"
            p["api_key"] = ""
    return safe_cfg


def _detect_image_extension(content: bytes) -> Optional[str]:
    """Detect valid image extension based on magic header bytes."""
    if len(content) < 8:
        return None
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"GIF87a") or content.startswith(b"GIF89a"):
        return ".gif"
    if content.startswith(b"RIFF") and len(content) >= 12 and content[8:12] == b"WEBP":
        return ".webp"
    if content.startswith(b"BM"):
        return ".bmp"
    return None


async def handle_get_config(request: web.Request) -> web.Response:
    """Return current configuration with masked keys for security."""
    try:
        cfg = load_config()
        return web.json_response({"status": "ok", "config": _mask_config(cfg)})
    except Exception as e:
        logger.error(f"Error getting config: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def handle_save_config(request: web.Request) -> web.Response:
    """Save new configuration."""
    try:
        data = await request.json()
        saved = save_config(data)
        return web.json_response({"status": "ok", "config": _mask_config(saved)})
    except Exception as e:
        logger.error(f"Error saving config: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=400)


async def handle_test_connection(request: web.Request) -> web.Response:
    """Test connection to the specified or configured LLM endpoint and verify model/fetch models."""
    try:
        data = await request.json()
        base_url = data.get("base_url", "").strip()
        api_key = data.get("api_key", "").strip()
        api_type = data.get("api_type", "").strip()
        fetch_models_only = bool(data.get("fetch_models_only", False))

        # Model to test
        model = data.get("model", "").strip()
        if not model:
            models = data.get("models", [])
            if isinstance(models, list) and models:
                model = str(models[0]).strip()

        # If test request didn't supply key or sent masked, find in saved config
        if not api_key or "..." in api_key or "********" in api_key:
            provider_id = data.get("id")
            cfg = load_config()
            for p in cfg.get("providers", []):
                if p.get("id") == provider_id or p.get("base_url") == base_url:
                    api_key = p.get("api_key", "")
                    if not api_type:
                        api_type = p.get("api_type", "")
                    if not model and p.get("models"):
                        model = str(p["models"][0]).strip()
                    break

        if not api_type:
            api_type = "anthropic" if "anthropic" in base_url.lower() else "openai"

        client = LLMClient({
            "base_url": base_url,
            "api_key": api_key,
            "api_type": api_type,
            "model": model,
            "max_tokens": 5,
        })

        # Case 1: If caller requested fetching available models list explicitly
        if fetch_models_only:
            fetched_models = await client.list_models()
            return web.json_response({
                "status": "ok",
                "code": "models_fetched",
                "message": f"成功从服务拉取到 {len(fetched_models)} 个可用模型。",
                "models": fetched_models,
            })

        # Case 2: Test connection with the specified model
        if model and model != "default":
            test_messages = [{"role": "user", "content": "hi"}]

            async def _do_test_chat():
                async for event in client.stream_chat(test_messages):
                    return event
                return None

            try:
                first_event = await asyncio.wait_for(_do_test_chat(), timeout=20.0)
            except asyncio.TimeoutError:
                return web.json_response({
                    "status": "error",
                    "code": "timeout",
                    "message": f"模型 [{model}] 连接测试超时 (超过 20 秒未响应)",
                    "model": model,
                }, status=504)
            except Exception as stream_err:
                return web.json_response({
                    "status": "error",
                    "code": "stream_error",
                    "message": f"模型 [{model}] 连接测试失败: {str(stream_err)}",
                    "model": model,
                }, status=400)

            if first_event and first_event.get("type") == "error":
                return web.json_response({
                    "status": "error",
                    "code": "test_fail",
                    "message": f"模型 [{model}] 测试失败:\n{first_event.get('text', '未知错误')}",
                    "model": model,
                }, status=400)

            return web.json_response({
                "status": "ok",
                "code": "model_responded",
                "message": f"连接成功！模型 [{model}] 响应正常。",
                "model": model,
            })

        # Case 3: No specific model provided, test connection via list_models
        fetched_models = await client.list_models()
        return web.json_response({
            "status": "ok",
            "code": "models_fetched",
            "message": f"端点连接成功！从服务拉取到 {len(fetched_models)} 个可用模型。",
            "models": fetched_models,
        })
    except Exception as e:
        return web.json_response({
            "status": "error",
            "code": "connect_error",
            "message": f"连接失败: {str(e)}",
        }, status=500)


def resolve_attachment_to_base64(img_ref: str) -> str:
    """If img_ref is a local attachment URL (/comfymate/api/attachment/xxx), read it from disk and return data URL."""
    if isinstance(img_ref, str) and img_ref.startswith("/comfymate/api/attachment/"):
        filename = Path(img_ref).name
        file_path = ATTACHMENTS_DIR / filename
        if file_path.is_file():
            try:
                ext = file_path.suffix.lower()
                mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "application/octet-stream"
                with open(file_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                return f"data:{mime};base64,{b64}"
            except Exception as e:
                logger.warning(f"Failed to read attachment {file_path}: {e}")
    return img_ref


async def handle_upload_attachment(request: web.Request) -> web.Response:
    """Handle uploading an image attachment and save to local storage with strict validation."""
    try:
        content_length = request.content_length or 0
        if content_length > MAX_UPLOAD_SIZE:
            return web.json_response({"status": "error", "message": "Attachment exceeds 20MB size limit"}, status=400)

        content_type = request.content_type or ""
        file_bytes = b""
        orig_name = "pasted_image.png"

        if "application/json" in content_type:
            data = await request.json()
            raw_data = data.get("data", "")
            orig_name = data.get("filename", "pasted_image.png")
            if ";base64," in raw_data:
                _header, b64_str = raw_data.split(";base64,", 1)
                file_bytes = base64.b64decode(b64_str)
            else:
                file_bytes = base64.b64decode(raw_data)
        elif "multipart" in content_type:
            reader = await request.multipart()
            while True:
                part = await reader.next()
                if part is None:
                    break
                if part.name == "file":
                    orig_name = part.filename or "uploaded_file.png"
                    # Read in chunks with size limit check
                    chunks = []
                    bytes_read = 0
                    while True:
                        chunk = await part.read_chunk(65536)
                        if not chunk:
                            break
                        bytes_read += len(chunk)
                        if bytes_read > MAX_UPLOAD_SIZE:
                            return web.json_response({"status": "error", "message": "Attachment exceeds 20MB size limit"}, status=400)
                        chunks.append(chunk)
                    file_bytes = b"".join(chunks)
                    break

        if not file_bytes:
            return web.json_response({"status": "error", "message": "No file content received"}, status=400)

        if len(file_bytes) > MAX_UPLOAD_SIZE:
            return web.json_response({"status": "error", "message": "Attachment exceeds 20MB size limit"}, status=400)

        # Validate that the file is actually a valid image format via magic bytes
        detected_ext = _detect_image_extension(file_bytes)
        if not detected_ext:
            return web.json_response({"status": "error", "message": "Unsupported file format. Only JPEG, PNG, WEBP, GIF, and BMP are allowed."}, status=400)

        ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
        safe_stem = Path(orig_name).stem.replace(" ", "_")[:30]
        if not safe_stem:
            safe_stem = "image"

        unique_id = uuid.uuid4().hex[:10]
        saved_filename = f"{unique_id}_{safe_stem}{detected_ext}"
        target_path = ATTACHMENTS_DIR / saved_filename

        with open(target_path, "wb") as f:
            f.write(file_bytes)

        file_url = f"/comfymate/api/attachment/{saved_filename}"
        return web.json_response({
            "status": "ok",
            "filename": saved_filename,
            "url": file_url,
            "size": len(file_bytes),
        })
    except Exception as e:
        logger.error(f"Error saving attachment: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def handle_get_attachment(request: web.Request) -> web.Response:
    """Serve a locally stored attachment using streaming FileResponse."""
    try:
        filename = request.match_info.get("filename", "")
        safe_filename = Path(filename).name
        file_path = ATTACHMENTS_DIR / safe_filename

        if not file_path.is_file():
            return web.Response(status=404, text="Attachment not found")

        return web.FileResponse(
            path=file_path,
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        )
    except Exception as e:
        logger.error(f"Error serving attachment: {e}", exc_info=True)
        return web.Response(status=500, text=str(e))


async def handle_chat(request: web.Request) -> web.StreamResponse:
    """Handle chat request with SSE streaming."""
    try:
        data = await request.json()
        messages = data.get("messages", [])
        context = data.get("context", None)
        model_override = data.get("model_config", {})

        cfg = load_config()
        active_profile = get_active_provider_and_model(cfg)

        # Allow frontend to override specific model or provider
        if model_override:
            provider_id = model_override.get("provider_id")
            if provider_id:
                for p in cfg.get("providers", []):
                    if p.get("id") == provider_id:
                        active_profile = {
                            "provider_id": p.get("id"),
                            "provider_name": p.get("name"),
                            "api_type": p.get("api_type", "openai"),
                            "base_url": p.get("base_url"),
                            "api_key": p.get("api_key", ""),
                            "model": model_override.get("model") or (p.get("models") and p["models"][0]) or "default",
                            "temperature": p.get("temperature", 0.7),
                            "max_tokens": p.get("max_tokens", 4096),
                        }
                        break
            if "model" in model_override and model_override["model"] and active_profile:
                active_profile["model"] = model_override["model"]

        if not active_profile or not active_profile.get("provider_id"):
            response = web.StreamResponse(
                status=200,
                reason="OK",
                headers={
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
            await response.prepare(request)
            lang = data.get("language") or cfg.get("language", "auto")
            if lang == "en":
                err_msg = "No model provider configured yet. Please configure OpenAI, Anthropic, or custom model endpoints in Settings ⚙️."
            else:
                err_msg = "当前尚未配置任何模型服务商。请先在右上角设置 ⚙️ 中添加 OpenAI、Anthropic 或自定义模型服务。"
            await response.write(f"data: {json.dumps({'type': 'error', 'text': err_msg}, ensure_ascii=False)}\n\n".encode("utf-8"))
            await response.write(b"data: [DONE]\n\n")
            await response.write_eof()
            return response

        # Prepare messages including system prompt & formatted context
        lang = data.get("language") or cfg.get("language", "auto")
        # Resolve any local attachment URLs to base64 for LLM API ingestion
        processed_messages = []
        for m in messages:
            msg_copy = dict(m)
            if msg_copy.get("images"):
                msg_copy["images"] = [
                    resolve_attachment_to_base64(img) for img in msg_copy["images"]
                ]
            processed_messages.append(msg_copy)

        final_messages = prepare_messages(processed_messages, context=context, language=lang)

        client = LLMClient(active_profile)

        response = web.StreamResponse(
            status=200,
            reason="OK",
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
        await response.prepare(request)

        async for event in client.stream_chat(final_messages):
            payload = json.dumps(event, ensure_ascii=False)
            try:
                await response.write(f"data: {payload}\n\n".encode("utf-8"))
            except (ConnectionResetError, RuntimeError):
                # Client disconnected or cancelled request
                break

        # Send completion indicator
        try:
            await response.write(b"data: [DONE]\n\n")
            await response.write_eof()
        except (ConnectionResetError, RuntimeError):
            pass
        return response

    except Exception as e:
        logger.error(f"Error handling chat: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def handle_list_sessions(request: web.Request) -> web.Response:
    """Return list of saved conversation sessions."""
    try:
        sessions = list_sessions()
        return web.json_response({"status": "ok", "sessions": sessions})
    except Exception as e:
        logger.error(f"Error listing sessions: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def handle_get_session(request: web.Request) -> web.Response:
    """Get full session data by ID."""
    try:
        session_id = request.match_info.get("session_id", "")
        data = get_session(session_id)
        if not data:
            return web.json_response({"status": "error", "message": "Session not found"}, status=404)
        return web.json_response({"status": "ok", "session": data})
    except Exception as e:
        logger.error(f"Error retrieving session: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def handle_save_session(request: web.Request) -> web.Response:
    """Create or update a conversation session."""
    try:
        data = await request.json()
        saved = save_session(data)
        return web.json_response({"status": "ok", "session": saved})
    except Exception as e:
        logger.error(f"Error saving session: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def handle_delete_session(request: web.Request) -> web.Response:
    """Delete a conversation session."""
    try:
        session_id = request.match_info.get("session_id", "")
        success = delete_session(session_id)
        if not success:
            return web.json_response({"status": "error", "message": "Session not found or deletion failed"}, status=404)
        return web.json_response({"status": "ok", "deleted_id": session_id})
    except Exception as e:
        logger.error(f"Error deleting session: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


def register_routes(target_app: web.Application):
    """Register ComfyMate REST and SSE routes."""
    target_app.router.add_get("/comfymate/api/config", handle_get_config)
    target_app.router.add_post("/comfymate/api/config", handle_save_config)
    target_app.router.add_post("/comfymate/api/test_connection", handle_test_connection)
    target_app.router.add_post("/comfymate/api/chat", handle_chat)
    target_app.router.add_post("/comfymate/api/upload_attachment", handle_upload_attachment)
    target_app.router.add_get("/comfymate/api/attachment/{filename}", handle_get_attachment)
    target_app.router.add_get("/comfymate/api/sessions", handle_list_sessions)
    target_app.router.add_post("/comfymate/api/sessions", handle_save_session)
    target_app.router.add_get("/comfymate/api/sessions/{session_id}", handle_get_session)
    target_app.router.add_delete("/comfymate/api/sessions/{session_id}", handle_delete_session)
    logger.info("[ComfyMate] API routes registered successfully.")


if app is not None:
    register_routes(app)
