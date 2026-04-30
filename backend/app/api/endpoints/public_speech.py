"""公開語音轉文字 API：外部 App 透過 API Key 呼叫 STT

端點：POST /api/v1/public/speech/transcribe
認證：X-API-Key header
"""
import logging
from datetime import date
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.api_key_auth import get_api_key
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.api_key import ApiKey, ApiKeyUsage
from app.models.tenant_config import TenantConfig

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
    "application/octet-stream",
}
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB


class SpeechTranscribeResponse(BaseModel):
    text: str
    language: str = ""
    duration: float = 0.0


def _record_speech_usage(
    db: Session,
    api_key_id: int,
    audio_seconds: float,
) -> None:
    today = date.today()
    row = db.query(ApiKeyUsage).filter(
        ApiKeyUsage.api_key_id == api_key_id,
        ApiKeyUsage.date == today,
    ).first()
    if row:
        row.request_count += 1
        row.audio_seconds = float(row.audio_seconds or 0.0) + audio_seconds
    else:
        row = ApiKeyUsage(
            api_key_id=api_key_id,
            date=today,
            request_count=1,
            input_tokens=0,
            output_tokens=0,
            audio_seconds=audio_seconds,
        )
        db.add(row)
    db.commit()


@router.post(
    "/transcribe",
    response_model=SpeechTranscribeResponse,
    summary="語音轉文字",
    description=(
        "透過 API Key 上傳音頻檔案（webm / mp4 / wav / ogg），回傳轉錄文字。\n\n"
        "需先由管理員在「AI 設定」中設定語音模型。\n\n"
        "Rate limit：每個 API Key 每小時最多 200 次請求。"
    ),
    response_description="轉錄文字、語言與音頻秒數",
)
@limiter.limit("200/hour")
async def public_transcribe(
    request: Request,
    file: UploadFile,
    language: str | None = None,
    db: Annotated[Session, Depends(get_db)] = ...,
    api_key: Annotated[ApiKey, Depends(get_api_key)] = ...,
):
    tenant_id = api_key.tenant_id
    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()

    provider = (tc and tc.speech_provider) or ""
    if not provider:
        raise HTTPException(
            status_code=503,
            detail="語音功能未啟用，請管理員在「AI 設定」中設定語音模型",
        )

    model = (tc and tc.speech_model) or (
        "whisper-1" if provider == "openai" else "Systran/faster-whisper-medium"
    )

    if provider == "openai":
        from app.core.encryption import decrypt_api_key
        from app.models.llm_provider_config import LLMProviderConfig
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
            speech_api_key = decrypt_api_key(llm_cfg.api_key_encrypted)
        except Exception:
            raise HTTPException(status_code=500, detail="OpenAI API Key 解密失敗")
        base_url = (llm_cfg.api_base_url or "https://api.openai.com").rstrip("/")
    else:
        base_url = (tc.speech_base_url or "").rstrip("/")
        if not base_url:
            raise HTTPException(
                status_code=503,
                detail="語音服務 Base URL 未設定，請管理員在「AI 設定」中填入 Base URL",
            )
        speech_api_key = None
        if tc.speech_api_key_encrypted:
            try:
                from app.core.encryption import decrypt_api_key
                speech_api_key = decrypt_api_key(tc.speech_api_key_encrypted)
            except Exception:
                logger.warning("public speech: API key 解密失敗")

    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="音頻檔案為空")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"音頻檔案過大（上限 {MAX_AUDIO_BYTES // 1024 // 1024} MB）",
        )

    filename = file.filename or "audio.webm"
    content_type = (file.content_type or "audio/webm").lower()

    logger.info(
        "public speech/transcribe: tenant=%s api_key_id=%d size=%d",
        tenant_id,
        api_key.id,
        len(audio_bytes),
    )

    headers: dict = {}
    if speech_api_key:
        headers["Authorization"] = f"Bearer {speech_api_key}"

    url = f"{base_url}/v1/audio/transcriptions"
    post_data: dict = {
        "model": model,
        "response_format": "verbose_json",
        "temperature": "0",
        "prompt": "以下是繁體中文的語音記錄。",
    }
    if language:
        post_data["language"] = language
    if provider != "openai":
        post_data["vad_filter"] = "true"

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
            raise HTTPException(
                status_code=502,
                detail=f"語音轉文字服務異常（{resp.status_code}）",
            )
    except httpx.ConnectError as exc:
        logger.error("public speech: connect error: %s", exc)
        raise HTTPException(status_code=503, detail="無法連線至語音轉文字服務") from exc
    except httpx.TimeoutException as exc:
        logger.error("public speech: timeout: %s", exc)
        raise HTTPException(status_code=504, detail="語音轉文字服務逾時") from exc

    data = resp.json()
    text = (data.get("text") or "").strip()
    lang = data.get("language") or ""
    duration = float(data.get("duration") or 0.0)

    _record_speech_usage(db, api_key_id=api_key.id, audio_seconds=duration)

    logger.info(
        "public speech/transcribe: text=%r lang=%s dur=%.1fs",
        text[:60],
        lang,
        duration,
    )
    return SpeechTranscribeResponse(text=text, language=lang, duration=duration)
