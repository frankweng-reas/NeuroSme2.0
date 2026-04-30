"""Widget API：無需登入，以 public_token 驗證知識庫存取"""
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx
import litellm
import opencc as _opencc
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.tenant_config import TenantConfig

_s2tw = _opencc.OpenCC("s2twp")
from app.models.widget_message import WidgetMessage
from app.models.widget_session import WidgetSession
from app.services.agent_usage import log_agent_usage
from app.services.km_service import format_km_context, km_retrieve_sync
from app.services.llm_service import _get_llm_params, _get_provider_name
from app.services.llm_utils import apply_api_base
from app.services.chat_service import _load_system_prompt_from_file

router = APIRouter()
logger = logging.getLogger(__name__)


# ── helpers ──────────────────────────────────────────────────────────────────


def _get_kb_by_token(token: str, db: Session) -> KmKnowledgeBase:
    kb = db.query(KmKnowledgeBase).filter(KmKnowledgeBase.public_token == token).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Widget 不存在或已停用")
    return kb


# ── Schemas ───────────────────────────────────────────────────────────────────


class WidgetInfoResponse(BaseModel):
    kb_id: int
    title: str
    logo_url: str | None
    color: str
    lang: str
    voice_enabled: bool

    model_config = {"from_attributes": True}


class SessionCreateRequest(BaseModel):
    session_id: str
    visitor_name: str | None = None
    visitor_email: str | None = None
    visitor_phone: str | None = None


class SessionResponse(BaseModel):
    session_id: str
    visitor_name: str | None
    visitor_email: str | None
    visitor_phone: str | None
    created_at: str


class WidgetChatRequest(BaseModel):
    session_id: str
    messages: list[dict] = []
    content: str


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/{token}/info", response_model=WidgetInfoResponse)
def widget_info(token: str, db: Session = Depends(get_db)):
    """取得 Widget 基本設定（title、logo、主色、語言）"""
    kb = _get_kb_by_token(token, db)
    return WidgetInfoResponse(
        kb_id=kb.id,
        title=kb.widget_title or kb.name,
        logo_url=kb.widget_logo_url,
        color=kb.widget_color or "#1A3A52",
        lang=kb.widget_lang or "zh-TW",
        voice_enabled=kb.widget_voice_enabled or False,
    )


@router.get("/{token}/session/{session_id}")
def check_session(token: str, session_id: str, db: Session = Depends(get_db)):
    """驗證 session 是否仍有效（前端用於判斷是否清除本地 session）"""
    kb = _get_kb_by_token(token, db)
    session = db.query(WidgetSession).filter(
        WidgetSession.id == session_id,
        WidgetSession.kb_id == kb.id,
    ).first()
    return {"valid": session is not None}


@router.post("/{token}/session", response_model=SessionResponse, status_code=201)
def create_or_update_session(
    token: str,
    body: SessionCreateRequest,
    db: Session = Depends(get_db),
):
    """建立或更新 Widget Session（訪客資訊）"""
    kb = _get_kb_by_token(token, db)

    session = db.query(WidgetSession).filter(WidgetSession.id == body.session_id).first()
    if session:
        if body.visitor_name is not None:
            session.visitor_name = body.visitor_name
        if body.visitor_email is not None:
            session.visitor_email = body.visitor_email
        if body.visitor_phone is not None:
            session.visitor_phone = body.visitor_phone
        session.last_active_at = datetime.now(timezone.utc)
    else:
        session = WidgetSession(
            id=body.session_id,
            kb_id=kb.id,
            visitor_name=body.visitor_name,
            visitor_email=body.visitor_email,
            visitor_phone=body.visitor_phone,
        )
        db.add(session)

    db.commit()
    db.refresh(session)
    return SessionResponse(
        session_id=session.id,
        visitor_name=session.visitor_name,
        visitor_email=session.visitor_email,
        visitor_phone=session.visitor_phone,
        created_at=session.created_at.isoformat(),
    )


@router.post("/{token}/chat")
async def widget_chat(
    token: str,
    body: WidgetChatRequest,
    db: Session = Depends(get_db),
):
    """Widget 對話（SSE streaming）"""
    kb = _get_kb_by_token(token, db)

    # 先把所有需要的 kb 屬性提取為 local 變數，避免 commit 後 ORM expire 問題
    kb_id: int = kb.id
    kb_tenant_id: str = kb.tenant_id
    kb_model_name: str = (kb.model_name or "").strip()
    kb_system_prompt: str | None = (kb.system_prompt or "").strip() or None

    if not kb_model_name:
        raise HTTPException(
            status_code=400,
            detail="此知識庫尚未設定模型，請聯繫管理員",
        )

    litellm_model, api_key, api_base = _get_llm_params(
        kb_model_name, db=db, tenant_id=kb_tenant_id
    )
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(kb_model_name)} API Key 未設定",
        )

    # RAG 取參考資料（與 chat.py 相同做法：直接同步呼叫）
    context_text = ""
    try:
        chunks = km_retrieve_sync(
            query=body.content,
            tenant_id=kb_tenant_id,
            db=db,
            knowledge_base_id=kb_id,
            skip_scope_check=True,
            agent_id="widget",
        )
        if chunks:
            context_text = format_km_context(chunks, show_source=False)
    except Exception as e:
        logger.warning("Widget RAG 失敗，略過參考資料: %s", e)

    # 組 messages
    msgs: list[dict] = []
    system_parts: list[str] = []

    if kb_system_prompt:
        system_parts.append(kb_system_prompt)
    else:
        file_prompt = _load_system_prompt_from_file("cs")
        if file_prompt:
            system_parts.append(file_prompt)

    if context_text:
        system_parts.append(f"以下為參考資料：\n\n{context_text}")

    if system_parts:
        msgs.append({"role": "system", "content": "\n\n".join(system_parts)})

    # 只保留最近 6 則歷史（3 來回），避免 token 無限增長（local model 尤重要）
    MAX_HISTORY = 6
    history = body.messages[-MAX_HISTORY:] if len(body.messages) > MAX_HISTORY else body.messages
    for m in history:
        msgs.append({"role": m["role"], "content": m["content"]})

    msgs.append({"role": "user", "content": body.content})

    # session + user 訊息一次寫入
    session = db.query(WidgetSession).filter(WidgetSession.id == body.session_id).first()
    if session:
        session.last_active_at = datetime.now(timezone.utc)
    db.add(WidgetMessage(session_id=body.session_id, role="user", content=body.content))
    db.commit()

    is_local_model = kb_model_name.startswith("local/")
    session_id = body.session_id
    tenant_id_for_log = kb_tenant_id

    async def generate() -> AsyncIterator[str]:
        t0 = time.perf_counter()
        llm_status = "success"
        usage_out: tuple[int, int, int] | None = None  # (prompt, completion, total)
        try:
            kwargs: dict = {
                "model": litellm_model,
                "messages": msgs,
                "stream": True,
                "stream_options": {"include_usage": True},
                "api_key": api_key,
                "temperature": 0.3,
            }
            apply_api_base(kwargs, api_base)
            # Ollama thinking models（local/）預設啟用 thinking，需停用
            if is_local_model:
                kwargs["think"] = False

            response = await litellm.acompletion(**kwargs)
            full_text = ""
            async for chunk in response:
                # usage-only chunk（stream 結束後補送）
                if not chunk.choices:
                    u = getattr(chunk, "usage", None)
                    if u is not None:
                        try:
                            usage_out = (
                                int(getattr(u, "prompt_tokens", None) or 0),
                                int(getattr(u, "completion_tokens", None) or 0),
                                int(getattr(u, "total_tokens", None) or 0),
                            )
                        except (TypeError, ValueError):
                            pass
                    continue
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_text += delta
                    yield f"data: {json.dumps({'event': 'delta', 'text': delta}, ensure_ascii=False)}\n\n"
                # 有些 provider 在有 choices 的 chunk 也帶 usage
                u = getattr(chunk, "usage", None)
                if u is not None:
                    try:
                        pt = getattr(u, "prompt_tokens", None)
                        ct = getattr(u, "completion_tokens", None)
                        tt = getattr(u, "total_tokens", None)
                        if pt is not None or ct is not None or tt is not None:
                            usage_out = (int(pt or 0), int(ct or 0), int(tt or 0))
                    except (TypeError, ValueError):
                        pass

            yield f"data: {json.dumps({'event': 'done', 'content': full_text}, ensure_ascii=False)}\n\n"

            # 儲存 assistant 訊息
            if full_text:
                try:
                    db.add(WidgetMessage(session_id=session_id, role="assistant", content=full_text))
                    db.commit()
                except Exception as save_err:
                    logger.warning("儲存 assistant 訊息失敗: %s", save_err)
        except Exception as e:
            llm_status = "error"
            logger.error("Widget chat 錯誤: %s", e)
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
        finally:
            s = SessionLocal()
            try:
                log_agent_usage(
                    db=s,
                    agent_type="widget",
                    tenant_id=tenant_id_for_log,
                    model=kb_model_name,
                    prompt_tokens=usage_out[0] if usage_out else None,
                    completion_tokens=usage_out[1] if usage_out else None,
                    total_tokens=usage_out[2] if usage_out else None,
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                    status=llm_status,
                )
                s.commit()
            except Exception as log_err:
                logger.warning("Widget LLM usage log 失敗: %s", log_err)
            finally:
                s.close()

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Widget Speech（語音轉文字，public_token 認證）────────────────────────────

_WIDGET_SPEECH_MAX_BYTES = 25 * 1024 * 1024  # 25 MB


class WidgetSpeechResponse(BaseModel):
    text: str
    language: str = ""
    duration: float = 0.0


@router.post("/{token}/speech", response_model=WidgetSpeechResponse)
async def widget_speech(
    token: str,
    file: UploadFile,
    language: str | None = None,
    db: Session = Depends(get_db),
):
    """Widget 語音轉文字（以 public_token 驗證，使用租戶語音設定）"""
    kb = _get_kb_by_token(token, db)
    tenant_id = kb.tenant_id
    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()

    provider = (tc and tc.speech_provider) or ""
    if not provider:
        raise HTTPException(status_code=503, detail="此 Widget 尚未啟用語音功能，請管理員在「AI 設定」中設定語音模型")

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
            raise HTTPException(status_code=503, detail="語音功能需要 OpenAI API Key，請管理員設定")
        try:
            api_key = decrypt_api_key(llm_cfg.api_key_encrypted)
        except Exception:
            raise HTTPException(status_code=500, detail="OpenAI API Key 解密失敗")
        base_url = (llm_cfg.api_base_url or "https://api.openai.com").rstrip("/")
    else:
        base_url = (tc.speech_base_url or "").rstrip("/")
        if not base_url:
            raise HTTPException(status_code=503, detail="語音服務 Base URL 未設定")
        api_key = None
        if tc.speech_api_key_encrypted:
            try:
                from app.core.encryption import decrypt_api_key
                api_key = decrypt_api_key(tc.speech_api_key_encrypted)
            except Exception:
                logger.warning("widget speech: API key 解密失敗")

    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="音頻檔案為空")
    if len(audio_bytes) > _WIDGET_SPEECH_MAX_BYTES:
        raise HTTPException(status_code=413, detail="音頻檔案過大（上限 25 MB）")

    filename = file.filename or "audio.webm"
    content_type = (file.content_type or "audio/webm").lower()
    logger.info("widget speech: token=%s tenant=%s size=%d", token[:8], tenant_id, len(audio_bytes))

    headers: dict = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{base_url}/v1/audio/transcriptions"
    voice_prompt = kb.widget_voice_prompt or ""
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

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                files={"file": (filename, audio_bytes, content_type)},
                data=post_data,
            )
        if resp.status_code != 200:
            logger.error("widget speech: whisper error %d: %s", resp.status_code, resp.text[:300])
            raise HTTPException(status_code=502, detail=f"語音轉文字服務異常（{resp.status_code}）")
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail="無法連線至語音轉文字服務") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="語音轉文字服務逾時") from exc

    data = resp.json()
    text = _s2tw.convert((data.get("text") or "").strip())
    lang = data.get("language") or ""
    duration = float(data.get("duration") or 0.0)
    logger.info("widget speech: text=%r lang=%s dur=%.1fs", text[:60], lang, duration)
    return WidgetSpeechResponse(text=text, language=lang, duration=duration)
