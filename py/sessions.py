"""
Local session and conversation persistence for ComfyMate.
Saves conversations as JSON files in user local storage directory.
"""

import json
import logging
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("ComfyMate")

SESSIONS_DIR = Path(__file__).resolve().parent.parent / "storage" / "sessions"
MAX_SESSION_MESSAGES = 1000


def ensure_sessions_dir() -> Path:
    """Ensure storage/sessions directory exists."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    return SESSIONS_DIR


def sanitize_session_id(session_id: str) -> Optional[str]:
    """Sanitize session ID to prevent path traversal."""
    if not session_id or not isinstance(session_id, str):
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "", session_id)
    return cleaned if cleaned else None


def list_sessions() -> List[Dict[str, Any]]:
    """List all saved sessions ordered by updated_at descending."""
    ensure_sessions_dir()
    sessions = []

    for file_path in SESSIONS_DIR.glob("*.json"):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                continue
            sess_id = data.get("id") or file_path.stem
            messages = data.get("messages", [])
            sessions.append({
                "id": sess_id,
                "title": data.get("title") or "新会话",
                "created_at": data.get("created_at") or int(file_path.stat().st_ctime * 1000),
                "updated_at": data.get("updated_at") or int(file_path.stat().st_mtime * 1000),
                "message_count": len(messages) if isinstance(messages, list) else 0,
            })
        except Exception as e:
            logger.warning(f"Failed to read session file {file_path}: {e}")

    # Sort descending by updated_at
    sessions.sort(key=lambda s: s.get("updated_at", 0), reverse=True)
    return sessions


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve full session by ID."""
    safe_id = sanitize_session_id(session_id)
    if not safe_id:
        return None

    target = SESSIONS_DIR / f"{safe_id}.json"
    if not target.is_file():
        return None

    try:
        with open(target, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load session {session_id}: {e}", exc_info=True)
        return None


def _atomic_write_json(file_path: Path, data: Any) -> None:
    """Safely write JSON to a file atomically via tempfile."""
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


def save_session(data: Dict[str, Any]) -> Dict[str, Any]:
    """Save or update a conversation session with atomic write."""
    ensure_sessions_dir()
    raw_id = data.get("id")
    safe_id = sanitize_session_id(raw_id) if raw_id else None

    now_ms = int(time.time() * 1000)

    if not safe_id:
        safe_id = f"sess_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    target = SESSIONS_DIR / f"{safe_id}.json"

    # Derive default title if missing
    title = data.get("title")
    messages = data.get("messages", [])
    if isinstance(messages, list):
        if len(messages) > MAX_SESSION_MESSAGES:
            messages = messages[-MAX_SESSION_MESSAGES:]
    else:
        messages = []

    if not title:
        for m in messages:
            if isinstance(m, dict) and m.get("role") == "user" and m.get("content"):
                title = str(m["content"]).strip().split("\n")[0][:30]
                break
    if not title:
        title = "新会话"

    created_at = data.get("created_at")
    if not created_at:
        if target.is_file():
            try:
                with open(target, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                created_at = existing.get("created_at", now_ms)
            except Exception:
                created_at = now_ms
        else:
            created_at = now_ms

    session_record = {
        "id": safe_id,
        "title": title,
        "created_at": created_at,
        "updated_at": now_ms,
        "messages": messages,
    }

    _atomic_write_json(target, session_record)
    return session_record


def delete_session(session_id: str) -> bool:
    """Delete a session file from disk."""
    safe_id = sanitize_session_id(session_id)
    if not safe_id:
        return False

    target = SESSIONS_DIR / f"{safe_id}.json"
    if target.is_file():
        try:
            target.unlink()
            return True
        except Exception as e:
            logger.error(f"Failed to delete session {session_id}: {e}", exc_info=True)
            return False
    return False
