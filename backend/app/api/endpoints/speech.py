"""語音轉文字 API（內部，JWT 認證）

端點：POST /api/v1/speech/transcribe
認證：Bearer JWT（登入使用者）
依賴：WHISPER_BASE_URL 環境變數指向 faster-whisper-server（OpenAI-compatible）

回應：
  { "text": "...", "language": "zh", "duration": 3.2 }
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User

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


@router.post(
    "/transcribe",
    response_model=TranscribeResponse,
    summary="語音轉文字",
    description=(
        "上傳音頻檔案（webm / mp4 / wav / ogg），回傳轉錄文字。"
        "需要設定 WHISPER_BASE_URL 環境變數指向 faster-whisper-server。"
    ),
)
async def transcribe_audio(
    file: UploadFile,
    language: str | None = None,
    current_user: User = Depends(get_current_user),
):
    base_url = (settings.WHISPER_BASE_URL or "").rstrip("/")
    if not base_url:
        raise HTTPException(
            status_code=503,
            detail="語音功能未啟用，請設定 WHISPER_BASE_URL 環境變數",
        )

    # 讀取上傳內容
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="音頻檔案為空")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail=f"音頻檔案過大（上限 {MAX_AUDIO_BYTES // 1024 // 1024} MB）")

    filename = file.filename or "audio.webm"
    content_type = (file.content_type or "audio/webm").lower()

    logger.info(
        "speech/transcribe: user=%s size=%d content_type=%s",
        current_user.email,
        len(audio_bytes),
        content_type,
    )

    # 呼叫 faster-whisper-server（OpenAI-compatible）
    url = f"{base_url}/v1/audio/transcriptions"
    post_data: dict = {"model": "Systran/faster-whisper-medium", "response_format": "verbose_json"}
    if language:
        post_data["language"] = language
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
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
        logger.error("whisper server connect error: %s", exc)
        raise HTTPException(status_code=503, detail="無法連線至語音轉文字服務") from exc
    except httpx.TimeoutException as exc:
        logger.error("whisper server timeout: %s", exc)
        raise HTTPException(status_code=504, detail="語音轉文字服務逾時") from exc

    data = resp.json()
    text = (data.get("text") or "").strip()
    language = data.get("language") or ""
    duration = float(data.get("duration") or 0.0)

    logger.info("speech/transcribe: text=%r lang=%s dur=%.1fs", text[:60], language, duration)
    return TranscribeResponse(text=text, language=language, duration=duration)


@router.get(
    "/status",
    summary="語音服務狀態",
    description="確認 Whisper 服務是否已設定且可連線。",
)
async def speech_status(
    current_user: User = Depends(get_current_user),
):
    base_url = (settings.WHISPER_BASE_URL or "").rstrip("/")
    if not base_url:
        return {"enabled": False, "reason": "WHISPER_BASE_URL 未設定"}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/health")
        if resp.status_code == 200:
            return {"enabled": True, "base_url": base_url}
        return {"enabled": False, "reason": f"服務回應 {resp.status_code}"}
    except Exception as exc:
        return {"enabled": False, "reason": str(exc)}
