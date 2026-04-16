"""Chat Compute Tool API：POST /chat/completions-compute-tool-stream。LLM 意圖萃取 → Backend 計算 → 文字生成

主要路徑（産品用）：LLM 輸出結構化 intent（**v4.0**）→ DuckDB SQL 計算 → Markdown 分析文字（串流）。
直接計算路徑：POST /chat/compute-engine（duckdb_name + schema_id + intent）。
"""
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import litellm
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session
from uuid import UUID

from app.api.endpoints.source_files import _check_agent_access
from app.api.endpoints.chat import ChatRequest
from app.core.config import settings
from app.core.database import get_db
from app.models.bi_project import BiProject
from app.core.security import get_current_user
from app.services.llm_service import (
    _get_llm_params,
    _get_provider_name,
    _twcc_model_id,
)
from app.services.llm_utils import apply_api_base
from app.models.user import User
from app.schemas.intent_v4 import (
    IntentV4,
    USER_FACING_INTENT_V4_VALIDATION_MESSAGE,
    _USER_FACING_INTENT_V4_VALIDATION_MESSAGE_INTERNAL,
    auto_repair_intent,
    is_intent_v4_payload,
)
from app.services.compute_engine import run_compute_engine
from app.services.duckdb_store import execute_sql_on_duckdb_file, get_project_duckdb_path
from app.services.schema_loader import load_schema_from_db

router = APIRouter()
logger = logging.getLogger(__name__)

# 使用者常用全形書名號標示專有名詞；易使 LLM 複製進 JSON filter value。意圖萃取前剔除，內文保留。
_CJK_BOOK_BRACKETS_TO_STRIP = "『』「」﹃﹄﹁﹂"


def _normalize_question_for_intent_extraction(text: str | None) -> str:
    """供意圖萃取 user 訊息用：移除全形書名號，保留內文。"""
    if not text:
        return ""
    return text.translate(str.maketrans("", "", _CJK_BOOK_BRACKETS_TO_STRIP))


_MISSING_SCHEMA_MSG = "未設定資料 schema：請先以 CSV 匯入並選定模板，或於請求帶入 schema_id"


def _pydantic_errors_json_safe(e: ValidationError) -> list[Any]:
    """
    e.errors() 內 ctx 可能含 Exception 實例（如 model_validator 的 ValueError），
    無法 json.dumps；改為與 Pydantic 對外 JSON 一致的可序列化結構。
    """
    return json.loads(e.json())


def _resolve_schema_def(
    db: Session,
    *,
    req_schema_id: str | None,
    proj_schema_id: str | None,
) -> tuple[str, dict[str, Any]]:
    """依請求覆寫或專案欄位解析 bi_schemas，無預設 id。

    回傳的 str 一律為 **bi_schemas 主鍵 id**（與資料列一致），不因請求曾帶入 name 而回傳顯示名稱。
    """
    lookup = (req_schema_id or "").strip() or (proj_schema_id or "").strip()
    if not lookup:
        raise HTTPException(status_code=400, detail=_MISSING_SCHEMA_MSG)
    schema_def = load_schema_from_db(lookup, db)
    if not schema_def:
        raise HTTPException(
            status_code=404,
            detail=f"Schema 不存在：{lookup}，請確認 bi_schemas 表已匯入範本",
        )
    canonical = str(schema_def.get("id") or "").strip()
    if not canonical:
        raise HTTPException(status_code=500, detail="Schema 資料異常：bi_schemas 列缺少主鍵 id")
    return canonical, schema_def


_SQL_ONLY_NO_PROJECT = (
    "計算已統一為 DuckDB SQL：請使用帶 project_id 的 API（例如 intent-to-compute-by-project）"
    " 或 POST /chat/compute-engine（duckdb_name）；不接受僅 in-memory rows。"
)

_NO_INTENT_JSON_MSG = (
    "暫時無法從回覆中取得有效的分析結構。"
    "請用較具體的方式描述，例如：**時間範圍**、**想看的數字**（如銷售額、筆數），或稍後再試一次。"
)


def _debug_payload(debug: dict[str, Any]) -> dict[str, Any] | None:
    """EXPOSE_COMPUTE_ERROR_DETAIL=True 時才回傳 debug；否則傳 None（不暴露 SQL/內部欄位）。"""
    return debug if settings.EXPOSE_COMPUTE_ERROR_DETAIL else None


def _clean_chart_result(chart_result: dict[str, Any] | None) -> dict[str, Any] | None:
    """移除 chart_result 內的內部 metadata（computeEngine）。"""
    if not chart_result or not isinstance(chart_result, dict):
        return chart_result
    return {k: v for k, v in chart_result.items() if k != "computeEngine"}


def _compute_with_intent(
    intent: dict[str, Any],
    schema_def: dict[str, Any],
    *,
    duckdb_project_id: str | None = None,
) -> tuple[dict[str, Any] | None, list[str], dict[str, Any] | None]:
    """Intent v4.0 計算經 run_compute_engine（DuckDB SQL）。無 project_id 時無法執行。"""
    if not (duckdb_project_id or "").strip():
        return None, [_SQL_ONLY_NO_PROJECT], None
    name = duckdb_project_id.strip()
    chart, err_detail, dbg = run_compute_engine(name, intent, schema_def)
    if chart is not None:
        extra = dict(dbg) if dbg else {}
        extra["compute_engine_sql"] = True
        return chart, [], extra
    out_errs = [err_detail] if err_detail else ["DuckDB SQL 計算失敗"]
    return None, out_errs, dbg


def _user_message_for_compute_errors(
    err_list: list[str],
    *,
    detail: bool = False,
    sql_debug: str | None = None,
) -> str:
    msg = "; ".join(err_list) if err_list else ""
    expose = settings.EXPOSE_COMPUTE_ERROR_DETAIL

    def _append_technical_lines(friendly: str) -> str:
        lines: list[str] = []
        if expose or detail:
            if msg.strip():
                lines.append(f"【除錯】{msg.strip()}")
            if (sql_debug or "").strip():
                lines.append(f"【SQL】{(sql_debug or '').strip()}")
        if not lines:
            return friendly
        return f"{friendly}\n\n" + "\n".join(lines)

    if "篩選後無資料" in msg or "無資料" in msg or "無資料列" in msg:
        return _append_technical_lines("查無符合條件的資料，請調整篩選條件或時間範圍。")
    if "計算已統一為 DuckDB SQL" in msg or "僅 in-memory rows" in msg:
        if (expose or detail) and (sql_debug or "").strip():
            return f"{msg}\n\n【SQL】{(sql_debug or '').strip()}"
        return msg
    if "_resolve_columns" in msg or "rows 為空" in msg:
        return _append_technical_lines("無法解析欄位對應，請確認問題描述與資料 schema。")
    if "不存在於此資料集的欄位" in msg:
        return _append_technical_lines("資料欄位 AI 對應失敗，請換個方式描述您的問題或稍後再試一次。")
    if detail and msg:
        tail = f"\n\n【SQL】{(sql_debug or '').strip()}" if (sql_debug or "").strip() else ""
        return f"後端計算失敗：{msg}{tail}"
    if msg and expose:
        return _append_technical_lines("後端計算失敗，請稍後再試或調整問題描述。")
    return "後端計算失敗，請稍後再試或調整問題描述。"


_PROMPT_FILES = {
    "intent": "system_prompt_analysis_intent_tool.md",
    "text": "system_prompt_analysis_text_tool.md",
}


def _load_prompt(prompt_key: str) -> str:
    base = Path(__file__).resolve().parents[3]
    filename = _PROMPT_FILES.get(prompt_key, "")
    for root in (base.parent / "config", base / "config"):
        path = root / filename
        if path.exists():
            try:
                return path.read_text(encoding="utf-8").strip()
            except (OSError, IOError) as e:
                logger.debug("讀取 %s 失敗: %s", filename, e)
    return ""


def _build_schema_block(schema_def: dict[str, Any] | None) -> str:
    """從 schema_def.columns 產生 Data Schema 區塊，按維度／數值分群。"""
    if not schema_def or not schema_def.get("columns"):
        return "- (無 schema 定義)"
    columns = schema_def.get("columns") or {}

    dim_lines: list[str] = []
    val_lines: list[str] = []

    for field, meta in columns.items():
        if not isinstance(meta, dict):
            continue
        a = (meta.get("attr") or "dim").strip().lower()
        aliases = meta.get("aliases") or []
        display = ", ".join(str(x) for x in aliases) if aliases else field
        enum_vals: list[str] = [str(x) for x in (meta.get("enum_values") or []) if x is not None]
        if a == "dim_time":
            dim_lines.append(f"- {field}: {display}（時間，可用 MONTH/QUARTER/YEAR 分組）")
        elif a in ("dim", "dim_text"):
            if enum_vals:
                dim_lines.append(f"- {field}: {display}（可選值：{', '.join(enum_vals)}）")
            else:
                dim_lines.append(f"- {field}: {display}")
        else:  # val, val_num, val_denom ...
            val_lines.append(f"- {field}: {display}")

    parts: list[str] = []
    if dim_lines:
        parts.append("【維度欄位 — 可用於 dims.groups 及 filters】\n" + "\n".join(dim_lines))
    if val_lines:
        parts.append("【數值欄位 — 可用於 formula 聚合（SUM/AVG/COUNT）】\n" + "\n".join(val_lines))
    return "\n\n".join(parts) if parts else "- (無欄位)"



def _build_hierarchy_block(schema_def: dict[str, Any] | None) -> str:
    """從 schema_def.dimension_hierarchy 產生維度層級區塊，格式與 prompt 內一致。"""
    if not schema_def or not schema_def.get("dimension_hierarchy"):
        return "- (無層級定義)"
    lines: list[str] = []
    for label, cols in (schema_def.get("dimension_hierarchy") or {}).items():
        if not isinstance(cols, list):
            continue
        cols_str = " > ".join(str(c) for c in cols if c)
        if cols_str:
            lines.append(f"- {label}：{cols_str}")
    return "\n".join(lines) if lines else "- (無層級)"


def _load_intent_prompt() -> str:
    """載入 intent system prompt template（schema 已移至 user message，無需注入）。"""
    return _load_prompt("intent") or ""


def _build_user_content_intent(
    schema_def: dict[str, Any] | None,
    now_str: str,
    question: str,
) -> str:
    """組裝 intent 萃取的 user message：schema 區塊在最前，問題在最後。"""
    schema_block = _build_schema_block(schema_def)
    hierarchy_block = _build_hierarchy_block(schema_def)
    return (
        f"# Data Schema\n{schema_block}\n\n"
        f"**層級** {hierarchy_block}\n\n"
        f"**輸出的每個 col_N 必須出現在上方 Data Schema 的 columns 清單中**\n\n"
        f"當前時間：{now_str}\n\n"
        f"問題: {question}"
    )


def _extract_json_from_llm(raw: str) -> dict | None:
    """從 LLM 回覆中萃取第一個 JSON 物件（尊重字串內含 `}`，勿僅用括號深度截斷）。"""
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    start = text.find("{")
    if start < 0:
        return None
    dec = json.JSONDecoder()
    try:
        obj, _end = dec.raw_decode(text[start:])
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def _validate_intent_payload(
    intent: dict[str, Any],
) -> tuple[str, ValidationError | None]:
    """v4.0 唯一支援版本。非 v4.0 直接回傳 validation 失敗。
    注意：呼叫前應先執行 auto_repair_intent()。"""
    if not is_intent_v4_payload(intent):
        return "not_v4", None  # 特殊標記：非 v4 格式
    try:
        IntentV4.model_validate(intent)
        return "v4", None
    except ValidationError as e:
        return "v4", e


def _user_message_for_intent_validation_failure(kind: str) -> str:
    if kind == "not_v4":
        return (
            "僅支援 Intent v4.0（需含 \"version\": \"4.0\"）。"
            "請確認意圖生成使用最新 prompt。"
        )
    return USER_FACING_INTENT_V4_VALIDATION_MESSAGE


def _extract_first_validation_detail(verr: ValidationError) -> str | None:
    """從 Pydantic ValidationError 提取第一條最有意義的錯誤訊息（中文優先）。"""
    try:
        errs = verr.errors()
        for e in errs:
            msg = str(e.get("msg") or "")
            # 過濾掉 Pydantic 內建的通用訊息，只回傳我們自訂的中文訊息
            if msg and any(kw in msg for kw in ("formula", "group_override", "metric", "欄位", "不合法", "佔位符", "alias")):
                loc = " → ".join(str(x) for x in (e.get("loc") or []))
                return f"【詳細原因】{loc}：{msg}" if loc else f"【詳細原因】{msg}"
    except Exception:
        pass
    return None


def _internal_message_for_intent_validation_failure(kind: str) -> str:
    """開發者用：包含技術細節，放入 debug 欄位，不直接顯示給終端用戶。"""
    if kind == "v4":
        return _USER_FACING_INTENT_V4_VALIDATION_MESSAGE_INTERNAL
    return _user_message_for_intent_validation_failure(kind)


def _chart_result_to_detail_lines(chart_result: dict[str, Any]) -> list[str]:
    """將 compute_aggregate 的 chart_result 轉為給 LLM 的「類別 = 數值」格式"""
    detail_lines: list[str] = []
    labels = chart_result.get("labels")
    if not isinstance(labels, list) or not labels:
        return detail_lines

    group_details = chart_result.get("groupDetails")
    if isinstance(group_details, list) and len(group_details) == len(labels):
        display_labels = []
        for d in group_details:
            if isinstance(d, dict) and d:
                display_labels.append(" > ".join(str(v) for v in d.values()))
            else:
                display_labels.append("")
        display_labels = [dl if dl.strip() else labels[i] for i, dl in enumerate(display_labels)]
    else:
        display_labels = labels

    datasets = chart_result.get("datasets")
    if datasets and isinstance(datasets, list) and len(datasets) > 0:
        min_ds_len = None
        for ds in datasets:
            if isinstance(ds, dict) and isinstance(ds.get("data"), list):
                n = len(ds["data"])
                min_ds_len = n if min_ds_len is None else min(min_ds_len, n)
        n_rows = len(display_labels)
        if min_ds_len is not None:
            n_rows = min(n_rows, min_ds_len)
        for i in range(n_rows):
            x_label = display_labels[i]
            parts = []
            for ds in datasets:
                if isinstance(ds, dict):
                    lbl = ds.get("label", "")
                    data = ds.get("data")
                    if isinstance(data, list) and i < len(data):
                        v = data[i]
                        val_str = int(v) if isinstance(v, (int, float)) and v == int(v) else v
                        parts.append(f"{lbl} {val_str}")
            if parts:
                detail_lines.append(f"  {x_label}: " + ", ".join(parts))
    else:
        data = chart_result.get("data")
        if isinstance(data, list) and len(data) == len(labels):
            for i, lbl in enumerate(display_labels):
                v = data[i]
                val_str = int(v) if isinstance(v, (int, float)) and v == int(v) else v
                detail_lines.append(f"  {lbl} = {val_str}")
    return detail_lines


class ComputeEngineRequest(BaseModel):
    """compute_engine：DuckDB 名稱 + intent；schema_id 可於請求或 intent 根層級帶入。"""
    duckdb_name: str
    intent: dict[str, Any]
    schema_id: str = ""


class ComputeEngineResponse(BaseModel):
    """compute_engine 專用：含 debug（例如產生的 SQL）。"""
    chart_result: dict[str, Any] | None
    error_detail: str | None = None
    debug: dict[str, Any] | None = None
    generated_sql: str | None = None


async def _call_llm(
    model: str,
    system_prompt: str,
    user_content: str,
    db=None,
    tenant_id: str | None = None,
) -> tuple[str, dict | None]:
    """呼叫 LLM，回傳 (content, usage)"""
    litellm_model, api_key, api_base = _get_llm_params(model, db=db, tenant_id=tenant_id)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(model)} API Key 未設定，請在管理介面（租戶 LLM 設定）設定對應的 key",
        )
    if model.startswith("twcc/") and not api_base:
        raise HTTPException(status_code=503, detail="台智雲 TWCC_API_BASE 未設定，請在管理介面（租戶 LLM 設定）設定")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    if model.startswith("twcc/"):
        import aiohttp
        url = (api_base or "").rstrip("/")
        model_id = _twcc_model_id(model[5:])
        payload = {
            "model": model_id,
            "messages": messages,
            "parameters": {
                "max_new_tokens": 2000,
                "temperature": 0.01,
                "top_k": 40,
                "top_p": 0.9,
                "frequency_penalty": 1.2,
            },
        }
        headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                if not resp.ok:
                    err_body = await resp.text()
                    raise HTTPException(
                        status_code=resp.status,
                        detail=f"TWCC API 錯誤 {resp.status}：{err_body}",
                    )
                data = await resp.json()
        content = data.get("generated_text", "") or ""
        usage = {
            "prompt_tokens": data.get("prompt_tokens", 0),
            "completion_tokens": data.get("generated_tokens", data.get("completion_tokens", 0)),
            "total_tokens": data.get("total_tokens", 0),
        }
        return content, usage

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
    apply_api_base(completion_kwargs, api_base)
    if model.startswith("local/"):
        completion_kwargs["think"] = False

    resp = await litellm.acompletion(**completion_kwargs)
    choices = getattr(resp, "choices", None) or []
    msg = choices[0].message if choices else None
    content = (getattr(msg, "content", None) or "") if msg else ""
    usage = None
    u = getattr(resp, "usage", None)
    if u:
        usage = {
            "prompt_tokens": getattr(u, "prompt_tokens", 0),
            "completion_tokens": getattr(u, "completion_tokens", 0),
            "total_tokens": getattr(u, "total_tokens", 0),
        }
    return content, usage


def _sse_event(data: dict[str, Any]) -> str:
    """產生 SSE 格式字串：data: {json}\\n\\n"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _stream_compute_tool(
    req: ChatRequest,
    db: Session,
    user_id: int,
    tenant_id: str,
):
    """SSE 串流：每個階段完成時 yield 事件。"""
    yield _sse_event({"stage": "intent"})

    pid = (req.project_id or "").strip()
    try:
        uuid_pid = UUID(pid)
    except ValueError:
        yield _sse_event({"stage": "done", "error_stage": "setup", "content": "project_id 格式錯誤", "chart_data": None})
        return

    try:
        proj = _ensure_bi_project_duckdb_has_data(pid, db, user_id)
    except HTTPException as e:
        yield _sse_event({"stage": "done", "error_stage": "setup", "content": e.detail, "chart_data": None})
        return

    try:
        _, schema_def = _resolve_schema_def(
            db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
        )
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else str(e.detail)
        yield _sse_event({"stage": "done", "error_stage": "setup", "content": detail, "chart_data": None})
        return
    model = (req.model or "").strip() or "gpt-4o-mini"
    intent_prompt = _load_intent_prompt()
    if not intent_prompt:
        yield _sse_event({"stage": "done", "error_stage": "intent", "content": "Intent prompt 檔案不存在", "chart_data": None})
        return

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    q_for_intent = _normalize_question_for_intent_extraction(req.content)
    user_content_intent = _build_user_content_intent(schema_def, now_str, q_for_intent)
    try:
        intent_raw, usage1 = await _call_llm(model, intent_prompt, user_content_intent, db=db, tenant_id=tenant_id)
    except Exception as e:
        logger.exception("意圖萃取 LLM 呼叫失敗")
        yield _sse_event({"stage": "done", "error_stage": "intent", "content": f"意圖萃取失敗：{e}", "chart_data": None})
        return

    intent = _extract_json_from_llm(intent_raw)
    if not intent or not isinstance(intent, dict):
        yield _sse_event({
            "stage": "done",
            "error_stage": "intent",
            "content": _NO_INTENT_JSON_MSG,
            "chart_data": None,
        })
        return
    intent = auto_repair_intent(intent)
    kind, verr = _validate_intent_payload(intent)
    if verr is not None:
        logger.info("Intent 驗證失敗（compute-tool-stream）kind=%s: %s", kind, verr.errors())
        base_msg = _user_message_for_intent_validation_failure(kind)
        detail = _extract_first_validation_detail(verr)
        yield _sse_event({
            "stage": "done",
            "error_stage": "intent",
            "content": f"{base_msg}\n\n{detail}" if detail else base_msg,
            "chart_data": None,
            **({"intent_validation_errors": _pydantic_errors_json_safe(verr),
                "intent_validation_message_internal": _internal_message_for_intent_validation_failure(kind),
                "intent_invalid_draft": intent} if settings.EXPOSE_COMPUTE_ERROR_DETAIL else {}),
        })
        return

    yield _sse_event({"stage": "compute"})

    chart_result, error_list, ce_debug = _compute_with_intent(
        intent, schema_def, duckdb_project_id=pid
    )

    if not chart_result:
        sql_s = None
        if ce_debug and isinstance(ce_debug.get("sql"), str):
            sql_s = ce_debug["sql"]
        content = _user_message_for_compute_errors(error_list, sql_debug=sql_s)
        logger.info("compute 階段失敗: error_list=%s -> content=%s", error_list, content)
        payload: dict[str, Any] = {
            "stage": "done",
            "error_stage": "compute",
            "content": content,
            "chart_data": None,
            "compute_errors_raw": list(error_list),
        }
        if ce_debug and settings.EXPOSE_COMPUTE_ERROR_DETAIL:
            payload["compute_debug"] = ce_debug
        yield _sse_event(payload)
        return

    if not chart_result.get("yAxisLabel") and chart_result.get("valueLabel"):
        chart_result["yAxisLabel"] = chart_result["valueLabel"]

    detail_lines = _chart_result_to_detail_lines(chart_result)
    if not detail_lines:
        yield _sse_event({
            "stage": "done",
            "error_stage": "compute",
            "content": "無法格式化計算結果。請調整問題或檢查 schema。",
            "chart_data": None,
        })
        return

    yield _sse_event({"stage": "text"})

    text_prompt = _load_prompt("text")
    if not text_prompt:
        text_prompt = "根據計算結果撰寫分析文字，使用 Markdown 格式。圖表由後端負責，只輸出文字。"
    detail_block = "計算結果：\n" + "\n".join(detail_lines)
    ai_block = f"AI 設定與補充指示：\n{req.user_prompt.strip()}\n\n" if (req.user_prompt or "").strip() else ""
    user_content_text = f"""{ai_block}使用者問題：{req.content}

{detail_block}

請撰寫分析文字，金額與數字必須與上述完全一致。"""

    try:
        text_content, usage2 = await _call_llm(model, text_prompt, user_content_text, db=db, tenant_id=tenant_id)
    except Exception as e:
        logger.exception("文字生成 LLM 呼叫失敗")
        yield _sse_event({
            "stage": "done",
            "error_stage": "text",
            "content": f"分析文字生成失敗：{e}",
            "chart_data": _clean_chart_result(chart_result),
        })
        return

    final_content = text_content.strip()

    total_usage: dict[str, int] = {}
    if usage1:
        for k, v in usage1.items():
            total_usage[k] = total_usage.get(k, 0) + v
    if usage2:
        for k, v in usage2.items():
            total_usage[k] = total_usage.get(k, 0) + v

    yield _sse_event({
        "stage": "done",
        "content": final_content,
        "chart_data": _clean_chart_result(chart_result),
        "model": model,
        "usage": total_usage,
    })


@router.post("/completions-compute-tool-stream")
async def chat_completions_compute_tool_stream(
    req: ChatRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """SSE 串流版：每個階段 emit 進度事件，前端可顯示「意圖解析中…」「計算中…」「分析建議…」。"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required（compute flow 僅支援 BI 專案）")
    try:
        _check_agent_access(db, current, req.agent_id.strip())
    except HTTPException:
        raise

    user_id = int(getattr(current, "id", 0) or 0)
    tenant_id = str(getattr(current, "tenant_id", "") or "")
    return StreamingResponse(
        _stream_compute_tool(req, db, user_id, tenant_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



def _ensure_bi_project_duckdb_has_data(pid: str, db: Session, user_id: int) -> BiProject:
    """驗證專案權限、DuckDB 存在且 data 表有資料；不做 SELECT * 全表載入。"""
    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")
    proj = db.query(BiProject).filter(BiProject.project_id == uuid_pid).first()
    if proj is None or str(getattr(proj, "user_id", "")) != str(user_id):
        raise HTTPException(status_code=404, detail="專案不存在或無權限")
    duckdb_path = get_project_duckdb_path(pid)
    if not duckdb_path:
        raise HTTPException(
            status_code=400,
            detail=f"DuckDB 檔案不存在（project_id={pid}），請確認專案已匯入資料",
        )
    df = execute_sql_on_duckdb_file(duckdb_path, "SELECT COUNT(*) AS c FROM data")
    if df is None or df.empty or int(df.iloc[0]["c"]) < 1:
        raise HTTPException(
            status_code=400,
            detail=f"DuckDB 檔案存在但無資料（project_id={pid}），請重新匯入",
        )
    logger.info("已驗證專案 DuckDB 有資料 project_id=%s", pid)
    return proj



@router.post("/compute-engine", response_model=ComputeEngineResponse)
async def compute_engine_endpoint(
    req: ComputeEngineRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """依 DuckDB 名稱載入 data 表，經 compute_engine 產出圖表結構。"""
    _ = current
    if not (req.duckdb_name or "").strip():
        raise HTTPException(status_code=400, detail="duckdb_name 必填")
    intent_in = req.intent or {}
    if not isinstance(intent_in, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")
    schema_id = (req.schema_id or "").strip() or str(intent_in.get("schema_id") or "").strip()
    intent = {k: v for k, v in intent_in.items() if k != "schema_id"}
    if not schema_id:
        raise HTTPException(
            status_code=400,
            detail="schema_id 必填（請求欄位 schema_id 或 intent 內 schema_id，bi_schemas.id）",
        )
    _, schema_def = _resolve_schema_def(db, req_schema_id=schema_id, proj_schema_id=None)
    chart_result, error_detail, debug = run_compute_engine(req.duckdb_name, intent, schema_def)
    gen_sql = debug.get("sql") if isinstance(debug.get("sql"), str) else None
    expose = settings.EXPOSE_COMPUTE_ERROR_DETAIL
    return ComputeEngineResponse(
        chart_result=_clean_chart_result(chart_result),
        error_detail=error_detail,
        debug=debug if expose else None,
        generated_sql=gen_sql if expose else None,
    )


# ---------------------------------------------------------------------------
# Pipeline Inspector（開發用）：一次回傳 prompt / intent / SQL / result
# ---------------------------------------------------------------------------

class PipelineInspectRequest(BaseModel):
    question: str
    project_id: str
    schema_id: str | None = None
    model: str | None = None
    user_prompt: str | None = None


class PipelineInspectResponse(BaseModel):
    injected_prompt: str
    user_content: str
    intent_raw: str
    intent: dict | None
    intent_usage: dict | None
    sql: str | None
    sql_params: list | None
    chart_result: dict | None
    error: str | None
    stage_failed: str | None


@router.post("/pipeline-inspect", response_model=PipelineInspectResponse)
async def pipeline_inspect(
    req: PipelineInspectRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """開發用：逐步跑完 v4 pipeline，回傳 injected_prompt / intent / SQL / chart_result 供檢查。"""
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id 必填")

    user_id = int(getattr(current, "id", 0) or 0)

    # --- 確認專案有資料 ---
    try:
        proj = _ensure_bi_project_duckdb_has_data(pid, db, user_id)
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e

    # --- 載入 schema ---
    try:
        _, schema_def = _resolve_schema_def(
            db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
        )
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e

    model = (req.model or "").strip() or "gpt-4o-mini"

    # --- 建 system prompt ---
    injected_prompt = _load_intent_prompt() or ""
    if not injected_prompt:
        raise HTTPException(status_code=500, detail="Intent prompt 檔案不存在")

    # --- LLM 意圖萃取 ---
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    q_for_intent = _normalize_question_for_intent_extraction(req.question)
    user_content_intent = _build_user_content_intent(schema_def, now_str, q_for_intent)

    try:
        tid = str(getattr(current, "tenant_id", "") or "")
        intent_raw, usage1 = await _call_llm(model, injected_prompt, user_content_intent, db=db, tenant_id=tid)
    except Exception as e:
        return PipelineInspectResponse(
            injected_prompt=injected_prompt,
            user_content=user_content_intent,
            intent_raw="",
            intent=None,
            intent_usage=None,
            sql=None,
            sql_params=None,
            chart_result=None,
            error=f"意圖萃取 LLM 失敗：{e}",
            stage_failed="intent_llm",
        )

    intent = _extract_json_from_llm(intent_raw)
    if not intent or not isinstance(intent, dict):
        return PipelineInspectResponse(
            injected_prompt=injected_prompt,
            user_content=user_content_intent,
            intent_raw=intent_raw,
            intent=None,
            intent_usage=dict(usage1) if usage1 else None,
            sql=None,
            sql_params=None,
            chart_result=None,
            error="LLM 未回傳有效 JSON intent",
            stage_failed="intent_parse",
        )

    intent = auto_repair_intent(intent)
    kind, verr = _validate_intent_payload(intent)
    if verr is not None:
        base_msg = _user_message_for_intent_validation_failure(kind)
        detail_msg = _extract_first_validation_detail(verr)
        return PipelineInspectResponse(
            injected_prompt=injected_prompt,
            user_content=user_content_intent,
            intent_raw=intent_raw,
            intent=intent,
            intent_usage=dict(usage1) if usage1 else None,
            sql=None,
            sql_params=None,
            chart_result=None,
            error=f"{base_msg}\n{detail_msg}" if detail_msg else base_msg,
            stage_failed="intent_validate",
        )

    # --- 計算 ---
    chart_result, error_list, ce_debug = _compute_with_intent(intent, schema_def, duckdb_project_id=pid)
    sql_out = ce_debug.get("sql") if isinstance((ce_debug or {}).get("sql"), str) else None
    sql_params = ce_debug.get("sql_params") if ce_debug else None
    if not isinstance(sql_params, list):
        sql_params = None

    if not chart_result:
        return PipelineInspectResponse(
            injected_prompt=injected_prompt,
            user_content=user_content_intent,
            intent_raw=intent_raw,
            intent=intent,
            intent_usage=dict(usage1) if usage1 else None,
            sql=sql_out,
            sql_params=sql_params,
            chart_result=None,
            error="; ".join(error_list) if error_list else "計算失敗",
            stage_failed="compute",
        )

    return PipelineInspectResponse(
        injected_prompt=injected_prompt,
        user_content=user_content_intent,
        intent_raw=intent_raw,
        intent=intent,
        intent_usage=dict(usage1) if usage1 else None,
        sql=sql_out,
        sql_params=sql_params,
        chart_result=_clean_chart_result(chart_result),
        error=None,
        stage_failed=None,
    )
