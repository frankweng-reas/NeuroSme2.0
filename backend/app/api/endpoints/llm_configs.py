"""LLM Provider Config API：CRUD，僅該租戶之 admin / super_admin 可存取"""
import time
import aiohttp
import litellm
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.encryption import decrypt_api_key, encrypt_api_key, mask_api_key
from app.core.security import get_current_user
from app.models.llm_provider_config import LLMProviderConfig
from app.models.tenant_config import TenantConfig
from app.models.km_document import KmDocument
from app.models.km_chunk import KmChunk
from app.models.user import User
from app.schemas.llm_config import (
    LLMModelEntry,
    LLMModelOption,
    LLMProviderConfigCreate,
    LLMProviderConfigResponse,
    LLMProviderConfigUpdate,
    VALID_PROVIDERS,
)
from app.schemas.tenant_config import (
    DefaultLLMUpdate,
    EmbeddingMigrateRequest,
    SpeechConfigUpdate,
    TenantConfigResponse,
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
        "gemini/gemini-2.5-pro",
        "gemini/gemini-3.1-flash-lite",
    ],
    "anthropic": [
        "anthropic/claude-opus-4-5",
        "anthropic/claude-sonnet-4-5",
        "anthropic/claude-3-5-haiku-20241022",
    ],
    "twcc": ["twcc/Llama3.3-FFM-70B-32K"],
    "local": [
        "local/gemma4:26b",
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

    def add_model(mid: str, note: str | None = None) -> None:
        mid = (mid or "").strip()
        if not mid or mid in seen:
            return
        seen.add(mid)
        ordered.append(LLMModelOption(value=mid, label=_model_display_label(mid), note=note or None))

    if not rows:
        return []

    for cfg in rows:
        entries: list[tuple[str, str | None]] = []  # (model_id, note)
        raw = cfg.available_models
        if isinstance(raw, list) and len(raw) > 0:
            for item in raw:
                if isinstance(item, dict):
                    mid = str(item.get("model", "")).strip()
                    note = item.get("note") or None
                    if mid:
                        entries.append((mid, note))
                elif isinstance(item, str) and item.strip():
                    entries.append((item.strip(), None))
        # available_models = null 表示尚未設定，fallback 到預設清單
        # available_models = [] 表示 admin 明確清空，不 fallback
        if not entries and not isinstance(raw, list):
            for mid in PROVIDER_DEFAULT_MODELS.get(cfg.provider, []):
                entries.append((mid, None))
        dm = (cfg.default_model or "").strip()
        if dm:
            dm_note = next((n for m, n in entries if m == dm), None)
            entries = [(dm, dm_note)] + [(m, n) for m, n in entries if m != dm]
        for mid, note in entries:
            add_model(mid, note)

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


def _cascade_remove_models(db: Session, tenant_id: str, removed: set[str]) -> None:
    """從同租戶所有 users 的 allowed_models 中移除已被刪除的 model id。"""
    if not removed:
        return
    users = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.allowed_models.isnot(None))
        .all()
    )
    for u in users:
        raw = getattr(u, "allowed_models", None)
        if not isinstance(raw, list):
            continue
        updated = [m for m in raw if m not in removed]
        if len(updated) != len(raw):
            u.allowed_models = updated or None  # type: ignore[assignment]


def _parse_available_models(raw) -> list[LLMModelEntry] | None:
    """將 DB 中的 JSONB 資料（舊格式 string[] 或新格式 {model,note}[]）統一轉成 LLMModelEntry 列表。"""
    if not isinstance(raw, list) or not raw:
        return None
    result: list[LLMModelEntry] = []
    for item in raw:
        if isinstance(item, dict):
            mid = str(item.get("model", "")).strip()
            if mid:
                result.append(LLMModelEntry(model=mid, note=item.get("note") or None))
        elif isinstance(item, str) and item.strip():
            result.append(LLMModelEntry(model=item.strip(), note=None))
    return result or None


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
        available_models=_parse_available_models(cfg.available_models),
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
    """依目前租戶啟用中的 llm_provider_config 組合模型清單（需登入）。
    使用者若有 allowed_models 設定（非 null），則只回傳該清單內的模型；
    allowed_models = null 表示繼承租戶全部模型。
    admin / super_admin 同樣適用此規則。
    """
    tenant_id = _require_tenant_user(db, current)
    options = _collect_tenant_model_options(db, tenant_id)

    # Per-user 過濾：所有角色一律依 allowed_models 決定；null = 不限制
    u = db.query(User).filter(User.id == current.id).first()
    raw_allowed = getattr(u, "allowed_models", None) if u else None
    if isinstance(raw_allowed, list):
        allowed_set = {str(m) for m in raw_allowed if isinstance(m, str)}
        options = [o for o in options if o.value in allowed_set]

    # 將 tenant 設定的 default model 置頂，標記「(預設)」
    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()
    if tc and tc.default_llm_model:
        default_mid = tc.default_llm_model.strip()
        if default_mid:
            default_opt = next((o for o in options if o.value == default_mid), None)
            rest = [o for o in options if o.value != default_mid]
            default_label = f"(預設) {_model_display_label(default_mid)}"
            options = [LLMModelOption(value=default_mid, label=default_label, note=default_opt.note if default_opt else None)] + rest

    return options


@router.get("/all-model-options", response_model=list[LLMModelOption])
def get_all_model_options_for_admin(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """管理介面專用：回傳租戶全部可用模型，不套用 per-user 過濾（需 admin / super_admin）。"""
    tenant_id = _require_tenant_admin(db, current)
    options = _collect_tenant_model_options(db, tenant_id)

    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()
    if tc and tc.default_llm_model:
        default_mid = tc.default_llm_model.strip()
        if default_mid:
            default_opt = next((o for o in options if o.value == default_mid), None)
            rest = [o for o in options if o.value != default_mid]
            default_label = f"(預設) {_model_display_label(default_mid)}"
            options = [LLMModelOption(value=default_mid, label=default_label, note=default_opt.note if default_opt else None)] + rest

    return options


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

    # 同一租戶同一 provider 不允許重複新增
    existing = (
        db.query(LLMProviderConfig)
        .filter(LLMProviderConfig.tenant_id == tenant_id, LLMProviderConfig.provider == body.provider)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"此租戶已有 {body.provider} 的 Provider 設定，請直接編輯現有設定。",
        )

    cfg = LLMProviderConfig(
        tenant_id=tenant_id,
        provider=body.provider,
        label=body.label,
        api_key_encrypted=encrypt_api_key(body.api_key) if body.api_key else None,
        api_base_url=body.api_base_url,
        default_model=body.default_model,
        available_models=[e.model_dump() for e in body.available_models] if body.available_models else None,
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
    if body.available_models is not None:
        old_models: set[str] = {
            str(item.get("model", "")) if isinstance(item, dict) else str(item)
            for item in (cfg.available_models or [])
            if item
        }
        new_models: set[str] = {e.model for e in body.available_models}
        removed = old_models - new_models
        cfg.available_models = [e.model_dump() for e in body.available_models]
        _cascade_remove_models(db, tenant_id, removed)
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
    all_models: set[str] = {
        str(item.get("model", "")) if isinstance(item, dict) else str(item)
        for item in (cfg.available_models or [])
        if item
    }
    _cascade_remove_models(db, tenant_id, all_models)
    db.delete(cfg)
    db.commit()
    return None


# 各 provider 測試用預設模型
_TEST_DEFAULT_MODELS: dict[str, str] = {
    "openai": "gpt-4o-mini",
    "gemini": "gemini/gemini-2.5-flash",
    "anthropic": "anthropic/claude-3-5-haiku-20241022",
    "twcc": "twcc/Llama3.3-FFM-70B-32K",
}

_TWCC_MODEL_MAP: dict[str, str] = {
    "Llama3.1-FFM-8B-32K": "llama3.1-ffm-8b-32k-chat",
    "Llama3.3-FFM-70B-32K": "llama3.3-ffm-70b-32k-chat",
}

_TEST_MESSAGES = [{"role": "user", "content": "Reply with exactly one word: OK"}]


class TestLLMBody(BaseModel):
    model: Optional[str] = None


@router.post("/{config_id}/test")
async def test_llm_config(
    config_id: int,
    body: TestLLMBody = TestLLMBody(),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """測試 LLM provider 連通性（使用最短測試 prompt，計算回應時間）。
    body.model 可指定測試用的 model；未傳時使用 provider 預設測試 model。
    """
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

    # 決定測試用 model：優先使用呼叫端傳入的 model，否則用 provider 預設
    model = (body.model or "").strip() or _TEST_DEFAULT_MODELS.get(cfg.provider, "gpt-4o-mini")

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


# ──────────────────────────────────────────────────────────────────────────────
# Tenant-level 預設 LLM 設定
# ──────────────────────────────────────────────────────────────────────────────

def _get_or_create_tenant_config(db: Session, tenant_id: str) -> TenantConfig:
    """取得或自動建立 tenant_configs 列（應由 migration 補建，此為防禦性備援）。
    不預填 embedding 設定，由用戶在管理介面手動設定。
    """
    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()
    if not tc:
        tc = TenantConfig(tenant_id=tenant_id)
        db.add(tc)
        db.commit()
        db.refresh(tc)
    return tc


def _tc_response(tc: TenantConfig) -> TenantConfigResponse:
    """將 TenantConfig ORM 物件轉為 Response schema（含 speech_api_key_masked）。"""
    return TenantConfigResponse(
        tenant_id=tc.tenant_id,
        default_llm_provider=tc.default_llm_provider,
        default_llm_model=tc.default_llm_model,
        embedding_provider=tc.embedding_provider,
        embedding_model=tc.embedding_model,
        embedding_locked_at=tc.embedding_locked_at,
        embedding_version=tc.embedding_version,
        speech_provider=tc.speech_provider,
        speech_base_url=tc.speech_base_url,
        speech_api_key_masked=tc.speech_api_key_masked,
        speech_model=tc.speech_model,
        updated_at=tc.updated_at,
    )


@router.get("/tenant-config", response_model=TenantConfigResponse)
def get_tenant_config(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """取得目前租戶的 LLM 預設與 Embedding 設定（admin / super_admin）"""
    tenant_id = _require_tenant_admin(db, current)
    tc = _get_or_create_tenant_config(db, tenant_id)
    return _tc_response(tc)


@router.patch("/tenant-config/default-model", response_model=TenantConfigResponse)
def update_default_llm_model(
    body: DefaultLLMUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """更新租戶預設 LLM（provider + model）。可隨時更改，不影響向量索引。"""
    tenant_id = _require_tenant_admin(db, current)

    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"不支援的 provider，有效值：{sorted(VALID_PROVIDERS)}")

    # 確認此 provider 已有啟用中的設定
    provider_cfg = (
        db.query(LLMProviderConfig)
        .filter(
            LLMProviderConfig.tenant_id == tenant_id,
            LLMProviderConfig.provider == body.provider,
            LLMProviderConfig.is_active.is_(True),
        )
        .first()
    )
    if not provider_cfg:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{body.provider}' 尚未設定或已停用，請先在 LLM 設定中新增並啟用。",
        )

    tc = _get_or_create_tenant_config(db, tenant_id)
    tc.default_llm_provider = body.provider
    tc.default_llm_model = body.model
    db.commit()
    db.refresh(tc)
    return _tc_response(tc)


@router.post("/tenant-config/embedding/migrate", response_model=TenantConfigResponse)
def migrate_embedding_config(
    body: EmbeddingMigrateRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """
    遷移 Embedding model：清空向量索引、更新鎖定設定、version +1。
    此操作不可逆，需傳 confirm=true。原始文件不刪除，需重新上傳以 re-embed。
    """
    tenant_id = _require_tenant_admin(db, current)

    if not body.confirm:
        raise HTTPException(status_code=400, detail="必須傳 confirm=true 以確認此操作。")

    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"不支援的 provider，有效值：{sorted(VALID_PROVIDERS)}")

    # 確認新 provider 已有有效設定
    provider_cfg = (
        db.query(LLMProviderConfig)
        .filter(
            LLMProviderConfig.tenant_id == tenant_id,
            LLMProviderConfig.provider == body.provider,
            LLMProviderConfig.is_active.is_(True),
        )
        .first()
    )
    if not provider_cfg and body.provider != "local":
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{body.provider}' 尚未設定或已停用，請先設定 API Key。",
        )

    # 清空向量索引（刪除該 tenant 所有 km_chunks）
    doc_ids = db.query(KmDocument.id).filter(KmDocument.tenant_id == tenant_id).subquery()
    deleted = db.query(KmChunk).filter(KmChunk.document_id.in_(doc_ids)).delete(synchronize_session=False)

    # 將文件狀態重設為 pending，提示使用者重新上傳
    db.query(KmDocument).filter(
        KmDocument.tenant_id == tenant_id,
        KmDocument.status == "ready",
    ).update(
        {
            "status": "pending",
            "error_message": f"Embedding model 已遷移至 {body.provider}/{body.model}，請重新上傳文件以建立索引。",
        },
        synchronize_session=False,
    )

    # 更新 tenant_configs
    from datetime import datetime, timezone
    tc = _get_or_create_tenant_config(db, tenant_id)
    tc.embedding_provider = body.provider
    tc.embedding_model = body.model
    tc.embedding_locked_at = None   # 解鎖，待下次寫入時重新鎖定
    tc.embedding_version = (tc.embedding_version or 1) + 1
    db.commit()
    db.refresh(tc)

    import logging
    logging.getLogger(__name__).info(
        "Embedding 遷移完成：tenant=%s provider=%s model=%s 清除 chunks=%d",
        tenant_id, body.provider, body.model, deleted,
    )
    return _tc_response(tc)


@router.post("/tenant-config/embedding/test")
async def test_embedding_config(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """測試目前租戶的 embedding 設定是否可用（送一個短句驗證 API key 與 model 正確）。"""
    import asyncio
    tenant_id = _require_tenant_admin(db, current)

    # 直接呼叫 km_service 的 _get_embed_params 取得已鎖定設定
    from app.services.km_service import _get_embed_params, embed_texts_sync
    params = _get_embed_params(db, tenant_id)
    if not params:
        raise HTTPException(
            status_code=400,
            detail="Embedding 設定不完整：請確認已設定對應 provider 的 API Key。",
        )
    embed_provider, embed_model, embed_key, embed_base = params

    t0 = time.monotonic()
    try:
        # 在 executor 中執行同步的 embed_texts_sync，避免 blocking event loop
        loop = asyncio.get_event_loop()
        result, _tokens = await loop.run_in_executor(
            None,
            lambda: embed_texts_sync(
                ["測試連線 OK"],
                model=embed_model,
                api_key=embed_key,
                provider=embed_provider,
                api_base=embed_base,
            ),
        )
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        dim = len(result[0]) if result else 0
        return {"ok": True, "elapsed_ms": elapsed_ms, "model": embed_model, "dimensions": dim}
    except Exception as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {"ok": False, "elapsed_ms": elapsed_ms, "model": embed_model, "error": str(e)[:300]}


# ──────────────────────────────────────────────────────────────────────────────
# 語音模型設定
# ──────────────────────────────────────────────────────────────────────────────

@router.patch("/tenant-config/speech", response_model=TenantConfigResponse)
def update_speech_config(
    body: SpeechConfigUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """更新租戶語音轉文字設定（provider / base_url / api_key / model）。"""
    tenant_id = _require_tenant_admin(db, current)
    tc = _get_or_create_tenant_config(db, tenant_id)

    if body.provider is not None:
        tc.speech_provider = body.provider or None
    if body.base_url is not None:
        tc.speech_base_url = body.base_url or None
    if body.api_key is not None:
        if body.api_key == "":
            tc.speech_api_key_encrypted = None
        else:
            tc.speech_api_key_encrypted = encrypt_api_key(body.api_key)
    if body.model is not None:
        tc.speech_model = body.model or None

    db.commit()
    db.refresh(tc)
    return _tc_response(tc)


@router.post("/tenant-config/speech/test")
async def test_speech_config(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """測試語音服務是否可連線（對 /health 端點發送 GET 請求）。"""
    tenant_id = _require_tenant_admin(db, current)
    tc = _get_or_create_tenant_config(db, tenant_id)

    base_url = (tc.speech_base_url or "").rstrip("/")
    if not base_url:
        return {"ok": False, "error": "語音服務 Base URL 未設定"}

    import httpx
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/health")
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        if resp.status_code == 200:
            return {"ok": True, "elapsed_ms": elapsed_ms, "base_url": base_url}
        return {"ok": False, "elapsed_ms": elapsed_ms, "error": f"服務回應 HTTP {resp.status_code}"}
    except Exception as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {"ok": False, "elapsed_ms": elapsed_ms, "error": str(e)[:200]}

