"""Chat Compute Tool API：POST /chat/completions-compute-tool。LLM 意圖萃取 → Backend 計算 → 文字生成

全新 Tool Calling 路徑：不產生 SQL，LLM 只輸出結構化 JSON，計算由 analysis_compute 負責。
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
from pydantic import BaseModel
from sqlalchemy.orm import Session
from uuid import UUID

from app.api.endpoints.chat import (
    ChatRequest,
    _check_agent_access,
    _get_llm_params,
    _get_provider_name,
    _twcc_model_id,
)
from app.core.database import get_db
from app.models.bi_project import BiProject
from app.core.security import get_current_user
from app.models.user import User
from app.services.analysis_compute import compute_aggregate, get_schema_summary
from app.services.duckdb_store import execute_sql_on_duckdb_file, get_project_duckdb_path
from app.services.schema_loader import load_schema_from_db

router = APIRouter()
logger = logging.getLogger(__name__)

_MISSING_SCHEMA_MSG = "未設定資料 schema：請先以 CSV 匯入並選定模板，或於請求帶入 schema_id"


def _resolve_schema_def(
    db: Session,
    *,
    req_schema_id: str | None,
    proj_schema_id: str | None,
) -> tuple[str, dict[str, Any]]:
    """依請求覆寫或專案欄位解析 bi_schemas，無預設 id。"""
    schema_id = (req_schema_id or "").strip() or (proj_schema_id or "").strip()
    if not schema_id:
        raise HTTPException(status_code=400, detail=_MISSING_SCHEMA_MSG)
    schema_def = load_schema_from_db(schema_id, db)
    if not schema_def:
        raise HTTPException(
            status_code=404,
            detail=f"Schema 不存在：{schema_id}，請確認 bi_schemas 表已匯入範本",
        )
    return schema_id, schema_def

def _build_indicator_default_value_columns(schema_def: dict[str, Any] | None) -> dict[str, list[str]]:
    """從 schema 動態產生 indicator -> value_columns 對應（無硬編碼欄位名）。"""
    if not schema_def:
        return {}
    columns = schema_def.get("columns") or {}
    indicators = schema_def.get("indicators") or {}
    value_cols = [
        c for c, m in columns.items()
        if isinstance(m, dict) and (m.get("attr") or "").strip().lower() in ("val", "val_num", "val_denom")
    ]
    out: dict[str, list[str]] = {}
    for code, meta in indicators.items():
        if not isinstance(meta, dict):
            continue
        comp = meta.get("value_components") or []
        if comp:
            out[code] = [str(c) for c in comp if c]
    # 每個數值欄 col_n：對應自身、compare 前期／YoY 別名（須能從 indicator 反查 value_columns）
    for col in value_cols:
        out[col] = [col]
        out[f"previous_{col}"] = [col]
        out[f"{col}_yoy_growth"] = [col]
        out[f"{col}_ratio"] = [col]
        if "_" in col:
            base = col.split("_")[0]
            if base and f"{base}_ratio" not in out:
                out[f"{base}_ratio"] = [col]
    return out


def _parse_compare_periods_from_intent(intent: dict[str, Any]) -> dict[str, Any] | None:
    """解析 compare_periods。格式 { current: {column, value}, compare: {column, value} }。"""
    cp = intent.get("compare_periods")
    if not isinstance(cp, dict):
        return None
    cur = cp.get("current")
    cmp_spec = cp.get("compare")
    if not isinstance(cur, dict) or not isinstance(cmp_spec, dict):
        return None
    col = (cur.get("column") or "").strip()
    cur_val = cur.get("value")
    cmp_val = cmp_spec.get("value")
    if not col or cur_val is None or cmp_val is None:
        return None
    return {"current": {"column": col, "value": cur_val}, "compare": {"column": col, "value": cmp_val}}


def _get_top_n_from_intent(intent: dict[str, Any]) -> int | None:
    """top_n 可為 number 或 { count, based_on }。回傳 count 或 None。"""
    v = intent.get("top_n")
    if isinstance(v, int) and v > 0:
        return v
    if isinstance(v, dict) and v.get("count") is not None:
        try:
            n = int(v.get("count"))
            return n if n > 0 else None
        except (ValueError, TypeError):
            pass
    if v is not None:
        try:
            n = int(v)
            return n if n > 0 else None
        except (ValueError, TypeError):
            pass
    return None


def _get_sort_order_from_intent(intent: dict[str, Any]) -> str | list[dict[str, str]]:
    """sort_order 可為 "desc"|"asc" 或 [{ column, order }, ...]。直接傳給 compute_aggregate 正規化。"""
    v = intent.get("sort_order")
    if isinstance(v, list) and v:
        out: list[dict[str, str]] = []
        for item in v:
            if isinstance(item, dict):
                col = (item.get("column") or "_first_").strip() or "_first_"
                ord_val = (item.get("order") or "desc").strip().lower()
                ord_val = "desc" if ord_val == "desc" else "asc"
                out.append({"column": col, "order": ord_val})
        return out if out else "desc"
    if v is None or v == "":
        return "desc"
    s = str(v).strip().lower() or "desc"
    return s


def _normalize_group_by(gb_raw: Any) -> list[str]:
    """group_by_column 一律正規化為 array。intent 新格式為 ["department"]。"""
    if isinstance(gb_raw, list):
        return [str(x).strip() for x in gb_raw if x]
    if gb_raw and str(gb_raw).strip():
        return [str(gb_raw).strip()]
    return []


def _parse_indicator_from_intent(intent: dict[str, Any]) -> list[str] | None:
    """解析 indicator：一律為 array 格式。僅接受 list，回傳 [str, ...] 或 None。"""
    v = intent.get("indicator")
    if isinstance(v, list):
        out = [str(x).strip().lower() for x in v if x]
        return out if out else None
    return None


def _indicator_default_value_columns(
    indic: list[str] | None,
    schema_def: dict[str, Any] | None = None,
) -> list[dict[str, str]] | None:
    """依 indicator array 與 schema 回傳所需欄位聯集。"""
    if not indic:
        return None
    mapping = _build_indicator_default_value_columns(schema_def)
    cols: list[str] = []
    seen: set[str] = set()
    for ind in indic:
        ind_clean = str(ind).strip().lower()
        comp_list: list[str] = []
        for mk, mcols in mapping.items():
            if str(mk).lower() == ind_clean:
                comp_list = mcols
                break
        for c in comp_list:
            if c not in seen:
                seen.add(c)
                cols.append(c)
    return [{"column": c, "aggregation": "sum"} for c in cols] if cols else None


def _parse_value_columns_from_intent(
    intent: dict[str, Any],
    indicator: list[str] | None,
    schema_def: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """
    從 intent 解析 value_columns，一律回傳 [{ column, aggregation }, ...]。
    支援兩種格式：
      1. ["col1", "col2"]：欄位名陣列，使用頂層 aggregation 或 sum
      2. [{ column, aggregation }, ...]：每欄位可指定 aggregation
    若無 value_columns，依 indicator 與 schema 對應表補齊；對應不到則回傳 []（不使用 schema 第一個 val 或 sales_amount 等 fallback）。
    """
    vc = intent.get("value_columns")
    default_agg = (intent.get("aggregation") or "sum")
    if isinstance(default_agg, str):
        default_agg = default_agg.strip().lower()
    if default_agg not in ("sum", "avg", "count"):
        default_agg = "sum"

    if isinstance(vc, list) and vc:
        out: list[dict[str, str]] = []
        for item in vc:
            if isinstance(item, dict) and item.get("column"):
                col = str(item.get("column", "")).strip()
                agg = (item.get("aggregation") or default_agg).strip().lower()
                if agg not in ("sum", "avg", "count"):
                    agg = default_agg
                if col:
                    out.append({"column": col, "aggregation": agg})
        if out:
            return out
        # 若 list 內皆非 dict，嘗試當作欄位名陣列
        for item in vc:
            col = str(item).strip() if item is not None else ""
            if col:
                out.append({"column": col, "aggregation": default_agg})
        if out:
            return out
    default = _indicator_default_value_columns(indicator, schema_def)
    if default:
        return default
    return []

def _parse_filters_from_intent(intent: dict[str, Any]) -> list[dict[str, Any]] | None:
    """從 intent 解析 filters。支援 filters 陣列；無則由 filter_column/filter_value 轉換。
    容錯：column 可為 col，value 可為 val（LLM 有時會用簡寫）。"""
    filters = intent.get("filters")
    if isinstance(filters, list):
        out = []
        for f in filters:
            if isinstance(f, dict):
                col = f.get("column") or f.get("col")
                val = f.get("value") if "value" in f else f.get("val")
                op = f.get("op")
                if col is not None and str(col).strip():
                    op_str = (str(op).strip().lower().replace(" ", "") or "==") if op is not None else "=="
                    out.append({"column": str(col).strip(), "op": op_str or "==", "value": val})
        if out:
            return out
    fc, fv = intent.get("filter_column"), intent.get("filter_value")
    if fc and isinstance(fc, str) and fv is not None:
        return [{"column": fc.strip(), "op": "==", "value": fv}]
    return None


def _parse_display_fields_from_intent(intent: dict[str, Any]) -> list[str] | None:
    """display_fields：字串陣列，供 compute_aggregate 過濾輸出欄位。"""
    df = intent.get("display_fields")
    if isinstance(df, list):
        out = [str(d).strip() for d in df if d]
        return out if out else None
    return None


def _parse_having_filters_from_intent(intent: dict[str, Any]) -> list[dict[str, Any]] | None:
    """從 intent 解析 having_filters（彙總後篩選，如營收>100萬、ROI<1.5）。"""
    hf = intent.get("having_filters")
    if isinstance(hf, list):
        out = []
        for f in hf:
            if isinstance(f, dict):
                col = f.get("column")
                val = f.get("value")
                op = f.get("op")
                if col is not None:
                    op_str = (str(op).strip().lower().replace(" ", "") or "==") if op is not None else "=="
                    out.append({"column": str(col).strip(), "op": op_str or "==", "value": val})
        if out:
            return out
    return None


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
    """從 schema_def.columns 產生 Data Schema 區塊，格式與 prompt 內一致。"""
    if not schema_def or not schema_def.get("columns"):
        return "- (無 schema 定義)"
    lines: list[str] = []
    for field, meta in (schema_def.get("columns") or {}).items():
        if not isinstance(meta, dict):
            continue
        t = meta.get("type") or "str"
        a = meta.get("attr") or "dim"
        aliases = meta.get("aliases") or []
        alias_str = ", ".join(str(x) for x in aliases) if aliases else ""
        lines.append(f"- {field}: [{t}, {a}] {alias_str}".strip())
    return "\n".join(lines) if lines else "- (無欄位)"


def _build_indicator_block(schema_def: dict[str, Any] | None) -> str:
    """從 schema_def.indicators 產生指標血緣區塊，格式與 prompt 內一致。"""
    lines: list[str] = []
    columns = schema_def.get("columns") or {} if schema_def else {}
    value_cols = [
        c for c, m in columns.items()
        if isinstance(m, dict) and (m.get("attr") or "").strip().lower() in ("val", "val_num", "val_denom")
    ]
    if value_cols:
        lines.append(
            "   - `{column}_ratio`（動態佔比，無需預定義）: 任一數值欄位可加 _ratio。例: col_7_ratio"
        )
    for code, meta in (schema_def.get("indicators") or {}).items() if schema_def else {}:
        if not isinstance(meta, dict):
            continue
        comp = meta.get("value_components") or []
        comp_str = ", ".join(str(c) for c in comp) if comp else ""
        label = (meta.get("display_label") or "").strip()
        if label:
            lines.append(f"   - `{code}`（{label}）: [{comp_str}]")
        else:
            lines.append(f"   - `{code}`: [{comp_str}]")
    return "\n".join(lines) if lines else "   - (無指標)"


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


def _load_intent_prompt(schema_def: dict[str, Any] | None) -> str:
    """載入 intent prompt template 並從 schema_def 注入 schema/indicator/階層。"""
    raw = _load_prompt("intent")
    if not raw:
        return ""
    schema_name = (schema_def or {}).get("name") or "Sales Analytics"
    schema_block = _build_schema_block(schema_def)
    indicator_block = _build_indicator_block(schema_def)
    hierarchy_block = _build_hierarchy_block(schema_def)
    system_date = datetime.now().strftime("%Y-%m-%d")
    return raw.replace("{{SCHEMA_NAME}}", schema_name).replace(
        "{{SCHEMA_DEFINITION}}", schema_block
    ).replace("{{INDICATOR_DEFINITION}}", indicator_block).replace(
        "{{DIMENSION_HIERARCHY}}", hierarchy_block
    ).replace("{{SYSTEM_DATE}}", system_date)


def _extract_json_from_llm(raw: str) -> dict | None:
    """從 LLM 回覆中萃取 JSON"""
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    pass
                break
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    return None


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
        for i, x_label in enumerate(display_labels):
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


class ChatResponseComputeTool(BaseModel):
    content: str
    model: str = ""
    usage: dict[str, int] | None = None
    chart_data: dict[str, Any] | None = None
    debug: dict[str, Any] | None = None


class IntentToComputeRequest(BaseModel):
    """dev-test-intent-to-data 專用：直接傳入 intent JSON 呼叫 compute_aggregate"""
    agent_id: str
    project_id: str
    intent: dict[str, Any]
    schema_id: str = ""  # 可覆寫專案 schema；皆空則 400


class IntentToComputeRawRequest(BaseModel):
    """dev-test-intent-to-data 專用：傳入 intent + rows，無需 agent/project"""
    intent: dict[str, Any]
    rows: list[dict[str, Any]]
    schema_id: str  # bi_schemas.id，必填


class IntentToComputeByProjectRequest(BaseModel):
    """dev-test-intent-to-data 專用：僅需 project_id，從 DuckDB 載入資料"""
    project_id: str
    intent: dict[str, Any]
    schema_id: str = ""  # 可覆寫專案 schema；與專案皆空則 400


class IntentToComputeResponse(BaseModel):
    chart_result: dict[str, Any] | None
    error_detail: str | None = None  # chart_result 為 null 時的詳細原因


class ExtractIntentResponse(BaseModel):
    """僅意圖萃取：dev-test-compute-tool 兩步驟流程用"""
    intent: dict[str, Any] | None = None
    usage: dict[str, int] | None = None
    model: str = ""
    error_message: str | None = None  # 意圖無效時的訊息
    system_prompt: str = ""  # 組合好的 system prompt（含 schema/indicator 注入）


class ComputeFromIntentRequest(BaseModel):
    """依已取得的 intent 執行計算 + 文字生成"""
    agent_id: str = ""
    project_id: str = ""
    schema_id: str = ""  # dev-test-compute-tool：覆寫專案 schema
    content: str  # 使用者問題（用於文字生成）
    intent: dict[str, Any]
    model: str = "gpt-4o-mini"


async def _call_llm(
    model: str,
    system_prompt: str,
    user_content: str,
) -> tuple[str, dict | None]:
    """呼叫 LLM，回傳 (content, usage)"""
    litellm_model, api_key, api_base = _get_llm_params(model)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(model)} API Key 未設定",
        )
    if model.startswith("twcc/") and not api_base:
        raise HTTPException(status_code=503, detail="台智雲 TWCC_API_BASE 未設定")

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
            "parameters": {"max_new_tokens": 2000, "temperature": 0},
        }
        headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                resp.raise_for_status()
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
    if api_base:
        base = api_base.rstrip("/")
        completion_kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"

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


@router.post("/extract-intent-only", response_model=ExtractIntentResponse)
async def extract_intent_only(
    req: ChatRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """dev-test-compute-tool 兩步驟：僅做意圖萃取，回傳 intent + usage。"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")

    try:
        _check_agent_access(db, current, req.agent_id.strip())
    except HTTPException:
        raise

    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")

    user_id = getattr(current, "id", 0) or 0
    rows, proj = _load_rows_from_duckdb_only(pid, db, int(user_id))
    _, schema_def = _resolve_schema_def(
        db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
    )
    model = (req.model or "").strip() or "gpt-4o-mini"

    intent_prompt = _load_intent_prompt(schema_def)
    if not intent_prompt:
        raise HTTPException(status_code=500, detail="Intent prompt 檔案不存在")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    user_content_intent = f"""當前時間：{now_str}

問題: {req.content}"""
    try:
        intent_raw, usage1 = await _call_llm(model, intent_prompt, user_content_intent)
    except Exception as e:
        logger.exception("意圖萃取 LLM 呼叫失敗")
        raise HTTPException(status_code=500, detail=f"意圖萃取失敗：{e}")

    intent = _extract_json_from_llm(intent_raw)
    if not intent or not isinstance(intent, dict):
        return ExtractIntentResponse(
            intent=None,
            usage=usage1,
            model=model,
            error_message="無法解析您的分析意圖，請換個方式詢問。",
            system_prompt=intent_prompt,
        )
    filters = _parse_filters_from_intent(intent)
    has_aggregate = intent.get("value_column") or intent.get("value_columns") or intent.get("indicator")
    has_group = bool(intent.get("group_by_column"))
    has_filters = bool(filters)
    if not has_group and not has_aggregate and not has_filters:
        return ExtractIntentResponse(
            intent=None,
            usage=usage1,
            model=model,
            error_message="無法解析您的分析意圖，請換個方式詢問。",
            system_prompt=intent_prompt,
        )

    return ExtractIntentResponse(intent=intent, usage=usage1, model=model, system_prompt=intent_prompt)


@router.post("/completions-compute-tool", response_model=ChatResponseComputeTool)
async def chat_completions_compute_tool(
    req: ChatRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Tool Calling 路徑：LLM 意圖萃取 → Backend 計算 → 文字生成。需 project_id 且為 bi_project。"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required（compute flow 僅支援 BI 專案）")

    try:
        _check_agent_access(db, current, req.agent_id.strip())
    except HTTPException:
        raise

    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")

    user_id = getattr(current, "id", 0) or 0
    rows, proj = _load_rows_from_duckdb_only(pid, db, int(user_id))
    logger.info("Tool flow 載入 %d 列，欄位: %s", len(rows), list(rows[0].keys()) if rows else [])

    _, schema_def = _resolve_schema_def(
        db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
    )
    schema_summary = get_schema_summary(rows, schema_def)
    model = (req.model or "").strip() or "gpt-4o-mini"
    debug: dict[str, Any] = {"schema_summary": schema_summary, "row_count": len(rows)}
    chart_result: dict[str, Any] | None = None
    usage1: dict | None = None

    intent_prompt = _load_intent_prompt(schema_def)
    if not intent_prompt:
        raise HTTPException(status_code=500, detail="Intent prompt 檔案不存在 (system_prompt_analysis_intent_tool.md)")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    user_content_intent = f"""當前時間：{now_str}

問題: {req.content}"""
    try:
        intent_raw, usage1 = await _call_llm(model, intent_prompt, user_content_intent)
    except Exception as e:
        logger.exception("意圖萃取 LLM 呼叫失敗")
        raise HTTPException(status_code=500, detail=f"意圖萃取失敗：{e}")

    debug["intent_raw"] = intent_raw
    debug["intent_usage"] = usage1
    intent = _extract_json_from_llm(intent_raw)
    if not intent or not isinstance(intent, dict):
        return ChatResponseComputeTool(
            content="無法解析您的分析意圖，請換個方式詢問。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )
    filters = _parse_filters_from_intent(intent)
    has_aggregate = intent.get("value_column") or intent.get("value_columns") or intent.get("indicator")
    has_group = bool(intent.get("group_by_column"))
    has_filters = bool(filters)
    if not has_group and not has_aggregate and not has_filters:
        return ChatResponseComputeTool(
            content="無法解析您的分析意圖，請換個方式詢問。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    debug["intent"] = intent

    group_by = _normalize_group_by(intent.get("group_by_column"))
    having_filters = _parse_having_filters_from_intent(intent)
    indicator = _parse_indicator_from_intent(intent)
    value_cols = _parse_value_columns_from_intent(intent, indicator, schema_def)
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    top_n = _get_top_n_from_intent(intent)
    sort_order = _get_sort_order_from_intent(intent)
    time_order = bool(intent.get("time_order"))
    time_grain_raw = intent.get("time_grain")
    time_grain = str(time_grain_raw).strip().lower() if time_grain_raw else None
    if time_grain and time_grain not in ("day", "week", "month", "quarter", "year"):
        time_grain = None

    error_list: list[str] = []
    chart_result = compute_aggregate(
        rows,
        group_by,
        value_cols,
        series_by_column=series_by,
        filters=filters,
        having_filters=having_filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        time_grain=time_grain,
        indicator=indicator,
        display_fields=_parse_display_fields_from_intent(intent),
        schema_def=schema_def,
        compare_periods=_parse_compare_periods_from_intent(intent),
        error_out=error_list,
    )

    if not chart_result:
        err_msg = "; ".join(error_list) if error_list else ""
        if "篩選後無資料" in err_msg or "無資料" in err_msg:
            content = "查無符合條件的資料，請調整篩選條件或時間範圍。"
        elif "value_columns 為空" in err_msg:
            content = "無法解析數值欄位：請在 intent 提供 value_columns，或提供可對應 schema 的 indicator。"
        elif "_resolve_columns" in err_msg or "rows 為空" in err_msg:
            content = "無法解析欄位對應，請確認問題描述與資料 schema。"
        else:
            content = "後端計算失敗，請稍後再試或調整問題描述。"
        return ChatResponseComputeTool(
            content=content,
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    if not chart_result.get("yAxisLabel") and chart_result.get("valueLabel"):
        chart_result["yAxisLabel"] = chart_result["valueLabel"]
    debug["chart_result"] = chart_result
    debug["flow"] = "tool"

    detail_lines = _chart_result_to_detail_lines(chart_result)
    if not detail_lines:
        return ChatResponseComputeTool(
            content="無法格式化計算結果。請調整問題或檢查 schema。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    text_prompt = _load_prompt("text")
    if not text_prompt:
        text_prompt = "根據計算結果撰寫分析文字，使用 Markdown 格式。圖表由後端負責，只輸出文字。"

    detail_block = "計算結果：\n" + "\n".join(detail_lines)
    ai_block = f"AI 設定與補充指示：\n{req.user_prompt.strip()}\n\n" if (req.user_prompt or "").strip() else ""
    user_content_text = f"""{ai_block}使用者問題：{req.content}

{detail_block}

請撰寫分析文字，金額與數字必須與上述完全一致。"""

    try:
        text_content, usage2 = await _call_llm(model, text_prompt, user_content_text)
    except Exception as e:
        logger.exception("文字生成 LLM 呼叫失敗")
        return ChatResponseComputeTool(
            content=f"文字生成失敗：{e}",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    debug["text_usage"] = usage2

    final_content = text_content.strip()
    parsed = _extract_json_from_llm(text_content)
    if parsed and isinstance(parsed.get("text"), str):
        final_content = parsed["text"].strip()
    # chart 由後端負責，固定使用 chart_result，不以 LLM 輸出覆蓋

    total_usage = usage1 or {}
    if usage2:
        for k, v in usage2.items():
            total_usage[k] = total_usage.get(k, 0) + v

    return ChatResponseComputeTool(
        content=final_content,
        model=model,
        usage=total_usage,
        chart_data=chart_result,
        debug=debug,
    )


@router.post("/compute-from-intent", response_model=ChatResponseComputeTool)
async def compute_from_intent(
    req: ComputeFromIntentRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """dev-test-compute-tool 兩步驟：依已取得的 intent 執行計算 + 文字生成。"""
    if (req.agent_id or "").strip():
        try:
            _check_agent_access(db, current, req.agent_id.strip())
        except HTTPException:
            raise
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")

    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")

    user_id = getattr(current, "id", 0) or 0
    rows, proj = _load_rows_from_duckdb_only(pid, db, int(user_id))
    duckdb_path = get_project_duckdb_path(pid)
    duckdb_path_str = str(duckdb_path.resolve()) if duckdb_path else None
    logger.info(
        "compute_from_intent: project_id=%s duckdb=%s rows=%d",
        pid,
        duckdb_path_str,
        len(rows),
    )
    _, schema_def = _resolve_schema_def(
        db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
    )
    model = (req.model or "").strip() or "gpt-4o-mini"
    intent = req.intent or {}
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")

    debug: dict[str, Any] = {
        "intent": intent,
        "flow": "compute-from-intent",
        "project_id": pid,
        "duckdb_path": duckdb_path_str,
        "row_count": len(rows),
    }
    filters = _parse_filters_from_intent(intent)
    group_by = _normalize_group_by(intent.get("group_by_column"))
    having_filters = _parse_having_filters_from_intent(intent)
    indicator = _parse_indicator_from_intent(intent)
    value_cols = _parse_value_columns_from_intent(intent, indicator, schema_def)
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    top_n = _get_top_n_from_intent(intent)
    sort_order = _get_sort_order_from_intent(intent)
    time_order = bool(intent.get("time_order"))
    time_grain_raw = intent.get("time_grain")
    time_grain = str(time_grain_raw).strip().lower() if time_grain_raw else None
    if time_grain and time_grain not in ("day", "week", "month", "quarter", "year"):
        time_grain = None

    error_list: list[str] = []
    chart_result = compute_aggregate(
        rows,
        group_by,
        value_cols,
        series_by_column=series_by,
        filters=filters,
        having_filters=having_filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        time_grain=time_grain,
        indicator=indicator,
        display_fields=_parse_display_fields_from_intent(intent),
        schema_def=schema_def,
        compare_periods=_parse_compare_periods_from_intent(intent),
        error_out=error_list,
    )

    if not chart_result:
        err_msg = "; ".join(error_list) if error_list else ""
        debug["compute_aggregate_errors"] = error_list
        if "篩選後無資料" in err_msg or "無資料" in err_msg:
            content = "查無符合條件的資料，請調整篩選條件或時間範圍。"
        elif "value_columns 為空" in err_msg:
            content = "無法解析數值欄位：請在 intent 提供 value_columns，或提供可對應 schema 的 indicator。"
        elif "_resolve_columns" in err_msg or "rows 為空" in err_msg:
            content = "無法解析欄位對應，請確認問題描述與資料 schema。"
        else:
            content = (
                f"後端計算失敗：{err_msg}"
                if err_msg
                else "後端計算失敗，請稍後再試或調整問題描述。"
            )
        return ChatResponseComputeTool(
            content=content,
            model=model,
            usage=None,
            chart_data=None,
            debug=debug,
        )

    if not chart_result.get("yAxisLabel") and chart_result.get("valueLabel"):
        chart_result["yAxisLabel"] = chart_result["valueLabel"]
    debug["chart_result"] = chart_result

    detail_lines = _chart_result_to_detail_lines(chart_result)
    if not detail_lines:
        return ChatResponseComputeTool(
            content="無法格式化計算結果。請調整問題或檢查 schema。",
            model=model,
            usage=None,
            chart_data=None,
            debug=debug,
        )

    text_prompt = _load_prompt("text")
    if not text_prompt:
        text_prompt = "根據計算結果撰寫分析文字，使用 Markdown 格式。圖表由後端負責，只輸出文字。"

    detail_block = "計算結果：\n" + "\n".join(detail_lines)
    user_content_text = f"""使用者問題：{req.content}

{detail_block}

請撰寫分析文字，金額與數字必須與上述完全一致。"""

    try:
        text_content, usage2 = await _call_llm(model, text_prompt, user_content_text)
    except Exception as e:
        logger.exception("文字生成 LLM 呼叫失敗")
        return ChatResponseComputeTool(
            content=f"文字生成失敗：{e}",
            model=model,
            usage=None,
            chart_data=chart_result,
            debug=debug,
        )

    debug["text_usage"] = usage2
    final_content = text_content.strip()
    parsed = _extract_json_from_llm(text_content)
    if parsed and isinstance(parsed.get("text"), str):
        final_content = parsed["text"].strip()

    return ChatResponseComputeTool(
        content=final_content,
        model=model,
        usage=usage2,
        chart_data=chart_result,
        debug=debug,
    )


def _sse_event(data: dict[str, Any]) -> str:
    """產生 SSE 格式字串：data: {json}\\n\\n"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _stream_compute_tool(
    req: ChatRequest,
    db: Session,
    user_id: int,
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
        rows, proj = _load_rows_from_duckdb_only(pid, db, user_id)
    except HTTPException as e:
        yield _sse_event({"stage": "done", "error_stage": "setup", "content": e.detail, "chart_data": None})
        return

    schema_id = (req.schema_id or "").strip() or (getattr(proj, "schema_id", None) or "").strip()
    if not schema_id:
        yield _sse_event({"stage": "done", "error_stage": "setup", "content": _MISSING_SCHEMA_MSG, "chart_data": None})
        return
    schema_def = load_schema_from_db(schema_id, db)
    if not schema_def:
        yield _sse_event(
            {
                "stage": "done",
                "error_stage": "setup",
                "content": f"Schema 不存在：{schema_id}，請確認 bi_schemas 表已匯入範本",
                "chart_data": None,
            }
        )
        return
    model = (req.model or "").strip() or "gpt-4o-mini"
    intent_prompt = _load_intent_prompt(schema_def)
    if not intent_prompt:
        yield _sse_event({"stage": "done", "error_stage": "intent", "content": "Intent prompt 檔案不存在", "chart_data": None})
        return

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    user_content_intent = f"""當前時間：{now_str}

問題: {req.content}"""
    try:
        intent_raw, usage1 = await _call_llm(model, intent_prompt, user_content_intent)
    except Exception as e:
        logger.exception("意圖萃取 LLM 呼叫失敗")
        yield _sse_event({"stage": "done", "error_stage": "intent", "content": f"意圖萃取失敗：{e}", "chart_data": None})
        return

    intent = _extract_json_from_llm(intent_raw)
    if not intent or not isinstance(intent, dict):
        yield _sse_event({
            "stage": "done",
            "error_stage": "intent",
            "content": "無法解析您的分析意圖，請換個方式詢問。",
            "chart_data": None,
        })
        return
    filters = _parse_filters_from_intent(intent)
    has_aggregate = intent.get("value_column") or intent.get("value_columns") or intent.get("indicator")
    has_group = bool(intent.get("group_by_column"))
    has_filters = bool(filters)
    if not has_group and not has_aggregate and not has_filters:
        yield _sse_event({
            "stage": "done",
            "error_stage": "intent",
            "content": "無法解析您的分析意圖，請換個方式詢問。",
            "chart_data": None,
        })
        return

    yield _sse_event({"stage": "compute"})

    group_by = _normalize_group_by(intent.get("group_by_column"))
    having_filters = _parse_having_filters_from_intent(intent)
    indicator = _parse_indicator_from_intent(intent)
    value_cols = _parse_value_columns_from_intent(intent, indicator, schema_def)
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    top_n = _get_top_n_from_intent(intent)
    sort_order = _get_sort_order_from_intent(intent)
    time_order = bool(intent.get("time_order"))
    time_grain_raw = intent.get("time_grain")
    time_grain = str(time_grain_raw).strip().lower() if time_grain_raw else None
    if time_grain and time_grain not in ("day", "week", "month", "quarter", "year"):
        time_grain = None

    error_list: list[str] = []
    chart_result = compute_aggregate(
        rows,
        group_by,
        value_cols,
        series_by_column=series_by,
        filters=filters,
        having_filters=having_filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        time_grain=time_grain,
        indicator=indicator,
        display_fields=_parse_display_fields_from_intent(intent),
        schema_def=schema_def,
        compare_periods=_parse_compare_periods_from_intent(intent),
        error_out=error_list,
    )

    if not chart_result:
        err_msg = "; ".join(error_list) if error_list else ""
        if "篩選後無資料" in err_msg or "無資料" in err_msg:
            content = "查無符合條件的資料，請調整篩選條件或時間範圍。"
        elif "value_columns 為空" in err_msg:
            content = "無法解析數值欄位：請在 intent 提供 value_columns，或提供可對應 schema 的 indicator。"
        elif "_resolve_columns" in err_msg or "rows 為空" in err_msg:
            content = "無法解析欄位對應，請確認問題描述與資料 schema。"
        else:
            content = "後端計算失敗，請稍後再試或調整問題描述。"
        logger.info("compute 階段失敗: error_list=%s -> content=%s", error_list, content)
        yield _sse_event({"stage": "done", "error_stage": "compute", "content": content, "chart_data": None})
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
        text_content, usage2 = await _call_llm(model, text_prompt, user_content_text)
    except Exception as e:
        logger.exception("文字生成 LLM 呼叫失敗")
        yield _sse_event({
            "stage": "done",
            "error_stage": "text",
            "content": f"分析文字生成失敗：{e}",
            "chart_data": chart_result,
        })
        return

    final_content = text_content.strip()
    parsed = _extract_json_from_llm(text_content)
    if parsed and isinstance(parsed.get("text"), str):
        final_content = parsed["text"].strip()

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
        "chart_data": chart_result,
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
    return StreamingResponse(
        _stream_compute_tool(req, db, user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/intent-to-compute", response_model=IntentToComputeResponse)
async def intent_to_compute(
    req: IntentToComputeRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """dev-test-intent-to-data 專用：接受 intent JSON，從 DuckDB 或 CSV 載入專案資料後呼叫 compute_aggregate。"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")
    intent = req.intent or {}
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")

    try:
        _check_agent_access(db, current, req.agent_id.strip())
    except HTTPException:
        raise

    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")

    user_id = int(getattr(current, "id", 0) or 0)
    rows, proj = _load_rows_from_duckdb_only(pid, db, user_id)

    _, schema_def = _resolve_schema_def(
        db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
    )

    group_by = _normalize_group_by(intent.get("group_by_column"))
    indicator = _parse_indicator_from_intent(intent)
    value_cols = _parse_value_columns_from_intent(intent, indicator, schema_def)
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    filters = _parse_filters_from_intent(intent)
    having_filters = _parse_having_filters_from_intent(intent)
    top_n = _get_top_n_from_intent(intent)
    sort_order = _get_sort_order_from_intent(intent)
    time_order = bool(intent.get("time_order"))
    time_grain_raw = intent.get("time_grain")
    time_grain = str(time_grain_raw).strip().lower() if time_grain_raw else None
    if time_grain and time_grain not in ("day", "week", "month", "quarter", "year"):
        time_grain = None
    display_fields = _parse_display_fields_from_intent(intent)

    error_list: list[str] = []
    chart_result = compute_aggregate(
        rows,
        group_by,
        value_cols,
        series_by_column=series_by,
        filters=filters,
        having_filters=having_filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        time_grain=time_grain,
        indicator=indicator,
        display_fields=display_fields,
        schema_def=schema_def,
        compare_periods=_parse_compare_periods_from_intent(intent),
        error_out=error_list,
    )
    error_detail = "; ".join(error_list) if error_list and not chart_result else None
    return IntentToComputeResponse(chart_result=chart_result, error_detail=error_detail)


def _load_rows_from_duckdb_only(pid: str, db: Session, user_id: int) -> tuple[list[dict[str, Any]], Any]:
    """從專案載入 rows：僅從 DuckDB 讀取。回傳 (rows, proj)。無 DuckDB 時 raise HTTPException。"""
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
    df = execute_sql_on_duckdb_file(duckdb_path, "SELECT * FROM data")
    if df is None or df.empty:
        raise HTTPException(
            status_code=400,
            detail=f"DuckDB 檔案存在但無資料（project_id={pid}），請重新匯入",
        )
    rows = df.to_dict("records")
    logger.info("從 DuckDB 載入 %d 列", len(rows))
    return rows, proj


@router.post("/intent-to-compute-by-project", response_model=IntentToComputeResponse)
async def intent_to_compute_by_project(
    req: IntentToComputeByProjectRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """dev-test-intent-to-data 專用：僅需 project_id，從 DuckDB 載入資料。無需 agent_id。"""
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")
    intent = req.intent or {}
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")

    user_id = int(getattr(current, "id", 0) or 0)
    rows, proj = _load_rows_from_duckdb_only(pid, db, user_id)

    _, schema_def = _resolve_schema_def(
        db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
    )

    group_by = _normalize_group_by(intent.get("group_by_column"))
    indicator = _parse_indicator_from_intent(intent)
    value_cols = _parse_value_columns_from_intent(intent, indicator, schema_def)
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    filters = _parse_filters_from_intent(intent)
    having_filters = _parse_having_filters_from_intent(intent)
    top_n = _get_top_n_from_intent(intent)
    sort_order = _get_sort_order_from_intent(intent)
    time_order = bool(intent.get("time_order"))
    time_grain_raw = intent.get("time_grain")
    time_grain = str(time_grain_raw).strip().lower() if time_grain_raw else None
    if time_grain and time_grain not in ("day", "week", "month", "quarter", "year"):
        time_grain = None
    display_fields = _parse_display_fields_from_intent(intent)

    error_list: list[str] = []
    chart_result = compute_aggregate(
        rows,
        group_by,
        value_cols,
        series_by_column=series_by,
        filters=filters,
        having_filters=having_filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        time_grain=time_grain,
        indicator=indicator,
        display_fields=display_fields,
        schema_def=schema_def,
        compare_periods=_parse_compare_periods_from_intent(intent),
        error_out=error_list,
    )
    error_detail = "; ".join(error_list) if error_list and not chart_result else None
    return IntentToComputeResponse(chart_result=chart_result, error_detail=error_detail)


@router.post("/intent-to-compute-raw", response_model=IntentToComputeResponse)
async def intent_to_compute_raw(
    req: IntentToComputeRawRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """dev-test-intent-to-data 專用：接受 intent + rows，無需 agent/project。schema 從 bi_schemas 載入。"""
    intent = req.intent or {}
    rows = req.rows or []
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="rows 必須為非空陣列")
    if not isinstance(rows[0], dict):
        raise HTTPException(status_code=400, detail="rows 每筆必須為物件")

    _, schema_def = _resolve_schema_def(db, req_schema_id=req.schema_id, proj_schema_id=None)
    filters = _parse_filters_from_intent(intent)
    having_filters = _parse_having_filters_from_intent(intent)
    display_fields = _parse_display_fields_from_intent(intent)
    group_by = _normalize_group_by(intent.get("group_by_column"))
    indicator = _parse_indicator_from_intent(intent)
    value_cols = _parse_value_columns_from_intent(intent, indicator, schema_def)
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    top_n = _get_top_n_from_intent(intent)
    sort_order = _get_sort_order_from_intent(intent)
    time_order = bool(intent.get("time_order"))
    time_grain_raw = intent.get("time_grain")
    time_grain = str(time_grain_raw).strip().lower() if time_grain_raw else None
    if time_grain and time_grain not in ("day", "week", "month", "quarter", "year"):
        time_grain = None

    error_list: list[str] = []
    chart_result = compute_aggregate(
        rows,
        group_by,
        value_cols,
        series_by_column=series_by,
        filters=filters,
        having_filters=having_filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        time_grain=time_grain,
        indicator=indicator,
        display_fields=display_fields,
        schema_def=schema_def,
        compare_periods=_parse_compare_periods_from_intent(intent),
        error_out=error_list,
    )
    error_detail = "; ".join(error_list) if error_list and not chart_result else None
    return IntentToComputeResponse(chart_result=chart_result, error_detail=error_detail)
