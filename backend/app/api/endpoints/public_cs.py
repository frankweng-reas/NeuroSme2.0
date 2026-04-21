"""公開 CS Agent API：外部 App 透過 API Key 呼叫知識庫問答（RAG）

端點：POST /api/v1/public/cs/query
認證：X-API-Key header（Bearer JWT 不適用）
"""
import logging
from datetime import date, timezone
from typing import Annotated

import litellm
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session

from app.core.api_key_auth import get_api_key
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.api_key import ApiKey, ApiKeyUsage
from app.models.km_knowledge_base import KmKnowledgeBase
from app.services.chat_service import _load_system_prompt_from_file
from app.services.km_service import format_km_context, km_retrieve_sync
from app.services.llm_service import UsageMeta, _get_llm_params, _get_provider_name
from app.services.llm_utils import apply_api_base

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 10


def _get_limiter():
    from app.main import limiter
    return limiter


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class CsMessage(BaseModel):
    role: str = "user"
    content: str = ""

    class Config:
        extra = "ignore"


class CsQueryRequest(BaseModel):
    knowledge_base_id: int = Field(..., description="知識庫 ID（需屬於此 API Key 對應的 tenant）")
    question: str = Field(..., min_length=1, description="使用者問題")
    messages: list[CsMessage] = Field(
        default_factory=list,
        description="對話歷史（最多保留近 10 輪）",
    )
    model: str = Field(
        default="",
        description="覆寫模型名稱。留空時使用知識庫設定的模型。",
    )


class CsSource(BaseModel):
    filename: str
    excerpt: str


class CsQueryResponse(BaseModel):
    answer: str
    sources: list[CsSource]
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
    """Upsert 每日用量（request_count +1, tokens 累加）"""
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
    response_model=CsQueryResponse,
    summary="CS Agent 知識庫問答",
    description=(
        "透過 API Key 呼叫 CS Agent RAG 問答。"
        "僅能查詢屬於 API Key 對應 tenant 的知識庫。"
        "Rate limit：每個 API Key 每小時最多 100 次請求。"
    ),
    response_description="AI 回答、參考來源與 token 用量",
)
@limiter.limit("100/hour")
async def cs_query(
    request: Request,
    body: CsQueryRequest,
    db: Annotated[Session, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(get_api_key)],
):
    tenant_id = api_key.tenant_id

    # 確認 KB 屬於此 tenant
    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == body.knowledge_base_id,
        KmKnowledgeBase.tenant_id == tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="knowledge_base_id 不存在或不屬於此 tenant")

    # RAG 檢索（skip_scope_check=True：外部 API 不做使用者文件權限過濾，只看 KB 範圍）
    chunks = km_retrieve_sync(
        body.question,
        db,
        tenant_id,
        user_id=0,
        knowledge_base_id=body.knowledge_base_id,
        skip_scope_check=True,
    )
    rag_context = format_km_context(chunks)
    logger.info("public cs_query: %d chunks retrieved (kb_id=%s)", len(chunks), body.knowledge_base_id)

    # 組裝 sources
    sources: list[CsSource] = []
    seen_files: set[str] = set()
    for chunk in chunks:
        fname = chunk.document.filename if chunk.document else "未知文件"
        if fname not in seen_files:
            seen_files.add(fname)
            sources.append(CsSource(filename=fname, excerpt=chunk.content.strip()[:200]))

    # 決定模型（KB 設定 > request body > 報錯）
    model = (kb.model_name or "").strip() or (body.model or "").strip()
    if not model:
        raise HTTPException(
            status_code=400,
            detail="未指定模型，請在知識庫設定選擇模型，或在請求中帶入 model 欄位",
        )

    litellm_model, llm_api_key, api_base = _get_llm_params(model, db=db, tenant_id=tenant_id)
    if not llm_api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(model)} API Key 未設定，請在 NeuroSme 管理介面設定對應的 key",
        )

    # 組裝訊息
    system_parts: list[str] = []
    kb_system = (kb.system_prompt or "").strip()
    if kb_system:
        system_parts.append(kb_system)
    else:
        file_prompt = _load_system_prompt_from_file("cs")
        if file_prompt:
            system_parts.append(file_prompt)
    if rag_context.strip():
        system_parts.append(f"以下為參考資料：\n\n{rag_context.strip()}")

    messages: list[dict] = []
    if system_parts:
        messages.append({"role": "system", "content": "\n\n".join(system_parts)})

    for m in body.messages[-(MAX_HISTORY_TURNS * 2):]:
        messages.append({"role": m.role, "content": m.content})

    messages.append({"role": "user", "content": body.question})

    # 呼叫 LiteLLM
    kwargs: dict = {
        "model": litellm_model,
        "messages": messages,
        "api_key": llm_api_key,
        "stream": False,
    }
    apply_api_base(kwargs, api_base)

    try:
        resp = await litellm.acompletion(**kwargs)
    except Exception as exc:
        logger.error("public cs_query LiteLLM error: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM 呼叫失敗：{exc}") from exc

    answer = resp.choices[0].message.content or ""
    usage: UsageMeta | None = None
    if hasattr(resp, "usage") and resp.usage:
        usage = UsageMeta(
            prompt_tokens=resp.usage.prompt_tokens or 0,
            completion_tokens=resp.usage.completion_tokens or 0,
            total_tokens=resp.usage.total_tokens or 0,
        )
        _record_usage(
            db,
            api_key_id=api_key.id,
            input_tokens=usage.prompt_tokens,
            output_tokens=usage.completion_tokens,
        )
    else:
        _record_usage(db, api_key_id=api_key.id, input_tokens=0, output_tokens=0)

    return CsQueryResponse(
        answer=answer,
        sources=sources,
        usage=usage,
        model=model,
    )
