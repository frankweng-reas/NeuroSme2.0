"""Chat API：POST /chat/completions（LiteLLM 統一支援 OpenAI / Gemini / 台智雲）"""
import json
import logging
import os
import time
from dataclasses import dataclass
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
    _parse_optional_chat_thread_id,
)
from app.services.llm_service import (
    UsageMeta,
    _get_llm_params,
    _get_provider_name,
    _persist_chat_llm_request,
    _twcc_model_id,
)
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
    prompt_type: str = ""  # chat_agent → system_prompt_chat_agent.md；空或 analysis → system_prompt_analysis.md
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


def _prepare_chat_completion(req: ChatRequest, db: Session, current: User) -> ChatCompletionPrepared:
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    tenant_id, aid = _check_agent_access(db, current, req.agent_id.strip())
    trace_raw = (req.trace_id or "").strip() or None
    thread_uuid = _parse_optional_chat_thread_id(db, current, tenant_id, aid, req.chat_thread_id)

    pt = (req.prompt_type or "").strip()

    # KM Agent & Chat Service Agent：RAG 向量檢索，不使用 source_files
    kb_model_name: str | None = None
    kb_system_prompt: str | None = None
    if aid in ("knowledge", "cs"):
        from app.services.km_service import format_km_context, km_retrieve_sync

        chunks = km_retrieve_sync(
            req.content, db, tenant_id, current.id,
            selected_doc_ids=req.selected_doc_ids or [],
            knowledge_base_id=req.knowledge_base_id,
        )
        data = format_km_context(chunks)
        if chunks:
            logger.info("KM RAG: retrieved %d chunks for query", len(chunks))
        else:
            logger.info("KM RAG: no relevant chunks found (tenant=%r, user=%s)", tenant_id, current.id)

        # 讀取 KB 設定的 model 與 system_prompt
        if req.knowledge_base_id:
            from app.models.km_knowledge_base import KmKnowledgeBase
            kb = db.query(KmKnowledgeBase).filter(
                KmKnowledgeBase.id == req.knowledge_base_id,
                KmKnowledgeBase.tenant_id == tenant_id,
            ).first()
            if kb:
                kb_model_name = (kb.model_name or "").strip() or None
                kb_system_prompt = (kb.system_prompt or "").strip() or None
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
        apply_api_base(completion_kwargs, api_base)
        if model.startswith("local/"):
            completion_kwargs["think"] = False

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
                    # 讓 LiteLLM 在串流結束後補送含 usage 的空 chunk（OpenAI / Gemini 皆適用）
                    "stream_options": {"include_usage": True},
                }
                apply_api_base(completion_kwargs, prepared.api_base)
                # Ollama thinking models 預設啟用 thinking mode，需停用以避免延遲
                # 必須用 ollama_chat/ 走原生 /api/chat（OpenAI-compatible /v1 不支援 think 參數）
                if prepared.model.startswith("local/"):
                    completion_kwargs["think"] = False
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
