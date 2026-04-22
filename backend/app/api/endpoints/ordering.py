"""公開點餐 API：外部 App 透過 API Key 進行多輪對話點餐（結構化 JSON 回應）

端點：
  POST /api/v1/public/ordering/chat   — 點餐對話（多輪，由後端管理 session）
  DELETE /api/v1/public/ordering/session/{session_id}  — 清除 session（重新開始）

認證：X-API-Key header（Bearer JWT 不適用）

回應 JSON schema：
  {
    "status":  "clarifying" | "confirming" | "done" | "inquiry",
    "reply":   "給用戶的文字回覆",
    "items":   [{"name":"...", "qty":1, "price":110, "notes":""}],
    "choices": ["選項A", "選項B"] | null,
    "session_id": "...",
    "usage":   {"prompt_tokens":..., "completion_tokens":..., "total_tokens":...} | null
  }
"""

import json
import logging
import re
from datetime import date
from typing import Annotated

import litellm
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.api_key_auth import get_api_key
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.api_key import ApiKey, ApiKeyUsage
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.ordering_session import OrderingSession
from app.services.chat_service import _load_system_prompt_from_file
from app.services.km_service import format_km_context, km_retrieve_sync
from app.services.llm_service import UsageMeta, _get_llm_params, _get_provider_name
from app.services.llm_utils import apply_api_base

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 20   # 最多保留 20 輪對話（40 則訊息）


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class OrderingItem(BaseModel):
    name: str = ""
    qty: int = 1
    price: float = 0
    notes: str = ""


class OrderingChatRequest(BaseModel):
    knowledge_base_id: int = Field(..., description="菜單所在知識庫 ID（需屬於此 API Key 對應的 tenant）")
    session_id: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="會話 ID（由呼叫方自行產生並維護，同一用戶同一桌使用同一 ID）",
    )
    message: str = Field(..., min_length=1, description="用戶這一輪說的話")
    model: str = Field(
        default="",
        description="覆寫模型名稱；留空時使用知識庫設定的模型",
    )


class OrderingChatResponse(BaseModel):
    status: str
    reply: str
    items: list[OrderingItem]
    choices: list[str] | None
    session_id: str
    usage: UsageMeta | None = None


# ──────────────────────────────────────────────────────────────────────────────
# 內部工具函式
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


def _parse_ordering_json(text: str) -> dict:
    """解析 LLM 輸出為訂餐 JSON；失敗時回傳 error 格式。"""
    text = text.strip()

    # 直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 去掉 markdown code fence 後解析
    stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.DOTALL).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # 找第一個 {...}
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    logger.warning("ordering: 無法解析 LLM 回應為 JSON，原始文字：%r", text[:300])
    return {
        "status": "inquiry",
        "reply": text or "系統暫時無法處理，請再試一次。",
        "items": [],
        "choices": None,
    }


def _build_ordering_response(data: dict, session_id: str, usage: UsageMeta | None) -> OrderingChatResponse:
    """把解析後的 dict 轉為 OrderingChatResponse；對欄位做容錯處理。"""
    valid_statuses = {"clarifying", "confirming", "done", "inquiry"}
    status = data.get("status", "inquiry")
    if status not in valid_statuses:
        status = "inquiry"

    raw_items = data.get("items") or []
    items: list[OrderingItem] = []
    for it in raw_items:
        if isinstance(it, dict):
            items.append(OrderingItem(
                name=str(it.get("name", "")),
                qty=int(it.get("qty", 1)),
                price=float(it.get("price", 0)),
                notes=str(it.get("notes", "")),
            ))

    raw_choices = data.get("choices")
    choices: list[str] | None = None
    if isinstance(raw_choices, list) and raw_choices:
        choices = [str(c) for c in raw_choices]

    return OrderingChatResponse(
        status=status,
        reply=str(data.get("reply", "")),
        items=items,
        choices=choices,
        session_id=session_id,
        usage=usage,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────


@router.post(
    "/chat",
    response_model=OrderingChatResponse,
    summary="點餐對話（多輪）",
    description=(
        "透過 API Key 進行多輪對話點餐。後端自動維護 session 對話歷史，"
        "呼叫方只需帶入 session_id + message 即可。"
        "Rate limit：每個 API Key 每小時最多 200 次請求。"
    ),
)
@limiter.limit("200/hour")
async def ordering_chat(
    request: Request,
    body: OrderingChatRequest,
    db: Annotated[Session, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(get_api_key)],
):
    tenant_id = api_key.tenant_id

    # 1. 確認 KB 屬於此 tenant
    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == body.knowledge_base_id,
        KmKnowledgeBase.tenant_id == tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="knowledge_base_id 不存在或不屬於此 tenant")

    # 2. 取得或建立 session
    session = db.query(OrderingSession).filter(
        OrderingSession.session_id == body.session_id,
        OrderingSession.api_key_id == api_key.id,
    ).first()

    if session is None:
        session = OrderingSession(
            session_id=body.session_id,
            api_key_id=api_key.id,
            kb_id=body.knowledge_base_id,
            messages=[],
        )
        db.add(session)
        db.flush()
    elif session.kb_id != body.knowledge_base_id:
        # kb_id 不一致時自動更新（例如同一 session_id 換了菜單知識庫）
        session.kb_id = body.knowledge_base_id

    # 3. RAG 檢索
    chunks = km_retrieve_sync(
        body.message,
        db,
        tenant_id,
        user_id=0,
        knowledge_base_id=body.knowledge_base_id,
        skip_scope_check=True,
    )
    rag_context = format_km_context(chunks)
    logger.info("ordering_chat: %d chunks retrieved (kb_id=%s)", len(chunks), body.knowledge_base_id)

    # 4. 決定模型
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

    # 5. 組裝 system prompt
    ordering_prompt = _load_system_prompt_from_file("ordering")
    system_parts: list[str] = []
    if ordering_prompt:
        system_parts.append(ordering_prompt)
    if rag_context.strip():
        system_parts.append(f"## 菜單知識庫\n\n{rag_context.strip()}")

    # 6. 組裝 messages（system + 歷史 + 本輪）
    messages: list[dict] = []
    if system_parts:
        messages.append({"role": "system", "content": "\n\n".join(system_parts)})

    history: list[dict] = session.messages or []
    for m in history[-(MAX_HISTORY_TURNS * 2):]:
        messages.append({"role": m["role"], "content": m["content"]})

    messages.append({"role": "user", "content": body.message})

    # 7. 呼叫 LLM
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
        logger.error("ordering_chat LiteLLM error: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM 呼叫失敗：{exc}") from exc

    assistant_text = resp.choices[0].message.content or ""

    # 8. 解析 JSON
    parsed = _parse_ordering_json(assistant_text)

    # 9. 更新 session 歷史（user + assistant）
    new_history = list(history)
    new_history.append({"role": "user", "content": body.message})
    new_history.append({"role": "assistant", "content": assistant_text})
    session.messages = new_history
    db.commit()

    # 10. 用量追蹤
    usage: UsageMeta | None = None
    if hasattr(resp, "usage") and resp.usage:
        usage = UsageMeta(
            prompt_tokens=resp.usage.prompt_tokens or 0,
            completion_tokens=resp.usage.completion_tokens or 0,
            total_tokens=resp.usage.total_tokens or 0,
        )
        _record_usage(db, api_key.id, usage.prompt_tokens, usage.completion_tokens)
    else:
        _record_usage(db, api_key.id, 0, 0)

    return _build_ordering_response(parsed, body.session_id, usage)


@router.delete(
    "/session/{session_id}",
    summary="清除點餐 session",
    description="刪除指定 session_id 的對話歷史，讓用戶可以重新開始點餐。",
)
async def ordering_clear_session(
    session_id: str,
    db: Annotated[Session, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(get_api_key)],
):
    deleted = db.query(OrderingSession).filter(
        OrderingSession.session_id == session_id,
        OrderingSession.api_key_id == api_key.id,
    ).delete()
    db.commit()
    return {"deleted": deleted > 0, "session_id": session_id}
