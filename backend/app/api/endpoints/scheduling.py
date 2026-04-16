"""排班 API：POST /scheduling/solve（LLM 萃取 + OR-Tools 求解）"""
import json
import logging
import os
import re
from pathlib import Path
from typing import Annotated, Any

import litellm
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.endpoints.source_files import _check_agent_access
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.source_file import SourceFile
from app.models.user import User
from app.services.llm_service import _get_llm_params
from app.services.llm_utils import apply_api_base

router = APIRouter()
logger = logging.getLogger(__name__)


def _load_scheduling_extract_prompt() -> str:
    """讀取排班萃取 system prompt"""
    base = Path(__file__).resolve().parents[3]
    for root in (base.parent / "config", base / "config"):
        path = root / "system_prompt_scheduling_extract.md"
        if path.exists():
            try:
                return path.read_text(encoding="utf-8").strip()
            except (OSError, IOError) as e:
                logger.debug("scheduling extract prompt 讀取失敗: %s", e)
                return ""
    return ""


def _extract_json_from_llm_response(text: str) -> dict[str, Any] | None:
    """從 LLM 回覆中萃取 JSON（可能被 markdown 包住）"""
    text = (text or "").strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        if start >= 0:
            depth = 0
            for i, c in enumerate(text[start:], start):
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start : i + 1])
                        except json.JSONDecodeError:
                            break
    return None


async def _call_llm_extract(
    content: str,
    model: str,
    data: str = "",
    *,
    db: Session | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """呼叫 LLM 萃取排班參數"""
    litellm_model, api_key, api_base = _get_llm_params(model, db=db, tenant_id=tenant_id)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="LLM API Key 未設定，請在管理介面（租戶 LLM 設定）設定對應的 key",
        )

    system_prompt = _load_scheduling_extract_prompt()
    if not system_prompt:
        raise HTTPException(status_code=500, detail="排班萃取 prompt 檔案不存在")

    messages = [{"role": "system", "content": system_prompt}]
    user_content = content
    if data.strip():
        user_content = f"參考資料：\n\n{data.strip()}\n\n---\n\n使用者需求：\n{content}"
    messages.append({"role": "user", "content": user_content})

    if model.startswith("gemini/"):
        os.environ["GEMINI_API_KEY"] = api_key
    else:
        os.environ["OPENAI_API_KEY"] = api_key

    completion_kwargs: dict[str, Any] = {
        "model": litellm_model,
        "messages": messages,
        "api_key": api_key,
        "timeout": 30,
    }
    apply_api_base(completion_kwargs, api_base)
    if model.startswith("local/"):
        completion_kwargs["think"] = False

    resp = await litellm.acompletion(**completion_kwargs)
    if not resp.choices:
        raise HTTPException(status_code=500, detail="LLM 回傳無內容")
    raw = (resp.choices[0].message.content or "").strip()
    parsed = _extract_json_from_llm_response(raw)
    if not parsed:
        logger.warning("LLM 萃取失敗，原始回覆: %s", raw[:500])
        raise HTTPException(
            status_code=400,
            detail=f"無法從 LLM 回覆中解析 JSON。請明確描述人員、班別與每日需求。原始回覆前 200 字：{raw[:200]}",
        )
    return parsed


class SchedulingSolveRequest(BaseModel):
    agent_id: str
    content: str = ""
    constraints: dict[str, Any] | None = None
    model: str = "gpt-4o-mini"


class SchedulingSolveResponse(BaseModel):
    status: str
    assignments: list[dict[str, Any]]
    summary: str | None = None
    error: str | None = None


@router.post("/solve", response_model=SchedulingSolveResponse)
async def scheduling_solve(
    req: SchedulingSolveRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """排班求解：可傳 content（自然語言）或 constraints（結構化），經 OR-Tools 求解後回傳班表"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")

    tenant_id, aid = _check_agent_access(db, current, req.agent_id.strip())

    params: dict[str, Any]
    if req.constraints:
        params = req.constraints
    elif req.content.strip():
        data = ""
        rows = (
            db.query(SourceFile.file_name, SourceFile.content)
            .filter(
                SourceFile.user_id == current.id,
                SourceFile.tenant_id == tenant_id,
                SourceFile.agent_id == aid,
                SourceFile.is_selected.is_(True),
            )
            .order_by(SourceFile.file_name)
            .all()
        )
        for fn, c in rows:
            if c and c.strip():
                data += f"--- {fn} ---\n{c.strip()}\n\n"
        params = await _call_llm_extract(req.content.strip(), req.model, data, db=db, tenant_id=tenant_id)
    else:
        raise HTTPException(
            status_code=400,
            detail="請提供 content（自然語言描述）或 constraints（結構化參數）",
        )

    from app.services.scheduling import solve as solve_schedule
    result = solve_schedule(params)
    status = result.get("status", "UNKNOWN")
    assignments = result.get("assignments", [])
    error = result.get("error")

    summary = None
    if status in ("OPTIMAL", "FEASIBLE") and assignments:
        by_day: dict[int, list[str]] = {}
        for a in assignments:
            d = a.get("day", 0)
            if d not in by_day:
                by_day[d] = []
            by_day[d].append(f"{a.get('staff_name', '')} {a.get('shift_name', '')}")
        lines = [f"第 {d + 1} 天: " + ", ".join(by_day[d]) for d in sorted(by_day)]
        summary = "\n".join(lines)

    return SchedulingSolveResponse(
        status=status,
        assignments=assignments,
        summary=summary,
        error=error,
    )
