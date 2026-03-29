"""Chat Compute Tool API：POST /chat/completions-compute-tool。LLM 意圖萃取 → Backend 計算 → 文字生成

Tool Calling 路徑：LLM 輸出結構化 intent（**v4.0**）→ DuckDB SQL 計算。
schema 摘要等仍可能依端點載入列資料（全表或抽樣）供 LLM 與除錯用。
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
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session
from uuid import UUID

from app.api.endpoints.chat import (
    ChatRequest,
    _check_agent_access,
    _get_llm_params,
    _get_provider_name,
    _twcc_model_id,
)
from app.core.config import settings
from app.core.database import get_db
from app.models.bi_project import BiProject
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.intent_v4 import (
    IntentV4,
    USER_FACING_INTENT_V4_VALIDATION_MESSAGE,
    _USER_FACING_INTENT_V4_VALIDATION_MESSAGE_INTERNAL,
    auto_repair_intent,
    is_intent_v4_payload,
)
from app.services.analysis_compute import get_schema_summary
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
    if detail and msg:
        tail = f"\n\n【SQL】{(sql_debug or '').strip()}" if (sql_debug or "").strip() else ""
        return f"後端計算失敗：{msg}{tail}"
    if msg and expose:
        return _append_technical_lines("後端計算失敗，請稍後再試或調整問題描述。")
    return "後端計算失敗，請稍後再試或調整問題描述。"


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
    """載入 intent prompt template 並從 schema_def 注入 schema/階層。"""
    raw = _load_prompt("intent")
    if not raw:
        return ""
    schema_name = (schema_def or {}).get("name") or "Sales Analytics"
    schema_block = _build_schema_block(schema_def)
    hierarchy_block = _build_hierarchy_block(schema_def)
    return raw.replace("{{SCHEMA_NAME}}", schema_name).replace(
        "{{SCHEMA_DEFINITION}}", schema_block
    ).replace("{{DIMENSION_HIERARCHY}}", hierarchy_block)


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


class ChatResponseComputeTool(BaseModel):
    content: str
    model: str = ""
    usage: dict[str, int] | None = None
    chart_data: dict[str, Any] | None = None
    debug: dict[str, Any] | None = None


class IntentToComputeRequest(BaseModel):
    """dev-test-intent-to-data 專用：直接傳入 Intent v2 JSON（Python 聚合路徑）"""
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


class ComputeEngineRequest(BaseModel):
    """compute_engine：DuckDB 名稱 + intent；schema_id 可於請求或 intent 根層級帶入。"""
    duckdb_name: str
    intent: dict[str, Any]
    schema_id: str = ""


class IntentToComputeResponse(BaseModel):
    chart_result: dict[str, Any] | None
    error_detail: str | None = None  # chart_result 為 null 時的詳細原因


class ComputeEngineResponse(BaseModel):
    """compute_engine 專用：含 debug（例如產生的 SQL）。"""
    chart_result: dict[str, Any] | None
    error_detail: str | None = None
    debug: dict[str, Any] | None = None
    generated_sql: str | None = None


class ExtractIntentResponse(BaseModel):
    """僅意圖萃取：dev-test-compute-tool 兩步驟流程用"""
    intent: dict[str, Any] | None = None
    usage: dict[str, int] | None = None
    model: str = ""
    error_message: str | None = None  # 意圖無效時的訊息
    system_prompt: str = ""  # 組合好的 system prompt（含 schema/indicator 注入）
    intent_validation_errors: list[Any] | None = Field(
        default=None,
        description="Intent v2 未過驗證時的 Pydantic errors（JSON 可解析但契約不符）",
    )


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
    q_for_intent = _normalize_question_for_intent_extraction(req.content)
    user_content_intent = f"""當前時間：{now_str}

問題: {q_for_intent}"""
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
            error_message=_NO_INTENT_JSON_MSG,
            system_prompt=intent_prompt,
        )
    intent = auto_repair_intent(intent)
    kind, verr = _validate_intent_payload(intent)
    if verr is not None:
        logger.info("Intent 驗證失敗（extract-intent）kind=%s: %s", kind, verr.errors())
        base_msg = _user_message_for_intent_validation_failure(kind)
        detail = _extract_first_validation_detail(verr)
        error_message = f"{base_msg}\n\n{detail}" if detail else base_msg
        return ExtractIntentResponse(
            intent=None,
            usage=usage1,
            model=model,
            error_message=error_message,
            system_prompt=intent_prompt,
            intent_validation_errors=_pydantic_errors_json_safe(verr),
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
    q_for_intent = _normalize_question_for_intent_extraction(req.content)
    user_content_intent = f"""當前時間：{now_str}

問題: {q_for_intent}"""
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
            content=_NO_INTENT_JSON_MSG,
            model=model,
            usage=usage1,
            chart_data=None,
            debug=_debug_payload(debug),
        )
    intent = auto_repair_intent(intent)
    kind, verr = _validate_intent_payload(intent)
    if verr is not None:
        logger.info("Intent 驗證失敗（completions-compute-tool）kind=%s: %s", kind, verr.errors())
        debug["intent_validation_errors"] = _pydantic_errors_json_safe(verr)
        debug["intent_invalid_draft"] = intent
        debug["intent_validation_message_internal"] = _internal_message_for_intent_validation_failure(kind)
        base_msg = _user_message_for_intent_validation_failure(kind)
        detail = _extract_first_validation_detail(verr)
        return ChatResponseComputeTool(
            content=f"{base_msg}\n\n{detail}" if detail else base_msg,
            model=model,
            usage=usage1,
            chart_data=None,
            debug=_debug_payload(debug),
        )

    debug["intent"] = intent
    debug["intent_version"] = kind

    chart_result, error_list, ce_debug = _compute_with_intent(
        intent, schema_def, duckdb_project_id=pid
    )
    if ce_debug:
        debug.update(ce_debug)

    if not chart_result:
        debug["compute_errors_raw"] = list(error_list)
        content = _user_message_for_compute_errors(
            error_list, sql_debug=debug.get("sql") if isinstance(debug.get("sql"), str) else None
        )
        return ChatResponseComputeTool(
            content=content,
            model=model,
            usage=usage1,
            chart_data=None,
            debug=_debug_payload(debug),
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
            debug=_debug_payload(debug),
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
            debug=_debug_payload(debug),
        )

    debug["text_usage"] = usage2

    final_content = text_content.strip()
    # chart 由後端負責，固定使用 chart_result，不以 LLM 輸出覆蓋

    total_usage = usage1 or {}
    if usage2:
        for k, v in usage2.items():
            total_usage[k] = total_usage.get(k, 0) + v

    return ChatResponseComputeTool(
        content=final_content,
        model=model,
        usage=total_usage,
        chart_data=_clean_chart_result(chart_result),
        debug=_debug_payload(debug),
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
    kind, verr = _validate_intent_payload(intent)
    if verr is not None:
        logger.info("Intent 驗證失敗（compute-from-intent）kind=%s: %s", kind, verr.errors())
        raise HTTPException(
            status_code=400,
            detail=_user_message_for_intent_validation_failure(kind),
        )

    debug["intent_version"] = kind

    chart_result, error_list, ce_debug = _compute_with_intent(
        intent, schema_def, duckdb_project_id=pid
    )
    if ce_debug:
        debug.update(ce_debug)

    if not chart_result:
        debug["compute_errors_raw"] = list(error_list)
        sql_s = debug.get("sql") if isinstance(debug.get("sql"), str) else None
        content = _user_message_for_compute_errors(error_list, detail=True, sql_debug=sql_s)
        return ChatResponseComputeTool(
            content=content,
            model=model,
            usage=None,
            chart_data=None,
            debug=_debug_payload(debug),
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
            debug=_debug_payload(debug),
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
            chart_data=_clean_chart_result(chart_result),
            debug=_debug_payload(debug),
        )

    debug["text_usage"] = usage2
    final_content = text_content.strip()

    return ChatResponseComputeTool(
        content=final_content,
        model=model,
        usage=usage2,
        chart_data=_clean_chart_result(chart_result),
        debug=_debug_payload(debug),
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

    try:
        _, schema_def = _resolve_schema_def(
            db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
        )
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else str(e.detail)
        yield _sse_event({"stage": "done", "error_stage": "setup", "content": detail, "chart_data": None})
        return
    model = (req.model or "").strip() or "gpt-4o-mini"
    intent_prompt = _load_intent_prompt(schema_def)
    if not intent_prompt:
        yield _sse_event({"stage": "done", "error_stage": "intent", "content": "Intent prompt 檔案不存在", "chart_data": None})
        return

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    q_for_intent = _normalize_question_for_intent_extraction(req.content)
    user_content_intent = f"""當前時間：{now_str}

問題: {q_for_intent}"""
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
        text_content, usage2 = await _call_llm(model, text_prompt, user_content_text)
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
    """dev-test-intent-to-data 專用：接受 Intent v2 JSON，以專案 DuckDB 經 SQL 計算。"""
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

    user_id = int(getattr(current, "id", 0) or 0)
    proj = _ensure_bi_project_duckdb_has_data(pid, db, user_id)

    _, schema_def = _resolve_schema_def(
        db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
    )

    kind, verr = _validate_intent_payload(intent)
    if verr is not None:
        logger.info("Intent 驗證失敗（intent-to-compute）kind=%s: %s", kind, verr.errors())
        raise HTTPException(
            status_code=400,
            detail=_user_message_for_intent_validation_failure(kind),
        )

    chart_result, error_list, _ce_debug = _compute_with_intent(
        intent, schema_def, duckdb_project_id=pid
    )
    error_detail = "; ".join(error_list) if error_list and not chart_result else None
    return IntentToComputeResponse(chart_result=_clean_chart_result(chart_result), error_detail=error_detail)


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


@router.post("/intent-to-compute-by-project", response_model=IntentToComputeResponse)
async def intent_to_compute_by_project(
    req: IntentToComputeByProjectRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """dev-test-intent-to-data 專用：僅需 project_id，以 DuckDB SQL 計算。無需 agent_id。"""
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")
    intent = req.intent or {}
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")

    user_id = int(getattr(current, "id", 0) or 0)
    proj = _ensure_bi_project_duckdb_has_data(pid, db, user_id)

    _, schema_def = _resolve_schema_def(
        db, req_schema_id=req.schema_id, proj_schema_id=getattr(proj, "schema_id", None)
    )

    kind, verr = _validate_intent_payload(intent)
    if verr is not None:
        logger.info("Intent 驗證失敗（intent-to-compute-by-project）kind=%s: %s", kind, verr.errors())
        raise HTTPException(
            status_code=400,
            detail=_user_message_for_intent_validation_failure(kind),
        )

    chart_result, error_list, _ce_debug = _compute_with_intent(
        intent, schema_def, duckdb_project_id=pid
    )
    error_detail = "; ".join(error_list) if error_list and not chart_result else None
    return IntentToComputeResponse(chart_result=_clean_chart_result(chart_result), error_detail=error_detail)


@router.post("/intent-to-compute-raw", response_model=IntentToComputeResponse)
async def intent_to_compute_raw(
    req: IntentToComputeRawRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """已廢止：計算統一走 DuckDB SQL，不接受僅 in-memory rows。"""
    _ = (req, db, current)
    raise HTTPException(
        status_code=400,
        detail=(
            "intent-to-compute-raw 已不支援：計算統一為 DuckDB SQL。"
            " 請改用 POST /chat/intent-to-compute-by-project（帶 project_id）"
            " 或 POST /chat/compute-engine（duckdb_name）。"
        ),
    )


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
