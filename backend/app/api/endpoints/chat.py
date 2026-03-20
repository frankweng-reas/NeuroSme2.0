"""Chat API：POST /chat/completions（LiteLLM 統一支援 OpenAI / Gemini / 台智雲）"""
import json
import logging
import os
from pathlib import Path
from typing import Annotated

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import litellm
from sqlalchemy.orm import Session

from uuid import UUID

from app.api.endpoints.source_files import _check_agent_access
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bi_project import BiProject
from app.models.bi_source import BiSource
from app.models.qtn_catalog import QtnCatalog
from app.models.qtn_project import QtnProject
from app.models.qtn_source import QtnSource
from app.models.source_file import SourceFile
from app.models.user import User
from app.services.duckdb_store import get_project_data_as_csv

router = APIRouter()
logger = logging.getLogger(__name__)

# 台智雲模型名稱對照：前端格式 -> API 格式（小寫連字號 + -chat）
_TWCC_MODEL_MAP: dict[str, str] = {
    "Llama3.1-FFM-8B-32K": "llama3.1-ffm-8b-32k-chat",
    "Llama3.3-FFM-70B-32K": "llama3.3-ffm-70b-32k-chat",
}


def _get_llm_params(model: str) -> tuple[str, str | None, str | None]:
    """
    依 model 回傳 (litellm_model, api_key, api_base)。
    api_base 僅台智雲需要，其他為 None。
    """
    if model.startswith("gemini/"):
        return model, settings.GEMINI_API_KEY or None, None
    if model.startswith("twcc/"):
        # 台智雲：使用專用 conversation API，此處僅回傳 key/base 供 _call_twcc_conversation 使用
        litellm_model = f"openai/{model[5:]}"  # 保留格式，實際由 _call_twcc_conversation 處理
        return litellm_model, settings.TWCC_API_KEY or None, settings.TWCC_API_BASE or None
    return model, settings.OPENAI_API_KEY or None, None


class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""

    class Config:
        extra = "ignore"  # 忽略 meta 等額外欄位


class ChatRequest(BaseModel):
    agent_id: str = ""  # chat.py 必填；chat_dev 不填
    project_id: str = ""  # quotation_parse 時可填，改從 qtn_sources 取參考資料
    prompt_type: str = ""  # 空或 analysis → system_prompt_analysis.md；quotation_parse → system_prompt_quotation_1_parse.md
    system_prompt: str = ""
    user_prompt: str = ""
    data: str = ""  # 保留，chat.py 由後端組 data 時忽略
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


def _build_messages(req: ChatRequest, data: str = "") -> list[dict]:
    """組裝 OpenAI messages 格式。data 由後端依 agent_id 查詢已選取來源檔案組出"""
    msgs: list[dict] = []
    system_parts: list[str] = []
    file_prompt = _load_system_prompt_from_file(req.prompt_type)
    if file_prompt:
        system_parts.append(file_prompt)
    if req.system_prompt.strip():
        system_parts.append(req.system_prompt.strip())
    if data.strip():
        system_parts.append(f"以下為參考資料：\n\n{data.strip()}")
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


def _twcc_model_id(frontend_model: str) -> str:
    """將前端模型名稱轉為台智雲 API 格式。例：Llama3.1-FFM-8B-32K -> llama3.1-ffm-8b-32k-chat"""
    key = frontend_model.strip()
    if key in _TWCC_MODEL_MAP:
        return _TWCC_MODEL_MAP[key]
    #  fallback：小寫、空格/大寫轉連字號，加 -chat
    normalized = key.lower().replace(" ", "-").replace("_", "-")
    return f"{normalized}-chat" if not normalized.endswith("-chat") else normalized


async def _call_twcc_conversation(
    url: str,
    api_key: str,
    model_id: str,
    messages: list[dict],
) -> ChatResponse:
    """
    直接呼叫台智雲 Conversation API。
    端點：https://api-ams.twcc.ai/api/models/conversation
    Header：X-API-KEY
    """
    payload = {
        "model": model_id,
        "messages": messages,
        "parameters": {
            "max_new_tokens": 2000,
            "temperature": 0,
            "top_k": 40,
            "top_p": 0.9,
            "frequency_penalty": 1.2,
        },
    }
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            data = await resp.json()

    # 台智雲回應格式：generated_text, prompt_tokens, generated_tokens, total_tokens, finish_reason
    content = data.get("generated_text", "") or ""
    usage = None
    if "prompt_tokens" in data or "total_tokens" in data:
        usage = UsageMeta(
            prompt_tokens=data.get("prompt_tokens", 0),
            completion_tokens=data.get("generated_tokens", data.get("completion_tokens", 0)),
            total_tokens=data.get("total_tokens", 0),
        )
    return ChatResponse(
        content=content,
        model=model_id,
        usage=usage,
        finish_reason=data.get("finish_reason"),
    )


def _get_provider_name(model: str) -> str:
    if model.startswith("gemini/"):
        return "Gemini"
    if model.startswith("twcc/"):
        return "台智雲"
    return "OpenAI"


def _get_selected_source_files_content(db: Session, user_id: int, tenant_id: str, agent_id: str) -> str:
    """依 user_id, tenant_id, agent_id 查詢已選取來源檔案的 content，拼接回傳（含檔名標記以利 LLM 判讀）"""
    rows = (
        db.query(SourceFile.file_name, SourceFile.content)
        .filter(
            SourceFile.user_id == user_id,
            SourceFile.tenant_id == tenant_id,
            SourceFile.agent_id == agent_id,
            SourceFile.is_selected.is_(True),
        )
        .order_by(SourceFile.file_name)
        .all()
    )
    parts = []
    for file_name, content in rows:
        if content and content.strip():
            parts.append(f"--- 檔名：{file_name} ---\n{content.strip()}")
    result = "\n\n".join(parts)
    if not result.strip():
        # 診斷：查詢同條件下總檔案數與已選取數
        total = db.query(SourceFile).filter(
            SourceFile.user_id == user_id,
            SourceFile.tenant_id == tenant_id,
            SourceFile.agent_id == agent_id,
        ).count()
        selected = db.query(SourceFile).filter(
            SourceFile.user_id == user_id,
            SourceFile.tenant_id == tenant_id,
            SourceFile.agent_id == agent_id,
            SourceFile.is_selected.is_(True),
        ).count()
        logger.info(
            "chat 查詢參考資料為空: user_id=%s tenant_id=%r aid=%r → 總檔案=%d 已選取=%d",
            user_id,
            tenant_id,
            agent_id,
            total,
            selected,
        )
    return result


def _get_bi_sources_content(db: Session, user_id: int, project_id: str) -> str:
    """依 project_id 查詢 bi_sources 的 content（is_selected=True），拼接回傳（專案須屬於該 user）"""
    try:
        pid = UUID(project_id)
    except ValueError:
        return ""
    proj = db.query(BiProject).filter(BiProject.project_id == pid).first()
    if not proj or proj.user_id != str(user_id):
        return ""
    rows = (
        db.query(BiSource.file_name, BiSource.content)
        .filter(BiSource.project_id == pid, BiSource.is_selected.is_(True))
        .order_by(BiSource.file_name)
        .all()
    )
    parts = []
    for file_name, content in rows:
        if content and content.strip():
            parts.append(f"--- 檔名：{file_name} ---\n{content.strip()}")
    return "\n\n".join(parts)


def _get_qtn_sources_content(db: Session, user_id: int, project_id: str) -> str:
    """依 project_id 查詢 qtn_sources 的 content，拼接回傳（專案須屬於該 user）。
    source_type=OFFERING 時，依 file_name 對應 qtn_catalog.catalog_name 取得 content。"""
    try:
        pid = UUID(project_id)
    except ValueError:
        return ""
    proj = db.query(QtnProject).filter(QtnProject.project_id == pid).first()
    if not proj or proj.user_id != str(user_id):
        return ""
    rows = (
        db.query(QtnSource.file_name, QtnSource.source_type, QtnSource.content)
        .filter(QtnSource.project_id == pid)
        .order_by(QtnSource.source_type, QtnSource.file_name)
        .all()
    )
    parts = []
    for file_name, stype, src_content in rows:
        if stype == "OFFERING":
            cat = (
                db.query(QtnCatalog)
                .filter(
                    QtnCatalog.tenant_id == proj.tenant_id,
                    QtnCatalog.catalog_name == file_name,
                )
                .first()
            )
            content = cat.content if (cat and cat.content) else src_content
        else:
            content = src_content
        if content and content.strip():
            label = "產品/服務清單" if stype == "OFFERING" else "需求描述"
            parts.append(f"--- [{label}] {file_name} ---\n{content.strip()}")
    return "\n\n".join(parts)


def _get_qtn_final_content(db: Session, user_id: int, project_id: str) -> str:
    """依 project_id 查詢 qtn_projects.qtn_final，轉為可讀文字供 LLM 參考。
    會補上計算後的小計、稅額、總金額，確保 LLM 取得與畫面一致的數字。"""
    try:
        pid = UUID(project_id)
    except ValueError:
        return ""
    proj = db.query(QtnProject).filter(QtnProject.project_id == pid).first()
    if not proj or proj.user_id != str(user_id) or not proj.qtn_final:
        return ""
    data = dict(proj.qtn_final)
    items = data.get("items") or []
    if isinstance(items, list):
        subtotal_sum = sum(
            float(i.get("subtotal", 0) or 0)
            for i in items
            if isinstance(i, dict)
        )
        subtotal_sum = round(subtotal_sum * 100) / 100
    else:
        subtotal_sum = 0
    tax_rate = float(data.get("tax_rate") or 0)
    tax_amount = round(subtotal_sum * tax_rate * 100) / 100
    total_amount = subtotal_sum + tax_amount
    data["_computed"] = {
        "subtotal_sum": subtotal_sum,
        "tax_rate": tax_rate,
        "tax_amount": tax_amount,
        "total_amount": total_amount,
        "currency": data.get("currency") or "TWD",
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


_PROMPT_TYPE_FILES: dict[str, str] = {
    "quotation_parse": "system_prompt_quotation_1_parse.md",
    "quotation_share": "system_prompt_quotation_4_share.md",
    "analysis": "system_prompt_analysis.md",
}


def _load_system_prompt_from_file(prompt_type: str = "") -> str:
    """依 prompt_type 讀取對應的 config/*.md，改檔即生效無需重啟"""
    key = (prompt_type or "").strip() or "analysis"
    filename = _PROMPT_TYPE_FILES.get(key, _PROMPT_TYPE_FILES["analysis"])
    base = Path(__file__).resolve().parents[3]  # backend/ 或 Docker 的 /app
    for root in (base.parent / "config", base / "config"):
        path = root / filename
        if path.exists():
            try:
                return path.read_text(encoding="utf-8").strip()
            except (OSError, IOError) as e:
                logger.debug("%s 讀取失敗: %s", filename, e)
                return ""
    return ""


@router.post("/completions", response_model=ChatResponse)
async def chat_completions(
    req: ChatRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    logger.info(f"chat_completions: model={req.model!r}, content_len={len(req.content) if req.content else 0}")
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    try:
        tenant_id, aid = _check_agent_access(db, current, req.agent_id.strip())

        # quotation_parse + project_id：從 qtn_sources 取資料
        # quotation_share + project_id：從 qtn_final 取資料
        # project_id + bi_project：從 DuckDB 取資料（get_project_data_as_csv）
        # 否則從 source_files
        pt = (req.prompt_type or "").strip()
        pid = (req.project_id or "").strip()
        if pt == "quotation_parse" and pid:
            data = _get_qtn_sources_content(db, current.id, pid)
        elif pt == "quotation_share" and pid:
            data = _get_qtn_final_content(db, current.id, pid)
        elif pid:
            try:
                bi_proj = db.query(BiProject).filter(BiProject.project_id == UUID(pid)).first()
                if bi_proj and bi_proj.user_id == str(current.id):
                    data = get_project_data_as_csv(pid) or ""
                else:
                    data = _get_selected_source_files_content(db, current.id, tenant_id, aid)
            except ValueError:
                data = _get_selected_source_files_content(db, current.id, tenant_id, aid)
        else:
            data = _get_selected_source_files_content(db, current.id, tenant_id, aid)
        data_len = len(data.strip()) if data else 0
        max_chars = settings.CHAT_DATA_MAX_CHARS
        if data_len > max_chars:
            raise HTTPException(
                status_code=413,
                detail=f"參考資料超過 {max_chars:,} 字元（目前約 {data_len:,} 字元），請減少選用的來源檔案後再試。",
            )
        if data_len == 0:
            if pt == "quotation_parse":
                raise HTTPException(
                    status_code=400,
                    detail="請先選擇專案並上傳產品/服務清單與需求描述後再進行解析。",
                )
            if pt == "quotation_share":
                raise HTTPException(
                    status_code=400,
                    detail="請先完成報價單（步驟 3）並進入發送跟進步驟後再生成建議。",
                )
            if pid:
                try:
                    bi_proj = db.query(BiProject).filter(BiProject.project_id == UUID(pid)).first()
                    if bi_proj and bi_proj.user_id == str(current.id):
                        raise HTTPException(
                            status_code=400,
                            detail="DuckDB 尚無資料，請先在 CSV 分頁匯入資料",
                        )
                except HTTPException:
                    raise
                except ValueError:
                    pass
            logger.warning(
                "chat_completions: 無參考資料 (agent_id=%r, tenant_id=%r, aid=%r, user_id=%s) - 請在該 agent 頁面左欄上傳並勾選來源檔案",
                req.agent_id,
                tenant_id,
                aid,
                current.id,
            )
        else:
            logger.info("chat_completions: 已載入參考資料 %d 字元", data_len)

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

        messages = _build_messages(req, data=data)

        if model.startswith("twcc/"):
            # 台智雲：直接呼叫 Conversation API（X-API-KEY、/models/conversation）
            url = (api_base or "").rstrip("/")
            if not url:
                raise HTTPException(
                    status_code=503,
                    detail="台智雲 TWCC_API_BASE 未設定，請在 .env 設定為 https://api-ams.twcc.ai/api/models/conversation",
                )
            model_id = _twcc_model_id(model[5:])  # twcc/Llama3.1-FFM-8B-32K -> Llama3.1-FFM-8B-32K
            return await _call_twcc_conversation(url=url, api_key=api_key, model_id=model_id, messages=messages)

        if model.startswith("gemini/"):
            os.environ["GEMINI_API_KEY"] = api_key
        else:
            os.environ["OPENAI_API_KEY"] = api_key

        completion_kwargs: dict = {
            "model": litellm_model,
            "messages": messages,
            "api_key": api_key,
            "timeout": 60,
            "temperature": 0,
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
