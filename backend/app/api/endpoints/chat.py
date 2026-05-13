"""Chat API：POST /chat/completions（LiteLLM 統一支援 OpenAI / Gemini / 台智雲）"""
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Annotated, cast
from uuid import UUID

import aiohttp
import litellm
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.endpoints.source_files import _check_agent_access
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.chat_service import (
    _build_messages,
    _get_selected_source_files_content,
    _inject_user_message_images_into_messages,
    _merge_system_into_first_user,
    _parse_optional_chat_thread_id,
)
from app.services.agent_usage import log_agent_usage
from app.services.llm_service import (
    UsageMeta,
    _get_llm_params,
    _get_provider_name,
    _persist_chat_llm_request,
    _twcc_model_id,
)
from app.services.llm_caller import build_llm_kwargs_resolved
from app.services.llm_utils import apply_api_base

router = APIRouter()
logger = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""

    class Config:
        extra = "ignore"  # 忽略 meta 等額外欄位


class ChatRequest(BaseModel):
    agent_id: str = ""
    # project_id / schema_id：僅供 chat_compute_tool.py（BI 計算工具 endpoint）使用，
    # chat.py 本身的 /completions 與 /completions-stream 不使用這兩個欄位。
    project_id: str = ""
    schema_id: str = ""
    prompt_type: str = ""  # chat_agent / knowledge / cs / quotation_parse / quotation_share → 對應 config/*.md
    system_prompt: str = ""
    user_prompt: str = ""
    data: str = ""  # Chat Agent 等：前端可傳純文字參考（如本頁上傳檔），與後端組出之資料合併後一併受長度上限檢查
    model: str = ""
    messages: list[ChatMessage] = []
    chat_thread_id: str = ""
    trace_id: str = ""
    #: 本輪 user 訊息之 DB id；有圖片附件時後端會從 stored_files 讀取像素組入最後一則 user（OpenAI / Gemini 多模態）
    user_message_id: str = ""
    content: str  # 新使用者訊息
    selected_doc_ids: list[int] = []  # KM Agent：使用者勾選的文件 ID
    knowledge_base_id: int | None = None  # CS Agent：指定知識庫 ID（優先於 selected_doc_ids）
    bot_id: int | None = None  # Knowledge Bot Agent：指定 Bot ID


class ChatResponse(BaseModel):
    content: str
    model: str = ""
    usage: UsageMeta | None = None
    finish_reason: str | None = None
    llm_request_id: str | None = None


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
    agent_id: str = "chat"
    sources: list[dict] = field(default_factory=list)
    faq_direct_answer: str | None = None  # 已棄用，保留相容
    faq_candidates: list | None = None    # direct 模式：候選 [(KmChunk, float), ...]
    knowledge_base_id: int | None = None  # 用於 km_query_logs
    context_chunk_ids: list[str] = field(default_factory=list)  # RAG 命中的 chunk UUID 字串
    bot_fallback_message: str | None = None
    bot_fallback_message_enabled: bool = False


def _prepare_chat_completion(req: ChatRequest, db: Session, current: User) -> ChatCompletionPrepared:
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    tenant_id, aid = _check_agent_access(db, current, req.agent_id.strip())
    trace_raw = (req.trace_id or "").strip() or None
    thread_uuid = _parse_optional_chat_thread_id(db, current, tenant_id, aid, req.chat_thread_id)

    # 用於 km_query_logs
    _km_kb_id: int | None = None
    _km_chunk_ids: list[str] = []

    # 若前端未帶 prompt_type，以 aid 作為 fallback（確保 Chat Agent 等一對一對應的 agent 永遠載到對應 system prompt）
    pt = (req.prompt_type or "").strip() or aid
    if pt != (req.prompt_type or "").strip():
        req = req.model_copy(update={"prompt_type": pt})

    # Knowledge Bot Agent：多 KB RAG，bot_id 優先於其他 KM/CS 分支
    kb_model_name: str | None = None
    kb_system_prompt: str | None = None
    kb_fallback_message: str | None = None
    kb_fallback_message_enabled: bool = False
    km_sources: list[dict] = []
    if req.bot_id is not None:
        from app.models.bot import Bot
        from app.services.bot_rag_service import prepare_bot_rag_messages

        bot = db.query(Bot).filter(
            Bot.id == req.bot_id,
            Bot.tenant_id == tenant_id,
        ).first()
        if not bot:
            raise HTTPException(status_code=404, detail="Bot 不存在")
        if not bot.is_active:
            raise HTTPException(status_code=403, detail="此 Bot 已停用")

        history = [{"role": m.role, "content": m.content} for m in req.messages]
        bot_ctx = prepare_bot_rag_messages(
            bot,
            req.content,
            history,
            db,
            tenant_id,
            user_id=current.id,
            skip_scope_check=False,  # 內部用戶走正常 scope 檢查
            agent_id="knowledge-bot",
        )
        # 將 bot_rag_service 的結果轉換成 _prepare_chat_completion 需要的變數
        data = bot_ctx.rag_context_text
        km_sources = bot_ctx.sources
        _km_chunk_ids = bot_ctx.context_chunk_ids
        kb_model_name = bot_ctx.model or None
        kb_system_prompt = bot_ctx.system_prompt_used
        kb_fallback_message = (bot.fallback_message or "").strip() or None
        kb_fallback_message_enabled = bot.fallback_message_enabled or False

    # KM Agent & Chat Service Agent & KB Manager：RAG 向量檢索，不使用 source_files
    elif aid in ("knowledge", "cs", "kb-manager"):
        from app.services.km_service import format_km_context, km_retrieve_sync

        chunks = km_retrieve_sync(
            req.content, db, tenant_id, current.id,
            selected_doc_ids=req.selected_doc_ids or [],
            knowledge_base_id=req.knowledge_base_id,
            agent_id=aid,
        )
        data = format_km_context(chunks)
        if chunks:
            logger.info("KM RAG: retrieved %d chunks for query", len(chunks))
            _km_kb_id = req.knowledge_base_id
            _km_chunk_ids = [str(c.id) for c in chunks]
            seen: set[str] = set()
            for chunk in chunks:
                fname = chunk.document.filename if chunk.document else "未知文件"
                if fname not in seen:
                    seen.add(fname)
                    km_sources.append({"filename": fname})
        else:
            _km_kb_id = req.knowledge_base_id
            logger.info("KM RAG: no relevant chunks found (tenant=%r, user=%s)", tenant_id, current.id)

        # 讀取 KB 設定的 model、system_prompt、answer_mode
        if req.knowledge_base_id:
            from app.models.km_knowledge_base import KmKnowledgeBase
            kb = db.query(KmKnowledgeBase).filter(
                KmKnowledgeBase.id == req.knowledge_base_id,
                KmKnowledgeBase.tenant_id == tenant_id,
            ).first()
            if kb:
                kb_model_name = (kb.model_name or "").strip() or None
                kb_system_prompt = (kb.system_prompt or "").strip() or None

                # direct 模式：RRF 撈候選 → 交給 async endpoint 做 LLM 選取
                if getattr(kb, 'answer_mode', 'rag') == 'direct':
                    from app.services.km_service import FAQ_TOP_K, km_faq_retrieve_sync

                    direct_model = kb_model_name or (req.model or "").strip()
                    direct_litellm, direct_key, direct_base = ("", None, None)
                    if direct_model:
                        direct_litellm, direct_key, direct_base = _get_llm_params(
                            direct_model, db=db, tenant_id=tenant_id
                        )

                    candidates = km_faq_retrieve_sync(
                        req.content, db, tenant_id, current.id,
                        req.knowledge_base_id, top_k=FAQ_TOP_K,
                    )
                    return ChatCompletionPrepared(
                        tenant_id=tenant_id,
                        messages=[],
                        model=direct_model,
                        litellm_model=direct_litellm,
                        api_key=direct_key or "__faq_direct__",
                        api_base=direct_base,
                        thread_uuid=thread_uuid,
                        trace_raw=trace_raw,
                        user_id=current.id,
                        has_vision_user_content=False,
                        agent_id=aid,
                        sources=[
                            {"filename": c.document.filename}
                            for c, _ in candidates if c.document
                        ],
                        faq_candidates=candidates,
                        knowledge_base_id=req.knowledge_base_id,
                    )
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

    if data_len == 0 and aid != "knowledge":
        logger.warning(
            "chat_completions: 無參考資料 (agent_id=%r, tenant_id=%r, aid=%r, user_id=%s) - 請在該 agent 頁面左欄上傳並勾選來源檔案",
            req.agent_id,
            tenant_id,
            aid,
            current.id,
        )
    elif data_len > 0:
        logger.info("chat_completions: 已載入參考資料 %d 字元", data_len)

    # KB 設定的 model 優先；其次前端傳入的 model；兩者皆空則報錯
    model = kb_model_name or (req.model or "").strip()
    if not model:
        raise HTTPException(
            status_code=400,
            detail="未指定模型，請在知識庫設定中選擇模型，或在 AI 設定中選擇模型",
        )
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

    messages = _build_messages(req, data=data, kb_system_prompt=kb_system_prompt)
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
        agent_id=aid,
        sources=km_sources,
        knowledge_base_id=_km_kb_id,
        context_chunk_ids=_km_chunk_ids,
        bot_fallback_message=kb_fallback_message if req.bot_id is not None else None,
        bot_fallback_message_enabled=kb_fallback_message_enabled if req.bot_id is not None else False,
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


# ─── RAG hit / [NOT_FOUND] marker ────────────────────────────────────────────
_NOT_FOUND_MARKER = "[NOT_FOUND]"
_NOT_FOUND_KM_MSG = "根據目前的知識庫文件，找不到相關資訊。"
_NOT_FOUND_CS_MSG = "很抱歉，目前的知識庫中未找到相關資訊，建議您聯繫客服專員進一步協助。"


def _rag_hit_from_response(content: str | None, context_chunk_ids: list[str]) -> bool:
    """判斷 RAG 查詢是否命中。
    1. 無任何 chunk 被擷取 → False
    2. LLM 回傳含 [NOT_FOUND] marker → False
    3. 其餘 → True
    """
    if not context_chunk_ids:
        return False
    if _NOT_FOUND_MARKER in (content or ""):
        return False
    return True


def _clean_rag_response(
    content: str | None,
    agent_type: str | None = None,
    fallback_message: str | None = None,
    fallback_message_enabled: bool = False,
) -> str:
    """若 LLM 回傳 [NOT_FOUND] marker，替換成用戶友善的訊息。
    若 Bot 設定了啟用的 fallback_message，優先使用它。
    """
    if content and _NOT_FOUND_MARKER in content:
        if fallback_message_enabled and fallback_message and fallback_message.strip():
            return fallback_message.strip()
        if agent_type == "cs":
            return _NOT_FOUND_CS_MSG
        return _NOT_FOUND_KM_MSG
    return content or ""


@router.post("/completions", response_model=ChatResponse)
async def chat_completions(
    req: ChatRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    logger.info(f"chat_completions: model={req.model!r}, content_len={len(req.content) if req.content else 0}")
    try:
        prepared = _prepare_chat_completion(req, db, current)

        # direct 模式：LLM 選取 FAQ → 原文回傳
        if prepared.faq_candidates is not None:
            from app.services.km_service import (
                km_faq_llm_select, extract_faq_question, extract_faq_answer,
            )
            candidates = prepared.faq_candidates
            if candidates and prepared.model:
                selected, llm_usage, llm_latency = await km_faq_llm_select(
                    req.content, candidates, prepared.model, db, prepared.tenant_id
                )
            else:
                selected, llm_usage, llm_latency = candidates, None, 0

            if not selected:
                faq_answer = "根據目前的知識庫，找不到相關資訊。"
            else:
                parts = []
                for chunk, _ in selected:
                    q = extract_faq_question(chunk.content)
                    a = extract_faq_answer(chunk.content)
                    parts.append(f"**Q: {q}**\n\n{a}" if q else f"**Q:**\n\n{a}")
                sources_text = "\n".join(
                    f"- {c.document.filename}"
                    for c, _ in selected if c.document
                )
                faq_answer = (
                    "以下可能是你需要的答案：\n\n"
                    + "\n\n---\n\n".join(parts)
                    + (f"\n\n---\n**參考來源：**\n{sources_text}" if sources_text else "")
                )

            # Layer 1：記錄 LLM 用量
            if prepared.thread_uuid:
                _persist_chat_llm_request(
                    db,
                    tenant_id=prepared.tenant_id,
                    user_id=prepared.user_id,
                    thread_id=prepared.thread_uuid,
                    model=prepared.model or "faq-direct",
                    trace_id=prepared.trace_raw,
                    latency_ms=llm_latency,
                    status="success",
                    usage=llm_usage,
                    finish_reason="stop",
                    error_code=None,
                    error_message=None,
                    agent_id=prepared.agent_id,
                )
                db.commit()
            else:
                log_agent_usage(
                    db=db,
                    agent_type=prepared.agent_id,
                    tenant_id=prepared.tenant_id,
                    user_id=prepared.user_id,
                    model=prepared.model or None,
                    prompt_tokens=llm_usage.prompt_tokens if llm_usage else None,
                    completion_tokens=llm_usage.completion_tokens if llm_usage else None,
                    total_tokens=llm_usage.total_tokens if llm_usage else None,
                    latency_ms=llm_latency,
                    status="success",
                )
                db.commit()

            # Layer 2：記錄 KB 查詢結果
            if prepared.knowledge_base_id:
                from app.services.km_service import log_km_query
                log_km_query(
                    db,
                    tenant_id=prepared.tenant_id,
                    user_id=prepared.user_id,
                    knowledge_base_id=prepared.knowledge_base_id,
                    answer_mode="direct",
                    query=req.content or "",
                    hit=bool(selected),
                    matched_chunk_ids=[str(c.id) for c, _ in selected],
                    session_type="internal",
                    chat_thread_id=prepared.thread_uuid,
                )
                db.commit()

            return ChatResponse(
                content=faq_answer,
                model="faq-direct",
                usage=None,
                finish_reason="stop",
            )

        # FAQ 精確比對模式（舊路徑，保留相容）
        if prepared.faq_direct_answer is not None:
            return ChatResponse(
                content=prepared.faq_direct_answer,
                model="faq-direct",
                usage=None,
                finish_reason="stop",
            )

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
            url = (api_base or "").rstrip("/")
            if not url:
                raise HTTPException(
                    status_code=503,
                    detail="台智雲 TWCC_API_BASE 未設定，請在管理介面（租戶 LLM 設定）設定",
                )
            model_id = _twcc_model_id(model[5:])
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
                        agent_id=req.agent_id,
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
                    agent_id=req.agent_id,
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

        completion_kwargs = build_llm_kwargs_resolved(
            litellm_model=litellm_model,
            api_key=api_key,
            api_base=api_base,
            original_model=model,
            messages=messages,
            stream=False,
            temperature=0,
            timeout=vision_timeout,
        )

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
                    agent_id=req.agent_id,
                )
                db.commit()
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
                agent_id=req.agent_id,
            )
            db.commit()
            rid_str = str(rid)

        # Layer 2：記錄 KB 查詢結果（RAG 路徑，step 4：以 LLM 回傳內容判斷 hit）
        if prepared.knowledge_base_id:
            from app.services.km_service import log_km_query
            _rag_hit = _rag_hit_from_response(parsed.content, prepared.context_chunk_ids)
            log_km_query(
                db,
                tenant_id=prepared.tenant_id,
                user_id=prepared.user_id,
                knowledge_base_id=prepared.knowledge_base_id,
                answer_mode="rag",
                query=req.content or "",
                hit=_rag_hit,
                matched_chunk_ids=prepared.context_chunk_ids,
                session_type="internal",
                chat_thread_id=prepared.thread_uuid,
            )
            db.commit()

        clean_content = _clean_rag_response(
            parsed.content,
            prepared.agent_id,
            fallback_message=prepared.bot_fallback_message,
            fallback_message_enabled=prepared.bot_fallback_message_enabled,
        )
        return ChatResponse(
            content=clean_content,
            model=parsed.model,
            usage=parsed.usage,
            finish_reason=parsed.finish_reason,
            llm_request_id=rid_str,
        )
    except HTTPException:
        raise
    except Exception as e:
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

    # direct 模式：LLM 選取 FAQ → SSE 原文回傳
    if prepared.faq_candidates is not None:
        from app.services.km_service import (
            km_faq_llm_select, extract_faq_question, extract_faq_answer,
        )
        candidates = prepared.faq_candidates
        if candidates and prepared.model:
            selected, llm_usage, llm_latency = await km_faq_llm_select(
                req.content, candidates, prepared.model, db, prepared.tenant_id
            )
        else:
            selected, llm_usage, llm_latency = candidates, None, 0

        if not selected:
            faq_answer = "根據目前的知識庫，找不到相關資訊。"
        else:
            parts = []
            for chunk, _ in selected:
                q = extract_faq_question(chunk.content)
                a = extract_faq_answer(chunk.content)
                parts.append(f"**Q: {q}**\n\n{a}" if q else f"**Q:**\n\n{a}")
            sources_text = "\n".join(
                f"- {c.document.filename}"
                for c, _ in selected if c.document
            )
            faq_answer = (
                "以下可能是你需要的答案：\n\n"
                + "\n\n---\n\n".join(parts)
                + (f"\n\n---\n**參考來源：**\n{sources_text}" if sources_text else "")
            )

        # Layer 1：記錄 LLM 用量
        if prepared.thread_uuid:
            _persist_chat_llm_request(
                db,
                tenant_id=prepared.tenant_id,
                user_id=prepared.user_id,
                thread_id=prepared.thread_uuid,
                model=prepared.model or "faq-direct",
                trace_id=prepared.trace_raw,
                latency_ms=llm_latency,
                status="success",
                usage=llm_usage,
                finish_reason="stop",
                error_code=None,
                error_message=None,
                agent_id=prepared.agent_id,
            )
            db.commit()
        else:
            log_agent_usage(
                db=db,
                agent_type=prepared.agent_id,
                tenant_id=prepared.tenant_id,
                user_id=prepared.user_id,
                model=prepared.model or None,
                prompt_tokens=llm_usage.prompt_tokens if llm_usage else None,
                completion_tokens=llm_usage.completion_tokens if llm_usage else None,
                total_tokens=llm_usage.total_tokens if llm_usage else None,
                latency_ms=llm_latency,
                status="success",
            )
            db.commit()

        # Layer 2：記錄 KB 查詢結果（direct 路徑，stream）
        if prepared.knowledge_base_id:
            from app.services.km_service import log_km_query
            log_km_query(
                db,
                tenant_id=prepared.tenant_id,
                user_id=prepared.user_id,
                knowledge_base_id=prepared.knowledge_base_id,
                answer_mode="direct",
                query=req.content or "",
                hit=bool(selected),
                matched_chunk_ids=[str(c.id) for c, _ in selected],
                session_type="internal",
                chat_thread_id=prepared.thread_uuid,
            )
            db.commit()

        async def faq_sse():
            yield _sse_line({"event": "delta", "text": faq_answer})
            yield _sse_line({
                "event": "done", "content": faq_answer, "model": "faq-direct",
                "finish_reason": "stop", "usage": None,
                "sources": prepared.sources,
            })

        return StreamingResponse(faq_sse(), media_type="text/event-stream")

    # FAQ 精確比對模式（舊路徑，保留相容）
    if prepared.faq_direct_answer is not None:
        faq_answer = prepared.faq_direct_answer

        async def faq_sse():
            yield _sse_line({"event": "delta", "text": faq_answer})
            yield _sse_line({"event": "done", "content": faq_answer, "model": "faq-direct",
                             "finish_reason": "stop", "usage": None})

        return StreamingResponse(faq_sse(), media_type="text/event-stream")

    # _prepare_chat_completion 中 km_retrieve_sync 會 flush embedding usage log，
    # 但 event_gen() 之後改用新 SessionLocal，原始 db session 不再 commit，
    # 故在此立即 commit 確保 embedding log 持久化。
    try:
        db.commit()
    except Exception:
        pass

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
                    agent_id=prepared.agent_id,
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
                    agent_id=prepared.agent_id,
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
                stream_timeout = 240 if prepared.has_vision_user_content else 120
                completion_kwargs = build_llm_kwargs_resolved(
                    litellm_model=prepared.litellm_model,
                    api_key=prepared.api_key,
                    api_base=prepared.api_base,
                    original_model=prepared.model,
                    messages=prepared.messages,
                    stream=True,
                    temperature=0,
                    timeout=stream_timeout,
                    # 讓 LiteLLM 在串流結束後補送含 usage 的空 chunk（OpenAI / Gemini 皆適用）
                    stream_options={"include_usage": True},
                )
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
        # Ollama streaming 不回傳 usage → 字元數估算（monitoring 用，非計費）
        if usage_out is None and prepared.model.startswith("local/"):
            prompt_chars = sum(len(str(m.get("content", ""))) for m in prepared.messages)
            completion_chars = len(full)
            usage_out = UsageMeta(
                prompt_tokens=prompt_chars // 3,
                completion_tokens=completion_chars // 3,
                total_tokens=(prompt_chars + completion_chars) // 3,
            )
        rid_str = persist_ok(usage_out, finish_reason)

        # Layer 2：記錄 KB 查詢結果（RAG 路徑，stream，step 4：以完整回應判斷 hit）
        if prepared.knowledge_base_id:
            from app.services.km_service import log_km_query
            s = SessionLocal()
            try:
                _rag_hit = _rag_hit_from_response("".join(parts), prepared.context_chunk_ids)
                log_km_query(
                    s,
                    tenant_id=prepared.tenant_id,
                    user_id=prepared.user_id,
                    knowledge_base_id=prepared.knowledge_base_id,
                    answer_mode="rag",
                    query=req.content or "",
                    hit=_rag_hit,
                    matched_chunk_ids=prepared.context_chunk_ids,
                    session_type="internal",
                    chat_thread_id=prepared.thread_uuid,
                )
                s.commit()
            except Exception as _log_err:
                logger.warning("km_query_log 寫入失敗: %s", _log_err)
            finally:
                s.close()

        clean_full = _clean_rag_response(
            full,
            prepared.agent_id,
            fallback_message=prepared.bot_fallback_message,
            fallback_message_enabled=prepared.bot_fallback_message_enabled,
        )
        done_payload = {
            "event": "done",
            "content": clean_full,
            "model": resp_model or "",
            "usage": usage_out.model_dump() if usage_out else None,
            "finish_reason": finish_reason,
            "llm_request_id": rid_str,
            "sources": prepared.sources,
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
