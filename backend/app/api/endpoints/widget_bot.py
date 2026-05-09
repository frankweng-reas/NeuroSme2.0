"""Widget Bot API：以 Bot public_token 驗證，無需登入"""
import json
import logging
import time
from datetime import datetime, timezone
from typing import AsyncIterator

import litellm
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models.bot import Bot, BotKnowledgeBase
from app.models.bot_widget_session import BotWidgetMessage, BotWidgetSession
from app.services.agent_usage import log_agent_usage
from app.services.chat_service import _load_system_prompt_from_file
from app.services.km_service import format_km_context, km_retrieve_sync
from app.services.llm_service import _get_llm_params, _get_provider_name
from app.services.llm_utils import apply_api_base

router = APIRouter()
logger = logging.getLogger(__name__)


# ── helpers ───────────────────────────────────────────────────────────────────


def _get_bot_by_token(token: str, db: Session) -> Bot:
    bot = db.query(Bot).filter(Bot.public_token == token).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Widget 不存在或已停用")
    if not bot.is_active:
        raise HTTPException(status_code=403, detail="此 Bot 已停用")
    return bot


# ── Schemas ───────────────────────────────────────────────────────────────────


class BotWidgetInfoResponse(BaseModel):
    bot_id: int
    title: str
    logo_url: str | None
    color: str
    lang: str
    is_active: bool

    model_config = {"from_attributes": True}


class SessionCreateRequest(BaseModel):
    session_id: str
    visitor_name: str | None = None
    visitor_email: str | None = None
    visitor_phone: str | None = None


class SessionResponse(BaseModel):
    session_id: str
    visitor_name: str | None
    visitor_email: str | None
    visitor_phone: str | None
    created_at: str


class BotWidgetChatRequest(BaseModel):
    session_id: str
    messages: list[dict] = []
    content: str


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/{token}/info", response_model=BotWidgetInfoResponse)
def bot_widget_info(token: str, db: Session = Depends(get_db)):
    """取得 Bot Widget 基本設定"""
    bot = _get_bot_by_token(token, db)
    return BotWidgetInfoResponse(
        bot_id=bot.id,
        title=bot.widget_title or bot.name,
        logo_url=bot.widget_logo_url,
        color=bot.widget_color or "#1A3A52",
        lang=bot.widget_lang or "zh-TW",
        is_active=bot.is_active,
    )


@router.get("/{token}/session/{session_id}")
def check_session(token: str, session_id: str, db: Session = Depends(get_db)):
    bot = _get_bot_by_token(token, db)
    session = db.query(BotWidgetSession).filter(
        BotWidgetSession.id == session_id,
        BotWidgetSession.bot_id == bot.id,
    ).first()
    return {"valid": session is not None}


@router.post("/{token}/session", response_model=SessionResponse, status_code=201)
def create_or_update_session(
    token: str,
    body: SessionCreateRequest,
    db: Session = Depends(get_db),
):
    bot = _get_bot_by_token(token, db)

    session = db.query(BotWidgetSession).filter(BotWidgetSession.id == body.session_id).first()
    if session:
        if body.visitor_name is not None:
            session.visitor_name = body.visitor_name
        if body.visitor_email is not None:
            session.visitor_email = body.visitor_email
        if body.visitor_phone is not None:
            session.visitor_phone = body.visitor_phone
        session.last_active_at = datetime.now(timezone.utc)
    else:
        session = BotWidgetSession(
            id=body.session_id,
            bot_id=bot.id,
            visitor_name=body.visitor_name,
            visitor_email=body.visitor_email,
            visitor_phone=body.visitor_phone,
        )
        db.add(session)

    db.commit()
    db.refresh(session)
    return SessionResponse(
        session_id=session.id,
        visitor_name=session.visitor_name,
        visitor_email=session.visitor_email,
        visitor_phone=session.visitor_phone,
        created_at=session.created_at.isoformat(),
    )


@router.post("/{token}/chat")
async def bot_widget_chat(
    token: str,
    body: BotWidgetChatRequest,
    db: Session = Depends(get_db),
):
    """Bot Widget 對話（SSE streaming）"""
    bot = _get_bot_by_token(token, db)

    bot_id: int = bot.id
    bot_tenant_id: str = bot.tenant_id
    bot_model_name: str = (bot.model_name or "").strip()
    bot_system_prompt: str | None = (bot.system_prompt or "").strip() or None

    if not bot_model_name:
        raise HTTPException(status_code=400, detail="此 Bot 尚未設定模型，請聯繫管理員")

    litellm_model, api_key, api_base = _get_llm_params(
        bot_model_name, db=db, tenant_id=bot_tenant_id
    )
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(bot_model_name)} API Key 未設定",
        )

    # 取得 Bot 關聯的 KB ids
    kb_ids = [
        row.knowledge_base_id
        for row in db.query(BotKnowledgeBase)
        .filter(BotKnowledgeBase.bot_id == bot_id)
        .order_by(BotKnowledgeBase.sort_order)
        .all()
    ]

    # RAG 多 KB 聯合檢索
    context_text = ""
    try:
        chunks = km_retrieve_sync(
            query=body.content,
            tenant_id=bot_tenant_id,
            db=db,
            knowledge_base_ids=kb_ids if kb_ids else None,
            skip_scope_check=True,
            agent_id="knowledge-bot",
        )
        if chunks:
            context_text = format_km_context(chunks, show_source=False)
    except Exception as e:
        logger.warning("Bot Widget RAG 失敗，略過參考資料: %s", e)

    # 組 messages
    msgs: list[dict] = []
    system_parts: list[str] = []

    if bot_system_prompt:
        system_parts.append(bot_system_prompt)
    else:
        file_prompt = _load_system_prompt_from_file("cs")
        if file_prompt:
            system_parts.append(file_prompt)

    if context_text:
        system_parts.append(f"以下為參考資料：\n\n{context_text}")

    if system_parts:
        msgs.append({"role": "system", "content": "\n\n".join(system_parts)})

    MAX_HISTORY = 6
    history = body.messages[-MAX_HISTORY:] if len(body.messages) > MAX_HISTORY else body.messages
    for m in history:
        msgs.append({"role": m["role"], "content": m["content"]})

    msgs.append({"role": "user", "content": body.content})

    session = db.query(BotWidgetSession).filter(BotWidgetSession.id == body.session_id).first()
    if session:
        session.last_active_at = datetime.now(timezone.utc)
    db.add(BotWidgetMessage(session_id=body.session_id, role="user", content=body.content))
    db.commit()

    is_local_model = bot_model_name.startswith("local/")
    session_id = body.session_id
    tenant_id_for_log = bot_tenant_id

    async def generate() -> AsyncIterator[str]:
        t0 = time.perf_counter()
        llm_status = "success"
        usage_out: tuple[int, int, int] | None = None
        try:
            kwargs: dict = {
                "model": litellm_model,
                "messages": msgs,
                "stream": True,
                "stream_options": {"include_usage": True},
                "api_key": api_key,
                "temperature": 0.3,
            }
            apply_api_base(kwargs, api_base)
            if is_local_model:
                kwargs["think"] = False

            response = await litellm.acompletion(**kwargs)
            full_text = ""
            async for chunk in response:
                if not chunk.choices:
                    u = getattr(chunk, "usage", None)
                    if u is not None:
                        try:
                            usage_out = (
                                int(getattr(u, "prompt_tokens", None) or 0),
                                int(getattr(u, "completion_tokens", None) or 0),
                                int(getattr(u, "total_tokens", None) or 0),
                            )
                        except (TypeError, ValueError):
                            pass
                    continue
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_text += delta
                    yield f"data: {json.dumps({'event': 'delta', 'text': delta}, ensure_ascii=False)}\n\n"
                u = getattr(chunk, "usage", None)
                if u is not None:
                    try:
                        pt = getattr(u, "prompt_tokens", None)
                        ct = getattr(u, "completion_tokens", None)
                        tt = getattr(u, "total_tokens", None)
                        if pt is not None or ct is not None or tt is not None:
                            usage_out = (int(pt or 0), int(ct or 0), int(tt or 0))
                    except (TypeError, ValueError):
                        pass

            yield f"data: {json.dumps({'event': 'done', 'content': full_text}, ensure_ascii=False)}\n\n"

            if full_text:
                try:
                    db.add(BotWidgetMessage(session_id=session_id, role="assistant", content=full_text))
                    db.commit()
                except Exception as save_err:
                    logger.warning("儲存 assistant 訊息失敗: %s", save_err)
        except Exception as e:
            llm_status = "error"
            logger.error("Bot Widget chat 錯誤: %s", e)
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
        finally:
            s = SessionLocal()
            try:
                log_agent_usage(
                    db=s,
                    agent_type="knowledge-bot",
                    tenant_id=tenant_id_for_log,
                    model=bot_model_name,
                    prompt_tokens=usage_out[0] if usage_out else None,
                    completion_tokens=usage_out[1] if usage_out else None,
                    total_tokens=usage_out[2] if usage_out else None,
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                    status=llm_status,
                )
                s.commit()
            except Exception as log_err:
                logger.warning("Bot Widget LLM usage log 失敗: %s", log_err)
            finally:
                s.close()

    return StreamingResponse(generate(), media_type="text/event-stream")
