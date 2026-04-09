"""Chat API：POST /chat/completions（LiteLLM 統一支援 OpenAI / Gemini / 台智雲）"""
import base64
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, cast

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import litellm
from sqlalchemy.orm import Session

from uuid import UUID

from app.api.endpoints.source_files import _check_agent_access
from app.core.config import settings
from app.core.database import get_db
from app.core.encryption import decrypt_api_key
from app.core.security import get_current_user
from app.models.bi_project import BiProject
from app.models.bi_source import BiSource
from app.models.llm_provider_config import LLMProviderConfig
from app.models.qtn_catalog import QtnCatalog
from app.models.qtn_project import QtnProject
from app.models.qtn_source import QtnSource
from app.models.chat_llm_request import ChatLlmRequest
from app.models.chat_message import ChatMessage as DbChatMessage
from app.models.chat_message_attachment import ChatMessageAttachment
from app.models.chat_thread import ChatThread
from app.models.source_file import SourceFile
from app.models.stored_file import StoredFile
from app.models.user import User
from app.services.chat_attachment_service import _is_image
from app.services.duckdb_store import get_project_data_as_csv
from app.services.stored_files_store import absolute_blob_path

router = APIRouter()
logger = logging.getLogger(__name__)

# 台智雲模型名稱對照：前端格式 -> API 格式（小寫連字號 + -chat）
_TWCC_MODEL_MAP: dict[str, str] = {
    "Llama3.1-FFM-8B-32K": "llama3.1-ffm-8b-32k-chat",
    "Llama3.3-FFM-70B-32K": "llama3.3-ffm-70b-32k-chat",
}


def _get_llm_params(model: str, db=None, tenant_id: str | None = None) -> tuple[str, str | None, str | None]:
    """
    依 model 回傳 (litellm_model, api_key, api_base)。
    api_key 僅從該租戶 DB 的 llm_provider_configs 取得；未設定則回傳 None。
    api_base 僅台智雲需要，其他為 None。
    """
    def _db_key(provider: str) -> tuple[str | None, str | None]:
        """從 DB 取得指定 provider 的 (api_key, api_base_url)；找不到或解密失敗回傳 (None, None)"""
        if db is None or not tenant_id:
            return None, None
        cfg = (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == tenant_id,
                LLMProviderConfig.provider == provider,
                LLMProviderConfig.is_active.is_(True),
            )
            .order_by(LLMProviderConfig.id)
            .first()
        )
        if not cfg:
            return None, None
        key: str | None = None
        if cfg.api_key_encrypted:
            try:
                key = decrypt_api_key(cfg.api_key_encrypted)
            except ValueError:
                logger.warning("LLMProviderConfig id=%s provider=%s 解密失敗", cfg.id, provider)
        return key, cfg.api_base_url

    if model.startswith("gemini/"):
        db_key, _ = _db_key("gemini")
        return model, db_key or None, None
    if model.startswith("twcc/"):
        db_key, db_base = _db_key("twcc")
        litellm_model = f"openai/{model[5:]}"
        return litellm_model, db_key or None, db_base or None
    db_key, _ = _db_key("openai")
    return model, db_key or None, None


class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""

    class Config:
        extra = "ignore"  # 忽略 meta 等額外欄位


class ChatRequest(BaseModel):
    agent_id: str = ""  # chat.py 必填；chat_dev 不填
    project_id: str = ""  # quotation_parse 時可填，改從 qtn_sources 取參考資料
    prompt_type: str = ""  # chat_agent → system_prompt_chat_agent.md；空或 analysis → system_prompt_analysis.md；quotation_parse → …
    schema_id: str = ""  # dev-test-compute-tool：覆寫專案 schema，從 bi_schemas 載入
    system_prompt: str = ""
    user_prompt: str = ""
    data: str = ""  # Chat Agent 等：前端可傳純文字參考（如本頁上傳檔），與後端組出之資料合併後一併受長度上限檢查
    model: str = "gpt-4o-mini"
    messages: list[ChatMessage] = []
    chat_thread_id: str = ""
    trace_id: str = ""
    #: 本輪 user 訊息之 DB id；有圖片附件時後端會從 stored_files 讀取像素組入最後一則 user（OpenAI / Gemini 多模態）
    user_message_id: str = ""
    content: str  # 新使用者訊息


class UsageMeta(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatResponse(BaseModel):
    content: str
    model: str = ""
    usage: UsageMeta | None = None
    finish_reason: str | None = None
    llm_request_id: str | None = None


def _infer_llm_provider(model: str) -> str:
    m = (model or "").strip()
    if m.startswith("gemini/"):
        return "gemini"
    if m.startswith("twcc/"):
        return "twcc"
    return "openai"


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


def _persist_chat_llm_request(
    db: Session,
    *,
    tenant_id: str,
    user_id: int,
    thread_id: UUID,
    model: str,
    trace_id: str | None,
    latency_ms: int,
    status: str,
    usage: UsageMeta | None,
    finish_reason: str | None,
    error_code: str | None,
    error_message: str | None,
) -> UUID:
    msg = (error_message or "").strip()[:8000] if error_message else None
    tid = (trace_id or "").strip()[:128] if trace_id else None
    row = ChatLlmRequest(
        tenant_id=tenant_id,
        user_id=user_id,
        thread_id=thread_id,
        model=model or None,
        provider=_infer_llm_provider(model),
        prompt_tokens=usage.prompt_tokens if usage else None,
        completion_tokens=usage.completion_tokens if usage else None,
        total_tokens=usage.total_tokens if usage else None,
        latency_ms=latency_ms,
        finished_at=datetime.now(timezone.utc),
        status=status,
        error_code=error_code,
        error_message=msg,
        trace_id=tid,
    )
    db.add(row)
    db.flush()
    return row.id


def _build_messages(req: ChatRequest, data: str = "") -> list[dict]:
    """組裝 OpenAI messages 格式。data 由後端依 agent_id 查詢已選取來源檔案組出"""
    msgs: list[dict] = []
    system_parts: list[str] = []
    file_prompt = _load_system_prompt_from_file(req.prompt_type)
    if file_prompt:
        system_parts.append(file_prompt)
    if req.system_prompt.strip():
        system_parts.append(req.system_prompt.strip())
    # 參考資料（含 Chat 附檔）置於 system 末段；前段為檔案 system_prompt + 自訂 system_prompt，前綴穩定以利 LLM prompt cache。勿改為併入 user。
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


def _parse_response(resp) -> ChatResponse:
    """從 OpenAI 格式的 response 解析為 ChatResponse"""
    if not resp.choices:
        raise ValueError("LiteLLM 回傳無 choices")
    choice = resp.choices[0]
    content = (choice.message.content or "") if choice.message else ""
    usage = None
    if resp.usage:
        usage = UsageMeta(
            prompt_tokens=resp.usage.prompt_tokens,
            completion_tokens=resp.usage.completion_tokens,
            total_tokens=resp.usage.total_tokens,
        )
    return ChatResponse(
        content=content,
        model=resp.model or "",
        usage=usage,
        finish_reason=choice.finish_reason,
    )


def _twcc_model_id(frontend_model: str) -> str:
    """將前端模型名稱轉為台智雲 API 格式。例：Llama3.1-FFM-8B-32K -> llama3.1-ffm-8b-32k-chat"""
    key = frontend_model.strip()
    if key in _TWCC_MODEL_MAP:
        return _TWCC_MODEL_MAP[key]
    #  fallback：小寫、空格/大寫轉連字號，加 -chat
    normalized = key.lower().replace(" ", "-").replace("_", "-")
    return f"{normalized}-chat" if not normalized.endswith("-chat") else normalized


async def _call_twcc_conversation(
    url: str,
    api_key: str,
    model_id: str,
    messages: list[dict],
) -> ChatResponse:
    """
    直接呼叫台智雲 Conversation API。
    端點：https://api-ams.twcc.ai/api/models/conversation
    Header：X-API-KEY
    """
    payload = {
        "model": model_id,
        "messages": messages,
        "parameters": {
            "max_new_tokens": 2000,
            "temperature": 0.01,
            "top_k": 40,
            "top_p": 0.9,
            "frequency_penalty": 1.2,
        },
    }
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    timeout = aiohttp.ClientTimeout(total=180)
    async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                if not resp.ok:
                    err_body = await resp.text()
                    hint = (err_body or "").strip() or "（無回應內容）"
                    raise HTTPException(
                        status_code=resp.status,
                        detail=f"TWCC API 錯誤 {resp.status}：{hint[:4000]}",
                    )
                data = await resp.json()

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=502,
            detail=f"台智雲回應格式異常（非 JSON 物件）：{type(data).__name__}",
        )

    # 台智雲回應格式：generated_text, prompt_tokens, generated_tokens, total_tokens, finish_reason
    content = data.get("generated_text") or data.get("text") or data.get("output") or ""
    if isinstance(content, list):
        content = "\n".join(str(x) for x in content)
    content = str(content) if content is not None else ""
    usage = None
    if "prompt_tokens" in data or "total_tokens" in data:
        usage = UsageMeta(
            prompt_tokens=data.get("prompt_tokens", 0),
            completion_tokens=data.get("generated_tokens", data.get("completion_tokens", 0)),
            total_tokens=data.get("total_tokens", 0),
        )

    if not (content or "").strip():
        err_hint = data.get("error") or data.get("message") or data.get("err_msg") or data.get("detail")
        if isinstance(err_hint, dict):
            err_hint = err_hint.get("message") or err_hint.get("msg") or json.dumps(err_hint, ensure_ascii=False)[:500]
        keys = list(data.keys())
        tail = json.dumps(data, ensure_ascii=False)[:1500]
        hint = f" API 錯誤欄位：{err_hint}" if err_hint else ""
        raise HTTPException(
            status_code=502,
            detail=f"台智雲未回傳可讀文字（generated_text 等為空）。{hint} 回應欄位：{keys}。摘要：{tail}",
        )

    return ChatResponse(
        content=content,
        model=model_id,
        usage=usage,
        finish_reason=data.get("finish_reason"),
    )


def _get_provider_name(model: str) -> str:
    if model.startswith("gemini/"):
        return "Gemini"
    if model.startswith("twcc/"):
        return "台智雲"
    return "OpenAI"


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
        # 診斷：查詢同條件下總檔案數與已選取數
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


def _get_bi_sources_content(db: Session, user_id: int, project_id: str) -> str:
    """依 project_id 查詢 bi_sources 的 content（is_selected=True），拼接回傳（專案須屬於該 user）"""
    try:
        pid = UUID(project_id)
    except ValueError:
        return ""
    proj = db.query(BiProject).filter(BiProject.project_id == pid).first()
    if not proj or proj.user_id != str(user_id):
        return ""
    rows = (
        db.query(BiSource.file_name, BiSource.content)
        .filter(BiSource.project_id == pid, BiSource.is_selected.is_(True))
        .order_by(BiSource.file_name)
        .all()
    )
    parts = []
    for file_name, content in rows:
        if content and content.strip():
            parts.append(f"--- 檔名：{file_name} ---\n{content.strip()}")
    return "\n\n".join(parts)


def _get_qtn_sources_content(db: Session, user_id: int, project_id: str) -> str:
    """依 project_id 查詢 qtn_sources 的 content，拼接回傳（專案須屬於該 user）。
    source_type=OFFERING 時，依 file_name 對應 qtn_catalog.catalog_name 取得 content。"""
    try:
        pid = UUID(project_id)
    except ValueError:
        return ""
    proj = db.query(QtnProject).filter(QtnProject.project_id == pid).first()
    if not proj or proj.user_id != str(user_id):
        return ""
    rows = (
        db.query(QtnSource.file_name, QtnSource.source_type, QtnSource.content)
        .filter(QtnSource.project_id == pid)
        .order_by(QtnSource.source_type, QtnSource.file_name)
        .all()
    )
    parts = []
    for file_name, stype, src_content in rows:
        if stype == "OFFERING":
            cat = (
                db.query(QtnCatalog)
                .filter(
                    QtnCatalog.tenant_id == proj.tenant_id,
                    QtnCatalog.catalog_name == file_name,
                )
                .first()
            )
            content = cat.content if (cat and cat.content) else src_content
        else:
            content = src_content
        if content and content.strip():
            label = "產品/服務清單" if stype == "OFFERING" else "需求描述"
            parts.append(f"--- [{label}] {file_name} ---\n{content.strip()}")
    return "\n\n".join(parts)


def _get_qtn_final_content(db: Session, user_id: int, project_id: str) -> str:
    """依 project_id 查詢 qtn_projects.qtn_final，轉為可讀文字供 LLM 參考。
    會補上計算後的小計、稅額、總金額，確保 LLM 取得與畫面一致的數字。"""
    try:
        pid = UUID(project_id)
    except ValueError:
        return ""
    proj = db.query(QtnProject).filter(QtnProject.project_id == pid).first()
    if not proj or proj.user_id != str(user_id) or not proj.qtn_final:
        return ""
    data = dict(proj.qtn_final)
    items = data.get("items") or []
    if isinstance(items, list):
        subtotal_sum = sum(
            float(i.get("subtotal", 0) or 0)
            for i in items
            if isinstance(i, dict)
        )
        subtotal_sum = round(subtotal_sum * 100) / 100
    else:
        subtotal_sum = 0
    tax_rate = float(data.get("tax_rate") or 0)
    tax_amount = round(subtotal_sum * tax_rate * 100) / 100
    total_amount = subtotal_sum + tax_amount
    data["_computed"] = {
        "subtotal_sum": subtotal_sum,
        "tax_rate": tax_rate,
        "tax_amount": tax_amount,
        "total_amount": total_amount,
        "currency": data.get("currency") or "TWD",
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


_PROMPT_TYPE_FILES: dict[str, str] = {
    "chat_agent": "system_prompt_chat_agent.md",
    "quotation_parse": "system_prompt_quotation_1_parse.md",
    "quotation_share": "system_prompt_quotation_4_share.md",
    "analysis": "system_prompt_analysis.md",
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


@dataclass(frozen=True)
class ChatCompletionPrepared:
    """chat_completions／completions-stream 共用：參考資料、messages、金鑰與 thread 等。"""

    tenant_id: str
    messages: list[dict]
    model: str
    litellm_model: str
    api_key: str
    api_base: str | None
    thread_uuid: UUID | None
    trace_raw: str | None
    user_id: int
    has_vision_user_content: bool


def _prepare_chat_completion(req: ChatRequest, db: Session, current: User) -> ChatCompletionPrepared:
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    tenant_id, aid = _check_agent_access(db, current, req.agent_id.strip())
    trace_raw = (req.trace_id or "").strip() or None
    thread_uuid = _parse_optional_chat_thread_id(db, current, tenant_id, aid, req.chat_thread_id)

    pt = (req.prompt_type or "").strip()
    pid = (req.project_id or "").strip()
    if pt == "quotation_parse" and pid:
        data = _get_qtn_sources_content(db, current.id, pid)
    elif pt == "quotation_share" and pid:
        data = _get_qtn_final_content(db, current.id, pid)
    elif pid:
        try:
            bi_proj = db.query(BiProject).filter(BiProject.project_id == UUID(pid)).first()
            if bi_proj and bi_proj.user_id == str(current.id):
                data = get_project_data_as_csv(pid) or ""
            else:
                data = _get_selected_source_files_content(db, current.id, tenant_id, aid)
        except ValueError:
            data = _get_selected_source_files_content(db, current.id, tenant_id, aid)
    else:
        data = _get_selected_source_files_content(db, current.id, tenant_id, aid)
    client_ref = (req.data or "").strip()
    if client_ref:
        base = (data or "").strip()
        if base:
            data = f"{base}\n\n---\n【來自 Chat 上傳之參考】\n\n{client_ref}"
        else:
            data = client_ref
    data_len = len(data.strip()) if data else 0
    max_chars = (
        settings.CHAT_AGENT_REFERENCE_MAX_CHARS
        if pt == "chat_agent"
        else settings.CHAT_DATA_MAX_CHARS
    )
    if data_len > max_chars:
        raise HTTPException(
            status_code=413,
            detail=f"參考資料超過 {max_chars:,} 字元（目前約 {data_len:,} 字元），請減少選用的來源檔案後再試。",
        )

    if data_len == 0:
        if pt == "quotation_parse":
            raise HTTPException(
                status_code=400,
                detail="請先選擇專案並上傳產品/服務清單與需求描述後再進行解析。",
            )
        if pt == "quotation_share":
            raise HTTPException(
                status_code=400,
                detail="請先完成報價單（步驟 3）並進入發送跟進步驟後再生成建議。",
            )
        if pid:
            try:
                bi_proj = db.query(BiProject).filter(BiProject.project_id == UUID(pid)).first()
                if bi_proj and bi_proj.user_id == str(current.id):
                    raise HTTPException(
                        status_code=400,
                        detail="DuckDB 尚無資料，請先在 CSV 分頁匯入資料",
                    )
            except HTTPException:
                raise
            except ValueError:
                pass
        logger.warning(
            "chat_completions: 無參考資料 (agent_id=%r, tenant_id=%r, aid=%r, user_id=%s) - 請在該 agent 頁面左欄上傳並勾選來源檔案",
            req.agent_id,
            tenant_id,
            aid,
            current.id,
        )
    else:
        logger.info("chat_completions: 已載入參考資料 %d 字元", data_len)

    model = (req.model or "").strip() or "gpt-4o-mini"
    litellm_model, api_key, api_base = _get_llm_params(model, db=db, tenant_id=tenant_id)

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(model)} API Key 未設定，請在管理介面（租戶 LLM 設定）設定對應的 key",
        )
    if model.startswith("twcc/") and not api_base:
        raise HTTPException(
            status_code=503,
            detail="台智雲 TWCC_API_BASE 未設定，請在管理介面（租戶 LLM 設定）設定",
        )

    messages = _build_messages(req, data=data)
    messages, has_vision = _inject_user_message_images_into_messages(
        db,
        messages,
        tenant_id=tenant_id,
        user_id=current.id,
        thread_id=thread_uuid,
        user_message_id_raw=req.user_message_id,
        model=model,
    )
    return ChatCompletionPrepared(
        tenant_id=tenant_id,
        messages=messages,
        model=model,
        litellm_model=litellm_model,
        api_key=cast(str, api_key),
        api_base=api_base,
        thread_uuid=thread_uuid,
        trace_raw=trace_raw,
        user_id=current.id,
        has_vision_user_content=has_vision,
    )


def _sse_line(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _sse_error_user_message(obj: object) -> str:
    """SSE error 給前端的 message：避免空字串導致畫面只顯示「錯誤：」"""
    if obj is None:
        return "未知錯誤（伺服器未提供詳情）。"
    if isinstance(obj, str):
        s = obj.strip()
        return s if s else "未知錯誤（伺服器回傳空字串）。請查看後端日誌或網路／逾時。"
    s = str(obj).strip()
    if s:
        return s[:8000]
    return f"未知錯誤（{type(obj).__name__}）。請查看後端日誌。"


def _sse_event_error(message: object) -> str:
    return _sse_line({"event": "error", "message": _sse_error_user_message(message)})


@router.post("/completions", response_model=ChatResponse)
async def chat_completions(
    req: ChatRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    logger.info(f"chat_completions: model={req.model!r}, content_len={len(req.content) if req.content else 0}")
    try:
        prepared = _prepare_chat_completion(req, db, current)
        tenant_id = prepared.tenant_id
        thread_uuid = prepared.thread_uuid
        trace_raw = prepared.trace_raw
        model = prepared.model
        litellm_model = prepared.litellm_model
        api_key = prepared.api_key
        api_base = prepared.api_base
        messages = prepared.messages
        vision_timeout = 180 if prepared.has_vision_user_content else 60

        if model.startswith("twcc/"):
            # 台智雲：直接呼叫 Conversation API（X-API-KEY、/models/conversation）
            url = (api_base or "").rstrip("/")
            if not url:
                raise HTTPException(
                    status_code=503,
                    detail="台智雲 TWCC_API_BASE 未設定，請在管理介面（租戶 LLM 設定）設定",
                )
            model_id = _twcc_model_id(model[5:])  # twcc/Llama3.1-FFM-8B-32K -> Llama3.1-FFM-8B-32K
            t0 = time.perf_counter()
            try:
                twcc_out = await _call_twcc_conversation(url=url, api_key=api_key, model_id=model_id, messages=messages)
            except HTTPException:
                raise
            except Exception as e:
                latency_ms = int((time.perf_counter() - t0) * 1000)
                if thread_uuid:
                    _persist_chat_llm_request(
                        db,
                        tenant_id=tenant_id,
                        user_id=current.id,
                        thread_id=thread_uuid,
                        model=model,
                        trace_id=trace_raw,
                        latency_ms=latency_ms,
                        status="error",
                        usage=None,
                        finish_reason=None,
                        error_code="twcc_error",
                        error_message=str(e),
                    )
                    db.commit()
                raise
            latency_ms = int((time.perf_counter() - t0) * 1000)
            rid_str: str | None = None
            if thread_uuid:
                rid = _persist_chat_llm_request(
                    db,
                    tenant_id=tenant_id,
                    user_id=current.id,
                    thread_id=thread_uuid,
                    model=model,
                    trace_id=trace_raw,
                    latency_ms=latency_ms,
                    status="success",
                    usage=twcc_out.usage,
                    finish_reason=twcc_out.finish_reason,
                    error_code=None,
                    error_message=None,
                )
                db.commit()
                rid_str = str(rid)
            return ChatResponse(
                content=twcc_out.content,
                model=twcc_out.model,
                usage=twcc_out.usage,
                finish_reason=twcc_out.finish_reason,
                llm_request_id=rid_str,
            )

        if model.startswith("gemini/"):
            os.environ["GEMINI_API_KEY"] = api_key
        else:
            os.environ["OPENAI_API_KEY"] = api_key

        completion_kwargs: dict = {
            "model": litellm_model,
            "messages": messages,
            "api_key": api_key,
            "timeout": vision_timeout,
            "temperature": 0,
        }
        if api_base:
            base = api_base.rstrip("/")
            completion_kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"

        t0 = time.perf_counter()
        try:
            resp = await litellm.acompletion(**completion_kwargs)
            parsed = _parse_response(resp)
        except Exception as e:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            if thread_uuid:
                _persist_chat_llm_request(
                    db,
                    tenant_id=tenant_id,
                    user_id=current.id,
                    thread_id=thread_uuid,
                    model=model,
                    trace_id=trace_raw,
                    latency_ms=latency_ms,
                    status="error",
                    usage=None,
                    finish_reason=None,
                    error_code="litellm_error",
                    error_message=str(e),
                )
                db.commit()
            import traceback

            logger.exception("chat_completions 發生錯誤")
            raise HTTPException(status_code=500, detail=str(e))

        latency_ms = int((time.perf_counter() - t0) * 1000)
        rid_str = None
        if thread_uuid:
            rid = _persist_chat_llm_request(
                db,
                tenant_id=tenant_id,
                user_id=current.id,
                thread_id=thread_uuid,
                model=model,
                trace_id=trace_raw,
                latency_ms=latency_ms,
                status="success",
                usage=parsed.usage,
                finish_reason=parsed.finish_reason,
                error_code=None,
                error_message=None,
            )
            db.commit()
            rid_str = str(rid)
        return ChatResponse(
            content=parsed.content,
            model=parsed.model,
            usage=parsed.usage,
            finish_reason=parsed.finish_reason,
            llm_request_id=rid_str,
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.exception("chat_completions 發生錯誤")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/completions-stream")
async def chat_completions_stream(
    req: ChatRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """SSE：`data: {JSON}\\n\\n`。事件 type 見 event 欄位：delta / done / error。"""
    logger.info(
        "chat_completions_stream: model=%r, content_len=%s",
        req.model,
        len(req.content) if req.content else 0,
    )
    try:
        prepared = _prepare_chat_completion(req, db, current)
    except HTTPException:
        raise

    async def event_gen():
        from app.core.database import SessionLocal

        t0 = time.perf_counter()
        parts: list[str] = []
        finish_reason: str | None = None
        usage_out: UsageMeta | None = None
        resp_model = prepared.model

        def persist_fail(msg: str, code: str = "stream_error") -> None:
            if not prepared.thread_uuid:
                return
            latency_ms = int((time.perf_counter() - t0) * 1000)
            s = SessionLocal()
            try:
                _persist_chat_llm_request(
                    s,
                    tenant_id=prepared.tenant_id,
                    user_id=prepared.user_id,
                    thread_id=prepared.thread_uuid,
                    model=prepared.model,
                    trace_id=prepared.trace_raw,
                    latency_ms=latency_ms,
                    status="error",
                    usage=None,
                    finish_reason=None,
                    error_code=code,
                    error_message=msg[:8000],
                )
                s.commit()
            finally:
                s.close()

        def persist_ok(u: UsageMeta | None, fr: str | None) -> str | None:
            if not prepared.thread_uuid:
                return None
            latency_ms = int((time.perf_counter() - t0) * 1000)
            s = SessionLocal()
            try:
                rid = _persist_chat_llm_request(
                    s,
                    tenant_id=prepared.tenant_id,
                    user_id=prepared.user_id,
                    thread_id=prepared.thread_uuid,
                    model=prepared.model,
                    trace_id=prepared.trace_raw,
                    latency_ms=latency_ms,
                    status="success",
                    usage=u,
                    finish_reason=fr,
                    error_code=None,
                    error_message=None,
                )
                s.commit()
                return str(rid)
            finally:
                s.close()

        try:
            if prepared.model.startswith("twcc/"):
                url = (prepared.api_base or "").rstrip("/")
                if not url:
                    persist_fail("台智雲 API Base 未設定", "twcc_config")
                    yield _sse_event_error("台智雲 API Base 未設定")
                    return
                model_id = _twcc_model_id(prepared.model[5:])
                try:
                    twcc_out = await _call_twcc_conversation(
                        url=url,
                        api_key=prepared.api_key,
                        model_id=model_id,
                        messages=prepared.messages,
                    )
                except HTTPException as he:
                    det = he.detail
                    msg = det if isinstance(det, str) else str(det)
                    persist_fail(msg, "twcc_error")
                    yield _sse_event_error(msg)
                    return
                except Exception as e:
                    persist_fail(str(e), "twcc_error")
                    yield _sse_event_error(e)
                    return
                body = twcc_out.content or ""
                if body:
                    yield _sse_line({"event": "delta", "text": body})
                parts.append(body)
                finish_reason = twcc_out.finish_reason
                usage_out = twcc_out.usage
                resp_model = twcc_out.model or resp_model
            else:
                if prepared.model.startswith("gemini/"):
                    os.environ["GEMINI_API_KEY"] = prepared.api_key
                else:
                    os.environ["OPENAI_API_KEY"] = prepared.api_key
                stream_timeout = 240 if prepared.has_vision_user_content else 120
                completion_kwargs: dict = {
                    "model": prepared.litellm_model,
                    "messages": prepared.messages,
                    "api_key": prepared.api_key,
                    "timeout": stream_timeout,
                    "temperature": 0,
                    "stream": True,
                }
                if prepared.api_base:
                    base = prepared.api_base.rstrip("/")
                    completion_kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"
                try:
                    stream_resp = await litellm.acompletion(**completion_kwargs)
                except Exception as e:
                    logger.exception("completions-stream litellm 初始錯誤")
                    persist_fail(str(e), "litellm_error")
                    yield _sse_event_error(e)
                    return
                async for chunk in stream_resp:
                    mod = getattr(chunk, "model", None)
                    if mod:
                        resp_model = mod
                    if not chunk.choices:
                        u = getattr(chunk, "usage", None)
                        if u is not None:
                            try:
                                usage_out = UsageMeta(
                                    prompt_tokens=int(getattr(u, "prompt_tokens", None) or 0),
                                    completion_tokens=int(getattr(u, "completion_tokens", None) or 0),
                                    total_tokens=int(getattr(u, "total_tokens", None) or 0),
                                )
                            except (TypeError, ValueError):
                                pass
                        continue
                    ch0 = chunk.choices[0]
                    delta = getattr(ch0, "delta", None)
                    if delta and getattr(delta, "content", None):
                        piece = delta.content
                        if piece:
                            parts.append(piece)
                            yield _sse_line({"event": "delta", "text": piece})
                    if ch0.finish_reason:
                        finish_reason = ch0.finish_reason
                    u = getattr(chunk, "usage", None)
                    if u is not None:
                        try:
                            pt = getattr(u, "prompt_tokens", None)
                            ct = getattr(u, "completion_tokens", None)
                            tt = getattr(u, "total_tokens", None)
                            if pt is not None or ct is not None or tt is not None:
                                usage_out = UsageMeta(
                                    prompt_tokens=int(pt or 0),
                                    completion_tokens=int(ct or 0),
                                    total_tokens=int(tt or 0),
                                )
                        except (TypeError, ValueError):
                            pass
        except Exception as e:
            logger.exception("completions-stream 未預期錯誤")
            persist_fail(str(e), "stream_error")
            yield _sse_event_error(e)
            return

        full = "".join(parts)
        rid_str = persist_ok(usage_out, finish_reason)
        done_payload = {
            "event": "done",
            "content": full,
            "model": resp_model or "",
            "usage": usage_out.model_dump() if usage_out else None,
            "finish_reason": finish_reason,
            "llm_request_id": rid_str,
        }
        yield _sse_line(done_payload)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
