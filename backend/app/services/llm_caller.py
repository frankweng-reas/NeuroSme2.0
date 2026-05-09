"""統一 LLM 呼叫層

設計目標：
  - 所有需要呼叫 LiteLLM 的地方（chat、widget、public API 等）統一走此模組
  - kwargs 組裝邏輯（model 解析、api_base、think=False）只寫一次
  - 上層 endpoint 只需傳入業務參數，不再自行組裝 LiteLLM kwargs

公開介面：
  build_llm_kwargs(model, messages, db, tenant_id, stream, temperature)
      → dict  純粹組裝，不呼叫 LiteLLM，方便測試與串流場景

  call_llm(model, messages, db, tenant_id, **overrides)
      → (litellm.ModelResponse, UsageMeta | None, int latency_ms)
      非串流呼叫，適合 RAG 問答、OCR 等一次性需要完整回答的場景

  call_llm_stream(model, messages, db, tenant_id, **overrides)
      → AsyncGenerator[str, None]
      串流呼叫，逐 token yield 文字片段，適合聊天介面

例外行為：
  - LLM provider 的 api_key 未設定 → 拋 LLMProviderNotConfigured
  - LiteLLM 呼叫失敗             → 拋 LLMCallError（包含原始 exception）
  上層 endpoint 可自行決定是否轉成 HTTPException
"""
import logging
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass

import litellm
from sqlalchemy.orm import Session

from app.services.llm_service import UsageMeta, _get_llm_params, _get_provider_name
from app.services.llm_utils import apply_api_base

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# 自訂例外
# ──────────────────────────────────────────────────────────────────────────────

class LLMProviderNotConfigured(Exception):
    """該 provider 的 API Key 尚未在租戶設定中設定"""
    def __init__(self, model: str):
        provider = _get_provider_name(model)
        super().__init__(f"{provider} API Key 未設定，請在 NeuroSme 管理介面設定對應的 key")
        self.model = model
        self.provider = provider


class LLMCallError(Exception):
    """LiteLLM 呼叫失敗"""
    def __init__(self, message: str, cause: Exception | None = None):
        super().__init__(message)
        self.cause = cause


# ──────────────────────────────────────────────────────────────────────────────
# kwargs 組裝
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class LLMParams:
    litellm_model: str
    api_key: str
    api_base: str | None


def resolve_llm_params(model: str, db: Session, tenant_id: str) -> LLMParams:
    """
    查詢 DB 取得 LLM 連線參數，若 api_key 未設定則拋 LLMProviderNotConfigured。
    """
    litellm_model, api_key, api_base = _get_llm_params(model, db=db, tenant_id=tenant_id)
    if not api_key:
        raise LLMProviderNotConfigured(model)
    return LLMParams(litellm_model=litellm_model, api_key=api_key, api_base=api_base)


def build_llm_kwargs(
    *,
    model: str,
    messages: list[dict],
    db: Session,
    tenant_id: str,
    stream: bool = False,
    temperature: float = 0.3,
    **extra,
) -> dict:
    """
    組裝完整的 LiteLLM kwargs，包含：
      - model 名稱解析（local/ → ollama_chat/、twcc/ → openai/ 等）
      - api_key、api_base 注入
      - 本地 Ollama 模型停用 thinking mode（think=False）
      - 呼叫端可透過 **extra 覆寫任何欄位

    不會呼叫 LiteLLM，純粹回傳 dict，方便單元測試。
    """
    params = resolve_llm_params(model, db, tenant_id)

    kwargs: dict = {
        "model": params.litellm_model,
        "messages": messages,
        "api_key": params.api_key,
        "stream": stream,
        "temperature": temperature,
        **extra,
    }
    apply_api_base(kwargs, params.api_base)

    # Ollama 本地模型預設會啟用 thinking mode，對 RAG 問答造成大幅延遲，需明確停用
    if model.startswith("local/") or params.litellm_model.startswith("ollama_chat/"):
        kwargs.setdefault("think", False)

    return kwargs


# ──────────────────────────────────────────────────────────────────────────────
# Pre-resolved variant（chat.py 等已在上游解析過 params 時使用，避免重複 DB 查詢）
# ──────────────────────────────────────────────────────────────────────────────

def build_llm_kwargs_resolved(
    *,
    litellm_model: str,
    api_key: str,
    api_base: str | None,
    original_model: str,
    messages: list[dict],
    stream: bool = False,
    temperature: float = 0.3,
    **extra,
) -> dict:
    """
    同 build_llm_kwargs，但接受已解析好的 (litellm_model, api_key, api_base)，
    跳過 DB 查詢。適用於上游已呼叫過 _get_llm_params 的場景（例如 chat.py）。
    original_model 用於判斷是否為 local/ 模型。
    """
    kwargs: dict = {
        "model": litellm_model,
        "messages": messages,
        "api_key": api_key,
        "stream": stream,
        "temperature": temperature,
        **extra,
    }
    apply_api_base(kwargs, api_base)
    if original_model.startswith("local/") or litellm_model.startswith("ollama_chat/"):
        kwargs.setdefault("think", False)
    return kwargs


# ──────────────────────────────────────────────────────────────────────────────
# 非串流呼叫
# ──────────────────────────────────────────────────────────────────────────────

async def call_llm(
    *,
    model: str,
    messages: list[dict],
    db: Session,
    tenant_id: str,
    temperature: float = 0.3,
    **extra,
) -> tuple[str, UsageMeta | None, int]:
    """
    非串流 LLM 呼叫。

    Returns:
        (answer: str, usage: UsageMeta | None, latency_ms: int)

    Raises:
        LLMProviderNotConfigured  – api_key 未設定
        LLMCallError              – LiteLLM 呼叫失敗
    """
    kwargs = build_llm_kwargs(
        model=model,
        messages=messages,
        db=db,
        tenant_id=tenant_id,
        stream=False,
        temperature=temperature,
        **extra,
    )

    t0 = time.perf_counter()
    try:
        resp = await litellm.acompletion(**kwargs)
    except Exception as exc:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        logger.error("call_llm failed model=%s latency=%dms: %s", model, latency_ms, exc)
        raise LLMCallError(f"LLM 呼叫失敗：{exc}", cause=exc) from exc

    latency_ms = int((time.perf_counter() - t0) * 1000)
    answer = resp.choices[0].message.content or ""

    usage: UsageMeta | None = None
    if hasattr(resp, "usage") and resp.usage:
        usage = UsageMeta(
            prompt_tokens=resp.usage.prompt_tokens or 0,
            completion_tokens=resp.usage.completion_tokens or 0,
            total_tokens=resp.usage.total_tokens or 0,
        )

    return answer, usage, latency_ms


# ──────────────────────────────────────────────────────────────────────────────
# 串流呼叫
# ──────────────────────────────────────────────────────────────────────────────

async def call_llm_stream(
    *,
    model: str,
    messages: list[dict],
    db: Session,
    tenant_id: str,
    temperature: float = 0.3,
    **extra,
) -> AsyncGenerator[str, None]:
    """
    串流 LLM 呼叫，逐 token yield 文字片段。

    Usage:
        async for chunk in call_llm_stream(model=..., messages=..., ...):
            yield f"data: {chunk}\\n\\n"

    Raises:
        LLMProviderNotConfigured  – api_key 未設定（在第一個 yield 前拋出）
        LLMCallError              – LiteLLM 呼叫失敗
    """
    kwargs = build_llm_kwargs(
        model=model,
        messages=messages,
        db=db,
        tenant_id=tenant_id,
        stream=True,
        temperature=temperature,
        **extra,
    )

    try:
        response = await litellm.acompletion(**kwargs)
    except Exception as exc:
        logger.error("call_llm_stream failed model=%s: %s", model, exc)
        raise LLMCallError(f"LLM 串流呼叫失敗：{exc}", cause=exc) from exc

    async for chunk in response:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta and delta.content:
            yield delta.content
