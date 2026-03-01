"""Chat API：POST /chat/completions（LiteLLM 統一支援 OpenAI / Gemini / 台智雲）"""
import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import litellm

from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_llm_params(model: str) -> tuple[str, str | None, str | None]:
    """
    依 model 回傳 (litellm_model, api_key, api_base)。
    api_base 僅台智雲需要，其他為 None。
    """
    if model.startswith("gemini/"):
        return model, settings.GEMINI_API_KEY or None, None
    if model.startswith("twcc/"):
        # 台智雲：OpenAI 相容格式，需 api_base
        litellm_model = f"openai/{model[5:]}"  # twcc/Llama3.1-FFM-8B -> openai/Llama3.1-FFM-8B
        return litellm_model, settings.TWCC_API_KEY or None, settings.TWCC_API_BASE or None
    return model, settings.OPENAI_API_KEY or None, None


class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""

    class Config:
        extra = "ignore"  # 忽略 meta 等額外欄位


class ChatRequest(BaseModel):
    system_prompt: str = ""
    user_prompt: str = ""
    data: str = ""  # Data 區塊內容，作為參考資料併入 system
    model: str = "gpt-4o-mini"
    messages: list[ChatMessage] = []
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


def _build_messages(req: ChatRequest) -> list[dict]:
    """組裝 OpenAI messages 格式"""
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
    # 新訊息：若有 user_prompt 則前置
    user_content = req.content
    if req.user_prompt.strip():
        user_content = f"{req.user_prompt.strip()}\n\n{req.content}"
    msgs.append({"role": "user", "content": user_content})
    return msgs


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


def _get_provider_name(model: str) -> str:
    if model.startswith("gemini/"):
        return "Gemini"
    if model.startswith("twcc/"):
        return "台智雲"
    return "OpenAI"


@router.post("/completions", response_model=ChatResponse)
async def chat_completions(req: ChatRequest):
    logger.info(f"chat_completions: model={req.model!r}, content_len={len(req.content) if req.content else 0}")
    try:
        model = (req.model or "").strip() or "gpt-4o-mini"
        litellm_model, api_key, api_base = _get_llm_params(model)

        if not api_key:
            raise HTTPException(
                status_code=503,
                detail=f"{_get_provider_name(model)} API Key 未設定，請在 .env 中設定對應的 key",
            )
        if model.startswith("twcc/") and not api_base:
            raise HTTPException(
                status_code=503,
                detail="台智雲 TWCC_API_BASE 未設定，請在 .env 中設定",
            )

        messages = _build_messages(req)
        if model.startswith("gemini/"):
            os.environ["GEMINI_API_KEY"] = api_key
        elif model.startswith("twcc/"):
            pass  # 台智雲用 api_key + api_base 傳入，不設 env
        else:
            os.environ["OPENAI_API_KEY"] = api_key

        completion_kwargs: dict = {
            "model": litellm_model,
            "messages": messages,
            "api_key": api_key,
            "timeout": 60,
        }
        if api_base:
            base = api_base.rstrip("/")
            completion_kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"

        resp = await litellm.acompletion(**completion_kwargs)
        return _parse_response(resp)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.exception("chat_completions 發生錯誤")
        raise HTTPException(status_code=500, detail=str(e))
