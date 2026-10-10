import json
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("ComfyMate")

CONFIG_FILE = Path(__file__).resolve().parent.parent / "config.json"

DEFAULT_CONFIG: Dict[str, Any] = {
    "active_provider_id": None,
    "active_model": None,
    "language": "auto",
    "temperature": 0.7,
    "max_tokens": 4096,
    "stream": True,
    "providers": [],
}


def _safe_float(val: Any, default: float = 0.7) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_int(val: Any, default: int = 4096) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _clean_config(data: Any) -> Dict[str, Any]:
    """Ensure config strictly conforms to the multi-provider schema without legacy fields."""
    if not isinstance(data, dict):
        return dict(DEFAULT_CONFIG)

    providers = data.get("providers")
    if not isinstance(providers, list):
        providers = []

    return {
        "active_provider_id": data.get("active_provider_id"),
        "active_model": data.get("active_model"),
        "language": data.get("language", "auto"),
        "temperature": _safe_float(data.get("temperature"), 0.7),
        "max_tokens": _safe_int(data.get("max_tokens"), 4096),
        "stream": bool(data.get("stream", True)),
        "providers": providers,
    }


def load_config() -> Dict[str, Any]:
    """Load config from local config.json."""
    if not CONFIG_FILE.exists():
        return dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
            return _clean_config(saved)
    except Exception as e:
        logger.warning(f"Error loading config: {e}, using default config.")
        return dict(DEFAULT_CONFIG)


def _atomic_write_json(file_path: Path, data: Any) -> None:
    """Safely write JSON to a file atomically via tempfile to prevent race conditions and corruption."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=file_path.parent, delete=False, encoding="utf-8") as tf:
            tmp_file = Path(tf.name)
            json.dump(data, tf, indent=2, ensure_ascii=False)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_file, file_path)
    except Exception as e:
        if tmp_file and tmp_file.exists():
            try:
                tmp_file.unlink()
            except OSError:
                pass
        raise e


def save_config(new_config: Dict[str, Any]) -> Dict[str, Any]:
    """Save config to local config.json strictly following standard schema with atomic write."""
    current = load_config()

    if "active_provider_id" in new_config:
        current["active_provider_id"] = new_config["active_provider_id"]
    if "active_model" in new_config:
        current["active_model"] = new_config["active_model"]
    if "language" in new_config:
        current["language"] = new_config["language"]
    if "temperature" in new_config:
        current["temperature"] = _safe_float(new_config["temperature"], 0.7)
    if "max_tokens" in new_config:
        current["max_tokens"] = _safe_int(new_config["max_tokens"], 4096)
    if "stream" in new_config:
        current["stream"] = bool(new_config["stream"])

    if "providers" in new_config and isinstance(new_config["providers"], list):
        current_providers_map = {p["id"]: p for p in current.get("providers", []) if isinstance(p, dict) and "id" in p}
        updated_providers = []

        for p in new_config["providers"]:
            if not isinstance(p, dict):
                continue
            pid = p.get("id") or f"provider_{uuid.uuid4().hex[:6]}"
            old_p = current_providers_map.get(pid, {})

            api_key = str(p.get("api_key", "")).strip()
            if not api_key or "..." in api_key or "********" in api_key:
                api_key = old_p.get("api_key", "")

            models = p.get("models", [])
            if isinstance(models, str):
                models = [m.strip() for m in models.replace("\n", ",").split(",") if m.strip()]

            api_type = p.get("api_type", "")
            if not api_type:
                api_type = old_p.get("api_type", "")
            if not api_type:
                api_type = "anthropic" if "anthropic" in p.get("base_url", "").lower() else "openai"

            updated_providers.append({
                "id": pid,
                "name": p.get("name", "自定义服务商"),
                "api_type": api_type,
                "base_url": p.get("base_url", "http://localhost:11434/v1").rstrip("/"),
                "api_key": api_key,
                "models": models,
                "temperature": _safe_float(p.get("temperature"), 0.7),
                "max_tokens": _safe_int(p.get("max_tokens"), 4096),
            })

        current["providers"] = updated_providers

    clean_cfg = _clean_config(current)
    try:
        _atomic_write_json(CONFIG_FILE, clean_cfg)
    except Exception as e:
        logger.error(f"Error saving config: {e}")
        raise e
    return clean_cfg


def get_active_provider_and_model(config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Resolve the active provider configuration and model."""
    active_pid = config.get("active_provider_id")
    providers = config.get("providers", [])
    active_model = config.get("active_model", "")

    provider = None
    for p in providers:
        if isinstance(p, dict) and p.get("id") == active_pid:
            provider = p
            break

    if not provider and providers:
        provider = providers[0]

    if not provider:
        return None

    if not active_model and provider.get("models"):
        active_model = provider["models"][0]

    return {
        "provider_id": provider.get("id"),
        "provider_name": provider.get("name"),
        "api_type": provider.get("api_type", "openai"),
        "base_url": provider.get("base_url"),
        "api_key": provider.get("api_key", ""),
        "model": active_model or "default",
        "temperature": config.get("temperature", provider.get("temperature", 0.7)),
        "max_tokens": config.get("max_tokens", provider.get("max_tokens", 4096)),
    }
