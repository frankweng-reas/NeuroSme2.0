"""LLM 服務：DB-based 參數取得、provider 判斷、台智雲 model 名稱、request 持久化

設計原則：
  - 此模組只依賴 DB models 與核心工具，不依賴任何 endpoint 的 request/response 型別
  - 避免循環 import：ChatResponse / ChatRequest 留在 chat.py，不引入此模組
  - 統一提供 UsageMeta，讓 chat.py 從此 import 而非自行定義
"""

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

import aiohttp
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.encryption import decrypt_api_key
from app.models.chat_llm_request import ChatLlmRequest
from app.models.llm_provider_config import LLMProviderConfig
from app.services.agent_usage import log_agent_usage

logger = logging.getLogger(__name__)

# 台智雲模型名稱對照：前端格式 -> API 格式（小寫連字號 + -chat）
_TWCC_MODEL_MAP: dict[str, str] = {
    "Llama3.1-FFM-8B-32K": "llama3.1-ffm-8b-32k-chat",
    "Llama3.3-FFM-70B-32K": "llama3.3-ffm-70b-32k-chat",
}


class UsageMeta(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


def _get_llm_params(
    model: str, db=None, tenant_id: str | None = None
) -> tuple[str, str | None, str | None]:
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
    if model.startswith("local/"):
        db_key, db_base = _db_key("local")
        litellm_model = f"ollama_chat/{model[6:]}"
        # 本機服務（Ollama / LM Studio / vLLM）通常不需要真實 key；用 "local" 作 placeholder
        return litellm_model, db_key or "local", db_base or None
    if model.startswith("anthropic/") or model.startswith("claude-"):
        db_key, _ = _db_key("anthropic")
        # 補齊前綴，確保 LiteLLM 路由正確
        litellm_model = model if model.startswith("anthropic/") else f"anthropic/{model}"
        return litellm_model, db_key or None, None
    db_key, _ = _db_key("openai")
    return model, db_key or None, None


def _infer_llm_provider(model: str) -> str:
    m = (model or "").strip()
    if m.startswith("gemini/"):
        return "gemini"
    if m.startswith("twcc/"):
        return "twcc"
    if m.startswith("anthropic/") or m.startswith("claude-"):
        return "anthropic"
    return "openai"


def _get_provider_name(model: str) -> str:
    if model.startswith("gemini/"):
        return "Gemini"
    if model.startswith("twcc/"):
        return "台智雲"
    if model.startswith("local/"):
        return "本機模型"
    if model.startswith("anthropic/") or model.startswith("claude-"):
        return "Anthropic"
    return "OpenAI"


def _twcc_model_id(frontend_model: str) -> str:
    """將前端模型名稱轉為台智雲 API 格式。例：Llama3.1-FFM-8B-32K -> llama3.1-ffm-8b-32k-chat"""
    key = frontend_model.strip()
    if key in _TWCC_MODEL_MAP:
        return _TWCC_MODEL_MAP[key]
    normalized = key.lower().replace(" ", "-").replace("_", "-")
    return f"{normalized}-chat" if not normalized.endswith("-chat") else normalized


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
    agent_id: str = "chat",
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
    log_agent_usage(
        db=db,
        agent_type=agent_id,
        tenant_id=tenant_id,
        user_id=user_id,
        model=model or None,
        prompt_tokens=usage.prompt_tokens if usage else None,
        completion_tokens=usage.completion_tokens if usage else None,
        total_tokens=usage.total_tokens if usage else None,
        latency_ms=latency_ms,
        status=status,
    )
    return row.id
