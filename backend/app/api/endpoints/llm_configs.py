"""LLM Provider Config API：CRUD，僅該租戶之 admin / super_admin 可存取"""
import time
import aiohttp
import litellm
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.encryption import decrypt_api_key, encrypt_api_key, mask_api_key
from app.core.security import get_current_user
from app.models.llm_provider_config import LLMProviderConfig
from app.models.user import User
from app.schemas.llm_config import (
    LLMModelOption,
    LLMProviderConfigCreate,
    LLMProviderConfigResponse,
    LLMProviderConfigUpdate,
    VALID_PROVIDERS,
)
from app.services.llm_utils import (
    apply_api_base,
    ensure_local_prefix,
    resolve_litellm_model,
    set_env_api_key,
)

router = APIRouter()

# 各 provider 預設可選模型清單（Admin 表單快捷鍵、以及已有設定列但未填 available_models 時之後援）
PROVIDER_DEFAULT_MODELS: dict[str, list[str]] = {
    "openai": [
        "gpt-4o-mini",
        "gpt-4o",
    ],
    "gemini": [
        "gemini/gemini-2.5-flash",
        "gemini/gemini-pro",
    ],
    "twcc": ["twcc/Llama3.3-FFM-70B-32K"],
    "local": [
        "local/gemma3:4b",
        "local/llama3.2:latest",
        "local/mistral:latest",
    ],
}

_TWCC_OPTION_LABELS: dict[str, str] = {
    "twcc/Llama3.3-FFM-70B-32K": "台智雲 Llama3.3-FFM-70B",
}


def _model_display_label(model: str) -> str:
    m = (model or "").strip()
    if not m:
        return m
    if m.startswith("local/"):
        return m[len("local/"):]
    if m.startswith("gemini/gemini-"):
        return m[len("gemini/") :]
    if m.startswith("gemini/"):
        return m[len("gemini/") :]
    if m in _TWCC_OPTION_LABELS:
        return _TWCC_OPTION_LABELS[m]
    if m.startswith("twcc/"):
        return f"台智雲 {m[5:]}"
    return m


def _collect_tenant_model_options(db: Session, tenant_id: str) -> list[LLMModelOption]:
    rows = (
        db.query(LLMProviderConfig)
        .filter(
            LLMProviderConfig.tenant_id == tenant_id,
            LLMProviderConfig.is_active.is_(True),
        )
        .order_by(LLMProviderConfig.provider, LLMProviderConfig.id)
        .all()
    )
    seen: set[str] = set()
    ordered: list[LLMModelOption] = []

    def add_model(mid: str) -> None:
        mid = (mid or "").strip()
        if not mid or mid in seen:
            return
        seen.add(mid)
        ordered.append(LLMModelOption(value=mid, label=_model_display_label(mid)))

    if not rows:
        return []

    for cfg in rows:
        mids: list[str] = []
        raw = cfg.available_models
        if isinstance(raw, list) and len(raw) > 0:
            mids = [str(x).strip() for x in raw if str(x).strip()]
        if not mids:
            mids = list(PROVIDER_DEFAULT_MODELS.get(cfg.provider, []))
        dm = (cfg.default_model or "").strip()
        if dm:
            mids = [dm] + [x for x in mids if x != dm]
        for mid in mids:
            add_model(mid)

    return ordered


def _require_tenant_user(db: Session, current: User) -> str:
    """已登入且已綁定租戶即可（一般使用者也可用模型下拉資料）。"""
    u = db.query(User).filter(User.id == current.id).first()
    if not u:
        raise HTTPException(status_code=401, detail="使用者不存在")
    tid = (getattr(u, "tenant_id", None) or "").strip()
    if not tid:
        raise HTTPException(status_code=403, detail="使用者未綁定租戶")
    return tid


def _require_tenant_admin(db: Session, current: User) -> str:
    """以資料庫最新列為準決定 tenant_id，避免依賴可能過期的 ORM 實例欄位。"""
    u = db.query(User).filter(User.id == current.id).first()
    if not u:
        raise HTTPException(status_code=401, detail="使用者不存在")
    role = str(getattr(u, "role", "") or "")
    if role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="需 admin 或 super_admin 權限")
    tid = (getattr(u, "tenant_id", None) or "").strip()
    if not tid:
        raise HTTPException(status_code=403, detail="使用者未綁定租戶")
    return tid


def _get_config_for_tenant(db: Session, config_id: int, tenant_id: str) -> LLMProviderConfig:
    cfg = (
        db.query(LLMProviderConfig)
        .filter(LLMProviderConfig.id == config_id, LLMProviderConfig.tenant_id == tenant_id)
        .first()
    )
    if not cfg:
        raise HTTPException(status_code=404, detail="LLM config 不存在")
    return cfg


def _to_response(cfg: LLMProviderConfig) -> LLMProviderConfigResponse:
    masked = None
    if cfg.api_key_encrypted:
        try:
            plain = decrypt_api_key(cfg.api_key_encrypted)
            masked = mask_api_key(plain)
        except ValueError:
            masked = "（解密失敗）"
    return LLMProviderConfigResponse(
        id=cfg.id,
        tenant_id=cfg.tenant_id,
        provider=cfg.provider,
        label=cfg.label,
        api_key_masked=masked,
        api_base_url=cfg.api_base_url,
        default_model=cfg.default_model,
        available_models=cfg.available_models,
        is_active=cfg.is_active,
        created_at=cfg.created_at,
        updated_at=cfg.updated_at,
    )


@router.get("/providers")
def get_provider_options():
    """回傳各 provider 的預設模型清單（無需登入）"""
    return PROVIDER_DEFAULT_MODELS


@router.get("/model-options", response_model=list[LLMModelOption])
def get_model_options_for_tenant(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """依目前租戶啟用中的 llm_provider_config 組合模型清單（需登入）；無任何設定列時回傳空陣列。"""
    tenant_id = _require_tenant_user(db, current)
    return _collect_tenant_model_options(db, tenant_id)


@router.get("/", response_model=list[LLMProviderConfigResponse])
def list_llm_configs(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """列出目前租戶的 LLM 設定（admin / super_admin）"""
    tenant_id = _require_tenant_admin(db, current)
    rows = (
        db.query(LLMProviderConfig)
        .filter(LLMProviderConfig.tenant_id == tenant_id)  # 僅列出本租戶列
        .order_by(LLMProviderConfig.provider, LLMProviderConfig.id)
        .all()
    )
    return [_to_response(r) for r in rows]


@router.post("/", response_model=LLMProviderConfigResponse, status_code=201)
def create_llm_config(
    body: LLMProviderConfigCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """新增 LLM provider 設定（目前租戶）"""
    tenant_id = _require_tenant_admin(db, current)
    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"不支援的 provider，有效值：{sorted(VALID_PROVIDERS)}")

    cfg = LLMProviderConfig(
        tenant_id=tenant_id,
        provider=body.provider,
        label=body.label,
        api_key_encrypted=encrypt_api_key(body.api_key) if body.api_key else None,
        api_base_url=body.api_base_url,
        default_model=body.default_model,
        available_models=body.available_models,
        is_active=body.is_active,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _to_response(cfg)


@router.patch("/{config_id}", response_model=LLMProviderConfigResponse)
def update_llm_config(
    config_id: int,
    body: LLMProviderConfigUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """更新 LLM provider 設定（目前租戶）"""
    tenant_id = _require_tenant_admin(db, current)
    cfg = _get_config_for_tenant(db, config_id, tenant_id)

    if body.label is not None:
        cfg.label = body.label
    if body.api_key is not None:
        cfg.api_key_encrypted = encrypt_api_key(body.api_key)
    if body.api_base_url is not None:
        cfg.api_base_url = body.api_base_url
    if body.default_model is not None:
        cfg.default_model = body.default_model
    if body.available_models is not None:
        cfg.available_models = body.available_models
    if body.is_active is not None:
        cfg.is_active = body.is_active

    db.commit()
    db.refresh(cfg)
    return _to_response(cfg)


@router.delete("/{config_id}", status_code=204)
def delete_llm_config(
    config_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """刪除 LLM provider 設定（目前租戶）"""
    tenant_id = _require_tenant_admin(db, current)
    cfg = _get_config_for_tenant(db, config_id, tenant_id)
    db.delete(cfg)
    db.commit()
    return None


# 各 provider 測試用預設模型
_TEST_DEFAULT_MODELS: dict[str, str] = {
    "openai": "gpt-4o-mini",
    "gemini": "gemini/gemini-2.5-flash",
    "twcc": "twcc/Llama3.3-FFM-70B-32K",
}

_TWCC_MODEL_MAP: dict[str, str] = {
    "Llama3.1-FFM-8B-32K": "llama3.1-ffm-8b-32k-chat",
    "Llama3.3-FFM-70B-32K": "llama3.3-ffm-70b-32k-chat",
}

_TEST_MESSAGES = [{"role": "user", "content": "Reply with exactly one word: OK"}]


@router.post("/{config_id}/test")
async def test_llm_config(
    config_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """測試 LLM provider 連通性（使用最短測試 prompt，計算回應時間）"""
    tenant_id = _require_tenant_admin(db, current)
    cfg = _get_config_for_tenant(db, config_id, tenant_id)

    # local provider（Ollama / LM Studio / vLLM）不需要真實 API Key
    if cfg.provider != "local" and not cfg.api_key_encrypted:
        raise HTTPException(status_code=400, detail="尚未設定 API Key，無法測試")

    api_key = "local"
    if cfg.api_key_encrypted:
        try:
            api_key = decrypt_api_key(cfg.api_key_encrypted)
        except ValueError as e:
            raise HTTPException(status_code=500, detail=f"API Key 解密失敗：{e}") from e

    # 決定測試用 model
    model = cfg.default_model or _TEST_DEFAULT_MODELS.get(cfg.provider, "gpt-4o-mini")

    t0 = time.monotonic()
    try:
        if cfg.provider == "twcc":
            # 台智雲：呼叫 conversation API
            api_base = (cfg.api_base_url or "").rstrip("/")
            if not api_base:
                raise HTTPException(status_code=400, detail="台智雲需設定 API Base URL")
            raw_model = model[5:] if model.startswith("twcc/") else model
            twcc_model_id = _TWCC_MODEL_MAP.get(raw_model, raw_model.lower().replace("_", "-") + "-chat")
            payload = {
                "model": twcc_model_id,
                "messages": _TEST_MESSAGES,
                "parameters": {"max_new_tokens": 20, "temperature": 0.01},
            }
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
                async with session.post(
                    api_base,
                    json=payload,
                    headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                ) as resp:
                    elapsed_ms = int((time.monotonic() - t0) * 1000)
                    if resp.status != 200:
                        body = await resp.text()
                        return {"ok": False, "elapsed_ms": elapsed_ms, "error": f"HTTP {resp.status}: {body[:200]}"}
                    data = await resp.json()
                    reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return {"ok": True, "elapsed_ms": elapsed_ms, "reply": reply.strip()[:100]}

        elif cfg.provider == "local":
            # 本機模型（Ollama）：使用原生 /api/chat，支援 think 參數
            api_base_raw = (cfg.api_base_url or "").rstrip("/")
            if not api_base_raw:
                raise HTTPException(status_code=400, detail="本機模型需設定 API Base URL（例：http://localhost:11434）")
            local_model = ensure_local_prefix(model)
            litellm_model = resolve_litellm_model(local_model)
            kwargs: dict = {
                "model": litellm_model,
                "messages": _TEST_MESSAGES,
                "api_key": api_key,
                "max_tokens": 50,
                "timeout": 30,
                "temperature": 0,
                "think": False,
            }
            apply_api_base(kwargs, api_base_raw)
            resp = await litellm.acompletion(**kwargs)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            reply = (resp.choices[0].message.content or "").strip()
            return {"ok": True, "elapsed_ms": elapsed_ms, "reply": reply[:100]}

        else:
            # OpenAI / Gemini（LiteLLM）
            kwargs = {
                "model": model,
                "messages": _TEST_MESSAGES,
                "api_key": api_key,
                "max_tokens": 20,
                "timeout": 30,
                "temperature": 0,
            }
            set_env_api_key(model, api_key)
            resp = await litellm.acompletion(**kwargs)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            reply = (resp.choices[0].message.content or "").strip()
            return {"ok": True, "elapsed_ms": elapsed_ms, "reply": reply[:100]}

    except HTTPException:
        raise
    except Exception as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {"ok": False, "elapsed_ms": elapsed_ms, "error": str(e)[:300]}
