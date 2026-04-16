"""Chat 服務：訊息組建、系統 Prompt 載入、圖片處理、來源檔案讀取、Thread 驗證

設計原則：
  - 此模組處理 Chat Agent 的對話準備邏輯，不依賴 BI 相關模型（BiProject / BiSource）
  - 可被 chat.py 和未來的 bi_chat.py 共同引用
"""

import base64
import logging
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.chat_message import ChatMessage as DbChatMessage
from app.models.chat_message_attachment import ChatMessageAttachment
from app.models.chat_thread import ChatThread
from app.models.source_file import SourceFile
from app.models.stored_file import StoredFile
from app.models.user import User
from app.services.chat_attachment_service import _is_image
from app.services.stored_files_store import absolute_blob_path

logger = logging.getLogger(__name__)

_PROMPT_TYPE_FILES: dict[str, str] = {
    "chat_agent": "system_prompt_chat_agent.md",
    "analysis": "system_prompt_analysis.md",
    "knowledge": "system_prompt_km_agent.md",
    "cs": "system_prompt_cs_agent.md",
}


def _load_system_prompt_from_file(prompt_type: str = "") -> str:
    """依 prompt_type 讀取對應的 config/*.md，改檔即生效無需重啟"""
    key = (prompt_type or "").strip() or "analysis"
    filename = _PROMPT_TYPE_FILES.get(key, _PROMPT_TYPE_FILES["analysis"])
    base = Path(__file__).resolve().parents[3]  # backend/ 或 Docker 的 /app
    for root in (base.parent / "config", base / "config"):
        path = root / filename
        if path.exists():
            try:
                return path.read_text(encoding="utf-8").strip()
            except (OSError, IOError) as e:
                logger.debug("%s 讀取失敗: %s", filename, e)
                return ""
    return ""


def _build_messages(req, data: str = "", kb_system_prompt: str | None = None) -> list[dict]:
    """組裝 OpenAI messages 格式。data 由後端依 agent_id 查詢已選取來源檔案組出。
    kb_system_prompt：若有設定則覆寫 prompt_type 檔案，優先級最高。
    """
    msgs: list[dict] = []
    system_parts: list[str] = []
    # KB 自訂 system prompt 優先；其次從 prompt_type 檔案載入
    if kb_system_prompt:
        system_parts.append(kb_system_prompt)
    else:
        file_prompt = _load_system_prompt_from_file(req.prompt_type)
        if file_prompt:
            system_parts.append(file_prompt)
    if req.system_prompt.strip():
        system_parts.append(req.system_prompt.strip())
    # 參考資料置於 system 末段
    if data.strip():
        system_parts.append(f"以下為參考資料：\n\n{data.strip()}")
    if system_parts:
        msgs.append({"role": "system", "content": "\n\n".join(system_parts)})
    for m in req.messages:
        msgs.append({"role": m.role, "content": m.content})
    user_content = req.content
    if req.user_prompt.strip():
        user_content = f"{req.user_prompt.strip()}\n\n{req.content}"
    msgs.append({"role": "user", "content": user_content})
    return msgs


def _get_selected_source_files_content(db: Session, user_id: int, tenant_id: str, agent_id: str) -> str:
    """依 user_id, tenant_id, agent_id 查詢已選取來源檔案的 content，拼接回傳（含檔名標記以利 LLM 判讀）"""
    rows = (
        db.query(SourceFile.file_name, SourceFile.content)
        .filter(
            SourceFile.user_id == user_id,
            SourceFile.tenant_id == tenant_id,
            SourceFile.agent_id == agent_id,
            SourceFile.is_selected.is_(True),
        )
        .order_by(SourceFile.file_name)
        .all()
    )
    parts = []
    for file_name, content in rows:
        if content and content.strip():
            parts.append(f"--- 檔名：{file_name} ---\n{content.strip()}")
    result = "\n\n".join(parts)
    if not result.strip():
        total = db.query(SourceFile).filter(
            SourceFile.user_id == user_id,
            SourceFile.tenant_id == tenant_id,
            SourceFile.agent_id == agent_id,
        ).count()
        selected = db.query(SourceFile).filter(
            SourceFile.user_id == user_id,
            SourceFile.tenant_id == tenant_id,
            SourceFile.agent_id == agent_id,
            SourceFile.is_selected.is_(True),
        ).count()
        logger.info(
            "chat 查詢參考資料為空: user_id=%s tenant_id=%r aid=%r → 總檔案=%d 已選取=%d",
            user_id,
            tenant_id,
            agent_id,
            total,
            selected,
        )
    return result


def _parse_optional_chat_thread_id(
    db: Session,
    current: User,
    tenant_id: str,
    business_agent_id: str,
    raw: str | None,
) -> UUID | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        tid = UUID(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="chat_thread_id 格式錯誤")
    row = (
        db.query(ChatThread)
        .filter(
            ChatThread.id == tid,
            ChatThread.tenant_id == tenant_id,
            ChatThread.user_id == current.id,
            ChatThread.agent_id == business_agent_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=403, detail="無權限使用此對話串或 agent 不符")
    return tid


def _load_user_message_image_parts(
    db: Session,
    *,
    tenant_id: str,
    user_id: int,
    thread_id: UUID,
    user_message_id: UUID,
) -> list[tuple[str, bytes]]:
    msg = (
        db.query(DbChatMessage)
        .join(ChatThread, ChatThread.id == DbChatMessage.thread_id)
        .filter(
            DbChatMessage.id == user_message_id,
            DbChatMessage.thread_id == thread_id,
            ChatThread.tenant_id == tenant_id,
            ChatThread.user_id == user_id,
        )
        .first()
    )
    if not msg or (msg.role or "").strip().lower() != "user":
        return []
    atts = (
        db.query(ChatMessageAttachment)
        .filter(ChatMessageAttachment.message_id == user_message_id)
        .order_by(ChatMessageAttachment.created_at.asc())
        .all()
    )
    out: list[tuple[str, bytes]] = []
    for a in atts:
        sf = (
            db.query(StoredFile)
            .filter(
                StoredFile.id == a.file_id,
                StoredFile.tenant_id == tenant_id,
                StoredFile.deleted_at.is_(None),
            )
            .first()
        )
        if not sf:
            continue
        if not _is_image(sf.original_filename, sf.content_type):
            continue
        try:
            path = absolute_blob_path(sf.tenant_id, sf.id)
        except RuntimeError:
            continue
        if not path.is_file():
            continue
        raw = path.read_bytes()
        mt = (sf.content_type or "").strip().lower() or "image/png"
        if mt not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            mt = "image/png"
        out.append((mt, raw))
    max_n = settings.CHAT_INLINE_IMAGE_MAX_COUNT
    if len(out) > max_n:
        out = out[:max_n]
    return out


def _merge_last_user_string_with_images(text: str, images: list[tuple[str, bytes]]) -> str | list[dict]:
    if not images:
        return text
    body = text.strip() if text.strip() else "請依圖片內容回答（繁體中文）。"
    parts: list[dict] = [{"type": "text", "text": body}]
    for mime, raw in images:
        b64 = base64.standard_b64encode(raw).decode("ascii")
        parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
    return parts


def _inject_user_message_images_into_messages(
    db: Session,
    messages: list[dict],
    *,
    tenant_id: str,
    user_id: int,
    thread_id: UUID | None,
    user_message_id_raw: str,
    model: str,
) -> tuple[list[dict], bool]:
    raw = (user_message_id_raw or "").strip()
    if not raw or thread_id is None:
        return messages, False
    try:
        umid = UUID(raw)
    except ValueError:
        return messages, False
    image_parts = _load_user_message_image_parts(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        thread_id=thread_id,
        user_message_id=umid,
    )
    if not image_parts:
        return messages, False
    if model.startswith("twcc/"):
        raise HTTPException(
            status_code=400,
            detail="台智雲模型目前不支援對話中附加圖片；請改用 OpenAI／Gemini 等視覺模型。",
        )
    if not messages:
        return messages, False
    last = messages[-1]
    if last.get("role") != "user":
        return messages, False
    text = last.get("content")
    if not isinstance(text, str):
        return messages, False
    last["content"] = _merge_last_user_string_with_images(text, image_parts)
    return messages, True
