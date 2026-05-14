"""LLM 工具函式：集中管理 model 名稱解析與 LiteLLM kwargs 組裝

設計原則：
  - model 字串的 provider 前綴（gemini/ twcc/ local/）作為路由 hint，由此模組統一解析
  - local/ 對應本機 Ollama 服務，走原生 /api/chat（ollama_chat/ prefix）
  - 所有需要翻譯 model 字串或組裝 api_base 的地方，統一呼叫此模組，不要各自實作
"""

import os


def get_provider_from_model(model: str) -> str:
    """從 model 字串推斷 provider 名稱（與 llm_provider_configs.provider 欄位對應）"""
    m = (model or "").strip()
    if m.startswith("gemini/"):
        return "gemini"
    if m.startswith("twcc/"):
        return "twcc"
    if m.startswith("local/"):
        return "local"
    if m.startswith("anthropic/") or m.startswith("claude-"):
        return "anthropic"
    return "openai"


def resolve_litellm_model(model: str) -> str:
    """
    將前端 model 字串轉換為 LiteLLM 可辨識的格式：

    - gemini/xxx  → 不變（LiteLLM 原生支援 gemini/）
    - twcc/xxx    → openai/xxx（走 OpenAI-compatible 路徑，api_base 由呼叫端帶入）
    - local/xxx   → ollama_chat/xxx（Ollama 原生 /api/chat，支援 think 參數）
    - 其他        → 不變（openai provider，直接傳給 LiteLLM）
    """
    if model.startswith("gemini/"):
        return model
    if model.startswith("twcc/"):
        return f"openai/{model[5:]}"
    if model.startswith("local/"):
        return f"ollama_chat/{model[6:]}"
    return model


def apply_api_base(kwargs: dict, api_base: str | None) -> None:
    """
    若有 api_base，寫入 kwargs（in-place）。
    - ollama_chat/ 走原生 /api/chat，不需要 /v1 後綴
    - openai/twcc 走 OpenAI-compatible，補 /v1 後綴
    """
    if not api_base:
        return
    base = api_base.rstrip("/")
    model = kwargs.get("model", "")
    if model.startswith("ollama_chat/") or model.startswith("ollama/"):
        # 原生 Ollama API，不加 /v1
        kwargs["api_base"] = base
    else:
        kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"


def set_env_api_key(model: str, api_key: str) -> None:
    """依 model 設定對應的環境變數（LiteLLM 某些路徑會讀取環境變數）"""
    if model.startswith("gemini/"):
        os.environ["GEMINI_API_KEY"] = api_key
    elif model.startswith("anthropic/") or model.startswith("claude-"):
        os.environ["ANTHROPIC_API_KEY"] = api_key
    else:
        os.environ["OPENAI_API_KEY"] = api_key


def ensure_local_prefix(model: str) -> str:
    """
    確保 local provider 的 model 名稱帶有 'local/' 前綴。
    同時向下相容舊格式（DB 內已有 local/）和新格式（純 model 名稱）。

    範例：
      "gemma4:26b"       → "local/gemma4:26b"
      "local/gemma4:26b" → "local/gemma4:26b"（已有前綴，不重複加）
    """
    m = (model or "").strip()
    if not m:
        return m
    if m.startswith("local/"):
        return m
    return f"local/{m}"
