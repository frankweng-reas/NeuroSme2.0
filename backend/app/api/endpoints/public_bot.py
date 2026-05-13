"""公開 Bot API：外部 App 透過 API Key 呼叫 Bot 知識庫問答（RAG）

端點：POST /api/v1/public/bot/query
認證：X-API-Key header
"""
import logging
from datetime import date, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.api_key_auth import get_api_key
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.api_key import ApiKey, ApiKeyUsage
from app.models.bot import Bot, BotKnowledgeBase
from app.services.agent_usage import log_agent_usage
from app.services.bot_rag_service import apply_bot_fallback, prepare_bot_rag_messages, rag_hit
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, call_llm
from app.services.llm_service import UsageMeta

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 10


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class BotMessage(BaseModel):
    role: str = "user"
    content: str = ""

    class Config:
        extra = "ignore"


class BotQueryRequest(BaseModel):
    bot_id: int | None = Field(None, description="Bot ID；若 API Key 已綁定特定 Bot 則可省略")
    question: str = Field(..., min_length=1, description="使用者問題")
    messages: list[BotMessage] = Field(
        default_factory=list,
        description="對話歷史（最多保留近 10 輪）",
    )
    model: str = Field(
        default="",
        description="覆寫模型名稱。留空時使用 Bot 設定的模型。",
    )


class BotSource(BaseModel):
    filename: str
    excerpt: str


class BotQueryResponse(BaseModel):
    answer: str
    sources: list[BotSource]
    usage: UsageMeta | None = None
    model: str = ""


# ──────────────────────────────────────────────────────────────────────────────
# Usage tracking helper
# ──────────────────────────────────────────────────────────────────────────────


def _record_usage(
    db: Session,
    api_key_id: int,
    input_tokens: int,
    output_tokens: int,
) -> None:
    today = date.today()
    row = db.query(ApiKeyUsage).filter(
        ApiKeyUsage.api_key_id == api_key_id,
        ApiKeyUsage.date == today,
    ).first()
    if row:
        row.request_count += 1
        row.input_tokens += input_tokens
        row.output_tokens += output_tokens
    else:
        row = ApiKeyUsage(
            api_key_id=api_key_id,
            date=today,
            request_count=1,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        db.add(row)
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# Route
# ──────────────────────────────────────────────────────────────────────────────


@router.post(
    "/query",
    response_model=BotQueryResponse,
    summary="Bot 知識庫問答",
    description=(
        "透過 API Key 呼叫 Bot RAG 問答。"
        "僅能查詢屬於 API Key 對應 tenant 的 Bot。"
        "Rate limit：每個 API Key 每小時最多 100 次請求。"
    ),
    response_description="AI 回答、參考來源與 token 用量",
)
@limiter.limit("100/hour")
async def bot_query(
    request: Request,
    body: BotQueryRequest,
    db: Annotated[Session, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(get_api_key)],
):
    tenant_id = api_key.tenant_id

    # 決定 bot_id：Key 綁定的優先；否則從 body 取
    if api_key.bot_id is not None:
        resolved_bot_id = api_key.bot_id
        # 如果 body 也帶了 bot_id，必須一致
        if body.bot_id is not None and body.bot_id != api_key.bot_id:
            raise HTTPException(status_code=403, detail="此 API Key 僅限查詢 Bot ID " + str(api_key.bot_id))
    elif body.bot_id is not None:
        resolved_bot_id = body.bot_id
    else:
        raise HTTPException(status_code=400, detail="請提供 bot_id（此 Key 未綁定特定 Bot）")

    # 確認 Bot 屬於此 tenant 且為啟用狀態
    bot = db.query(Bot).filter(
        Bot.id == resolved_bot_id,
        Bot.tenant_id == tenant_id,
    ).first()
    if not bot:
        raise HTTPException(status_code=404, detail="bot_id 不存在或不屬於此 tenant")
    if not bot.is_active:
        raise HTTPException(status_code=403, detail="此 Bot 已停用")

    # 取得 Bot 關聯的 KB ID 列表
    kb_links = (
        db.query(BotKnowledgeBase)
        .filter(BotKnowledgeBase.bot_id == bot.id)
        .order_by(BotKnowledgeBase.sort_order)
        .all()
    )
    kb_ids = [link.knowledge_base_id for link in kb_links]
    if not kb_ids:
        raise HTTPException(status_code=400, detail="此 Bot 尚未設定知識庫")

    # 共用 RAG 邏輯：多 KB 檢索 + system prompt + messages 組裝
    history = [{"role": m.role, "content": m.content} for m in body.messages]
    bot_ctx = prepare_bot_rag_messages(
        bot,
        body.question,
        history,
        db,
        tenant_id,
        skip_scope_check=True,
        agent_id="kb-bot-builder",
        max_history_turns=MAX_HISTORY_TURNS,
    )
    messages = bot_ctx.messages
    sources = [
        BotSource(filename=s["filename"], excerpt=s.get("excerpt", ""))
        for s in bot_ctx.sources
    ]

    # 決定模型（Bot 設定 > request body > 報錯）
    model = bot_ctx.model or (body.model or "").strip()
    if not model:
        raise HTTPException(
            status_code=400,
            detail="未指定模型，請在 Bot 設定選擇模型，或在請求中帶入 model 欄位",
        )

    # 組裝訊息（已由 bot_ctx.messages 完成）

    # 呼叫 LLM（統一走 llm_caller 共用層）
    llm_status = "success"
    try:
        answer, usage, latency_ms = await call_llm(
            model=model,
            messages=messages,
            db=db,
            tenant_id=tenant_id,
        )
    except LLMProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LLMCallError as exc:
        llm_status = "error"
        log_agent_usage(
            db=db, agent_type="kb-bot-builder", tenant_id=tenant_id,
            model=model, latency_ms=0, status="error",
        )
        logger.error("public bot_query error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    _record_usage(
        db,
        api_key_id=api_key.id,
        input_tokens=usage.prompt_tokens if usage else 0,
        output_tokens=usage.completion_tokens if usage else 0,
    )
    log_agent_usage(
        db=db,
        agent_type="kb-bot-builder",
        tenant_id=tenant_id,
        model=model,
        prompt_tokens=usage.prompt_tokens if usage else None,
        completion_tokens=usage.completion_tokens if usage else None,
        total_tokens=usage.total_tokens if usage else None,
        latency_ms=latency_ms,
        status=llm_status,
    )
    db.commit()

    _hit = rag_hit(answer, bot_ctx.context_chunk_ids)
    logger.info(
        "public bot_query: hit=%s, chunks=%d (bot_id=%s)",
        _hit, len(bot_ctx.context_chunk_ids), bot.id,
    )
    clean_answer = apply_bot_fallback(answer, bot)

    return BotQueryResponse(
        answer=clean_answer,
        sources=sources,
        usage=usage,
        model=model,
    )
