"""語音轉文字 API（內部，JWT 認證）

端點：POST /api/v1/speech/transcribe
認證：Bearer JWT（登入使用者）
設定：從 tenant_configs.speech_* 欄位讀取（管理員在 Admin > AI 設定 中配置）

回應：
  { "text": "...", "language": "zh", "duration": 3.2 }
"""

import logging
import time

import httpx
import opencc as _opencc

# 簡體 → 繁體轉換器（s2twp: 簡體轉台灣繁體+詞彙替換）
_s2tw = _opencc.OpenCC("s2twp")
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.tenant_config import TenantConfig
from app.models.user import User
from app.services.agent_usage import log_agent_usage

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_AUDIO_TYPES = {
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
    "audio/x-m4a",
    "application/octet-stream",  # 部分瀏覽器不帶 MIME
}
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB（與 OpenAI Whisper 上限一致）


class TranscribeResponse(BaseModel):
    text: str
    language: str = ""
    duration: float = 0.0


def _get_tenant_id(db: Session, current_user: User) -> str:
    u = db.query(User).filter(User.id == current_user.id).first()
    if not u:
        raise HTTPException(status_code=401, detail="使用者不存在")
    tid = (getattr(u, "tenant_id", None) or "").strip()
    if not tid:
        raise HTTPException(status_code=403, detail="使用者未綁定租戶")
    return tid


@router.post(
    "/transcribe",
    response_model=TranscribeResponse,
    summary="語音轉文字",
    description="上傳音頻檔案（webm / mp4 / wav / ogg），回傳轉錄文字。需先在管理介面設定語音模型。",
)
async def transcribe_audio(
    file: UploadFile,
    language: str | None = Form(None),
    voice_prompt: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _get_tenant_id(db, current_user)
    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()

    provider = (tc and tc.speech_provider) or ""
    if not provider:
        raise HTTPException(
            status_code=503,
            detail="語音功能未啟用，請管理員在「AI 設定」中設定語音模型",
        )

    model = (tc and tc.speech_model) or ("whisper-1" if provider == "openai" else "Systran/faster-whisper-medium")

    # 依 provider 決定 base_url 與 api_key
    if provider == "openai":
        # 從 LLM Provider 設定取用 OpenAI API Key（不需重複設定）
        from app.models.llm_provider_config import LLMProviderConfig
        from app.core.encryption import decrypt_api_key
        llm_cfg = (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == tenant_id,
                LLMProviderConfig.provider == "openai",
                LLMProviderConfig.is_active.is_(True),
            )
            .first()
        )
        if not llm_cfg or not llm_cfg.api_key_encrypted:
            raise HTTPException(
                status_code=503,
                detail="語音功能需要 OpenAI API Key，請先在 LLM Provider 設定中新增並啟用 OpenAI",
            )
        try:
            api_key = decrypt_api_key(llm_cfg.api_key_encrypted)
        except Exception:
            raise HTTPException(status_code=500, detail="OpenAI API Key 解密失敗")
        base_url = (llm_cfg.api_base_url or "https://api.openai.com").rstrip("/")
    else:
        # local 或其他：從 speech config 讀取
        base_url = (tc.speech_base_url or "").rstrip("/")
        if not base_url:
            raise HTTPException(
                status_code=503,
                detail="語音功能未啟用，請管理員設定語音模型的 Base URL",
            )
        api_key = None
        if tc.speech_api_key_encrypted:
            try:
                from app.core.encryption import decrypt_api_key
                api_key = decrypt_api_key(tc.speech_api_key_encrypted)
            except Exception:
                logger.warning("speech: API key 解密失敗")

    # 讀取上傳內容
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="音頻檔案為空")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail=f"音頻檔案過大（上限 {MAX_AUDIO_BYTES // 1024 // 1024} MB）")

    filename = file.filename or "audio.webm"
    content_type = (file.content_type or "audio/webm").lower()

    logger.info(
        "speech/transcribe: user=%s tenant=%s size=%d content_type=%s",
        current_user.email,
        tenant_id,
        len(audio_bytes),
        content_type,
    )

    headers: dict = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{base_url}/v1/audio/transcriptions"
    post_data: dict = {
        "model": model,
        "response_format": "verbose_json",
        "temperature": "0",
        "prompt": voice_prompt or "以下是繁體中文的語音記錄。",
    }
    if language:
        post_data["language"] = language
    if provider != "openai":
        post_data["vad_filter"] = "true"
        if voice_prompt:
            post_data["hotwords"] = voice_prompt

    logger.info("speech/transcribe: post_data=%s", {k: v for k, v in post_data.items() if k != 'file'})

    started_at = time.monotonic()
    status = "success"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                files={"file": (filename, audio_bytes, content_type)},
                data=post_data,
            )
        if resp.status_code != 200:
            logger.error("whisper server error %d: %s", resp.status_code, resp.text[:300])
            status = "error"
            raise HTTPException(
                status_code=502,
                detail=f"語音轉文字服務異常（{resp.status_code}）",
            )
    except httpx.ConnectError as exc:
        logger.error("whisper server connect error: %s", exc)
        status = "error"
        raise HTTPException(status_code=503, detail="無法連線至語音轉文字服務") from exc
    except httpx.TimeoutException as exc:
        logger.error("whisper server timeout: %s", exc)
        status = "error"
        raise HTTPException(status_code=504, detail="語音轉文字服務逾時") from exc
    finally:
        log_agent_usage(
            db=db,
            agent_type="speech",
            tenant_id=tenant_id,
            user_id=current_user.id,
            model=model,
            latency_ms=int((time.monotonic() - started_at) * 1000),
            status=status,
        )
        db.commit()

    data = resp.json()
    text = _s2tw.convert((data.get("text") or "").strip())
    lang = data.get("language") or ""
    duration = float(data.get("duration") or 0.0)

    logger.info("speech/transcribe: text=%r lang=%s dur=%.1fs", text[:60], lang, duration)
    return TranscribeResponse(text=text, language=lang, duration=duration)


@router.get(
    "/status",
    summary="語音服務狀態",
    description="確認目前租戶的語音服務是否已設定且可連線。",
)
async def speech_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _get_tenant_id(db, current_user)
    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()

    provider = (tc and tc.speech_provider) or ""
    if not provider:
        return {"enabled": False, "reason": "語音模型未設定"}

    if provider == "openai":
        return {"enabled": True, "provider": "openai", "model": tc.speech_model or "whisper-1"}

    base_url = ((tc and tc.speech_base_url) or "").rstrip("/")
    if not base_url:
        return {"enabled": False, "reason": "語音服務 Base URL 未設定"}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/health")
        if resp.status_code == 200:
            return {"enabled": True, "base_url": base_url, "model": tc.speech_model}
        return {"enabled": False, "reason": f"服務回應 {resp.status_code}"}
    except Exception as exc:
        return {"enabled": False, "reason": str(exc)}
