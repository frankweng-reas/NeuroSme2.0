"""Chat Dev API：POST /chat/dev/completions，供 dev-test-chat 等測試用，不讀 md 檔，完全使用 request 的 system_prompt"""
import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
import litellm
from sqlalchemy.orm import Session

from app.api.endpoints.chat import (
    ChatRequest,
    ChatResponse,
    _call_twcc_conversation,
    _parse_response,
)
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.llm_service import (
    _get_llm_params,
    _get_provider_name,
    _twcc_model_id,
)
from app.services.llm_utils import apply_api_base

router = APIRouter()
logger = logging.getLogger(__name__)


def _build_messages(req: ChatRequest) -> list[dict]:
    """組裝 OpenAI messages 格式，不讀 md 檔，僅用 request 的 system_prompt"""
    msgs: list[dict] = []
    system_parts: list[str] = []
    if req.system_prompt.strip():
        system_parts.append(req.system_prompt.strip())
    if req.data.strip():
        system_parts.append(f"以下為參考資料：\n\n{req.data.strip()}")
    if system_parts:
        msgs.append({"role": "system", "content": "\n\n".join(system_parts)})
    for m in req.messages:
        msgs.append({"role": m.role, "content": m.content})
    user_content = req.content
    if req.user_prompt.strip():
        user_content = f"{req.user_prompt.strip()}\n\n{req.content}"
    msgs.append({"role": "user", "content": user_content})
    return msgs


@router.post("/completions", response_model=ChatResponse)
async def chat_completions_dev(
    req: ChatRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    logger.info(
        f"chat_completions_dev: model={req.model!r}, content_len={len(req.content) if req.content else 0}"
    )
    try:
        model = (req.model or "").strip() or "gpt-4o-mini"
        tid = str(getattr(current, "tenant_id", "") or "")
        litellm_model, api_key, api_base = _get_llm_params(model, db=db, tenant_id=tid or None)

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

        messages = _build_messages(req)

        if model.startswith("twcc/"):
            url = (api_base or "").rstrip("/")
            if not url:
                raise HTTPException(
                    status_code=503,
                    detail="台智雲 TWCC_API_BASE 未設定，請在 .env 設定為 https://api-ams.twcc.ai/api/models/conversation",
                )
            model_id = _twcc_model_id(model[5:])
            return await _call_twcc_conversation(url=url, api_key=api_key, model_id=model_id, messages=messages)

        if model.startswith("gemini/"):
            os.environ["GEMINI_API_KEY"] = api_key
        else:
            os.environ["OPENAI_API_KEY"] = api_key

        completion_kwargs: dict = {
            "model": litellm_model,
            "messages": messages,
            "api_key": api_key,
            "timeout": 60,
        }
        apply_api_base(completion_kwargs, api_base)
        if model.startswith("local/"):
            completion_kwargs["think"] = False

        resp = await litellm.acompletion(**completion_kwargs)
        return _parse_response(resp)
    except HTTPException:
        raise
    except Exception:
        logger.exception("chat_completions_dev 發生錯誤")
        raise HTTPException(status_code=500, detail="chat_completions_dev 發生錯誤")
