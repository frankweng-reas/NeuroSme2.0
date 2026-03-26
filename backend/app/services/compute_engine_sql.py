"""
DuckDB SQL 執行與查詢結果 → chart 結構。

**組 SQL 僅** `compute_engine_sql_v2.try_build_sql_v2`（Intent v2）。本檔提供共用工具：
欄位白名單、識別字引用、公式內 col_* 替換、dataset 標籤、兩期 CTE 別名映射、SQL 片段等。
"""
from __future__ import annotations

import logging
import math
import re
from pathlib import Path
from typing import Any

import pandas as pd

from app.schemas.intent_v2 import USER_FACING_INTENT_VALIDATION_MESSAGE

logger = logging.getLogger(__name__)

from app.services.duckdb_store import execute_sql_on_duckdb_file

# 圖表序列若為成長率／占比：SQL 多為 0～1 比率，改以「百分比數字」顯示（×100，小數兩位）並標註（%）
_RATIO_LIKE_TOKENS = (
    "成長",
    "增幅",
    "yoy",
    "占比",
    "佔比",
    "比率",
    "比例",
    "变动",
    "變動",
    "同比",
    "环比",
    "環比",
    "mom",
    "wow",
)


def _sql_chart_series_is_ratio_like(dataset_label: str, agg_alias: str) -> bool:
    h = f"{dataset_label or ''} {agg_alias or ''}".lower()
    if any(t.lower() in h for t in _RATIO_LIKE_TOKENS):
        return True
    a = (agg_alias or "").strip().lower()
    return "yoy" in a or "growth" in a or a.endswith("_growth")


def _sql_chart_ratio_to_percent_display(v: float) -> float:
    if math.isnan(v) or math.isinf(v):
        return 0.0
    return round(float(v) * 100.0, 2)


def _sql_chart_label_append_percent_unit(label: str) -> str:
    s = (label or "").strip()
    if not s:
        return "（%）"
    if "%" in s or "％" in s or "（%）" in s or "百分比" in s:
        return s
    return f"{s}（%）"


def column_allowlist_from_schema(schema_def: dict[str, Any]) -> set[str]:
    cols = schema_def.get("columns") if isinstance(schema_def, dict) else None
    if isinstance(cols, dict) and cols:
        return {str(k) for k in cols.keys()}
    return set()


def _quote_ident(name: str) -> str:
    """DuckDB 識別字雙引號。"""
    return '"' + str(name).replace('"', '""') + '"'


_SAFE_UNQUOTED = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _sql_ident(name: str) -> str:
    """合法識別字不加重引號，否則雙引號（縮短 SQL）。"""
    s = str(name)
    if _SAFE_UNQUOTED.match(s):
        return s
    return _quote_ident(s)


def _latin_slug_from_text(s: str) -> str:
    """由字串抽出連續英文字詞為 snake_case；無則回傳空。"""
    words = re.findall(r"[A-Za-z]+", s)
    if not words:
        return ""
    return "_".join(w.lower() for w in words)[:48]


def _fallback_stem_from_col_code(col: str) -> str:
    m = re.match(r"^col_(\d+)$", col)
    if m:
        return f"k{m.group(1)}"
    return re.sub(r"[^A-Za-z0-9_]+", "_", col).strip("_") or "x"


def _schema_alias_stem(schema_def: dict[str, Any] | None, col: str) -> str:
    if not schema_def or not isinstance(schema_def.get("columns"), dict):
        return ""
    meta = schema_def["columns"].get(col)
    if not isinstance(meta, dict):
        return ""
    al = meta.get("aliases")
    if not isinstance(al, list):
        return ""
    for raw in al:
        slug = _latin_slug_from_text(str(raw).strip())
        if slug:
            return slug
    return ""


def _agg_short_prefix(agg: str) -> str:
    a = str(agg).strip().lower()
    if a == "sum":
        return ""
    if a == "avg":
        return "avg_"
    if a == "count":
        return "cnt_"
    return f"{a}_"


def _build_compare_period_cte_alias_maps(
    schema_def: dict[str, Any] | None,
    group_cols: list[str],
    specs: list[tuple[str, str]],
) -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    """
    group_col → CTE 內維度別名（JOIN 欄）；value col → (current_*, previous_*) 聚合別名。
    盡可能僅用 [A-Za-z0-9_]，不加重引號。
    """
    used: set[str] = set()
    group_map: dict[str, str] = {}
    for i, gc in enumerate(group_cols):
        base = _schema_alias_stem(schema_def, gc) or _fallback_stem_from_col_code(gc)
        if len(group_cols) > 1:
            base = f"{base}_{i}"
        ga = base
        suf = 0
        while ga in used:
            suf += 1
            ga = f"{base}_{suf}"
        used.add(ga)
        group_map[gc] = ga

    metric_map: dict[str, tuple[str, str]] = {}
    stems_seen: list[str] = []
    for col, agg in specs:
        base = _schema_alias_stem(schema_def, col) or _fallback_stem_from_col_code(col)
        stem = base
        suf = 0
        while stem in stems_seen:
            suf += 1
            stem = f"{base}_{suf}"
        stems_seen.append(stem)
        ap = _agg_short_prefix(agg)
        cur_n = f"current_{ap}{stem}"
        prv_n = f"previous_{ap}{stem}"
        suf2 = 0
        while cur_n in used or prv_n in used:
            suf2 += 1
            cur_n = f"current_{ap}{stem}_{suf2}"
            prv_n = f"previous_{ap}{stem}_{suf2}"
        used.add(cur_n)
        used.add(prv_n)
        metric_map[col] = (cur_n, prv_n)

    return group_map, metric_map


_FILTER_COL_REF = re.compile(r"\b(col_[a-zA-Z0-9_]+)\b")


def _growth_expr_sql(cur_tbl: str, ca: str, prev_tbl: str, pa: str) -> str:
    """(本期 - 對照期) / 對照期；分母 0 則 NULL。"""
    c, p = f"{cur_tbl}.{_sql_ident(ca)}", f"{prev_tbl}.{_sql_ident(pa)}"
    return (
        f"(CAST({c} AS DOUBLE) - CAST({p} AS DOUBLE)) "
        f"/ NULLIF(CAST({p} AS DOUBLE), 0)"
    )


def _formula_quote_allowlisted_cols(formula: str, allowlist: set[str]) -> str | None:
    """
    將 formula 內裸露的 col_* 替換為 DuckDB 雙引號識別字；已寫成 "col_n" 的片段不重複包。
    任一 col_* 不在 allowlist → None。
    """
    if not formula.strip():
        return None
    cols_in_formula = set(_FILTER_COL_REF.findall(formula))
    for c in cols_in_formula:
        if c not in allowlist:
            return None
    out = formula
    for c in sorted(cols_in_formula, key=len, reverse=True):
        qi = _quote_ident(c)
        out = re.sub(rf"(?<![\w\"]){re.escape(c)}(?![\w\"])", qi, out)
    return out


_AGG_LABEL_ZH = {"sum": "加總", "avg": "平均", "count": "筆數"}


def _dataset_label_for_value_spec(
    col: str,
    agg: str,
    schema_def: dict[str, Any] | None,
) -> str:
    """
    chart datasets 的 label：若 schema 該欄有 aliases[0]，用「別名（加總|平均|筆數）」；
    否則維持 col_sum / col_count 形式。
    """
    agg_l = str(agg).strip().lower()
    fallback = f"{col}_{agg_l}" if agg_l != "count" else f"{col}_count"
    cols = (
        schema_def.get("columns")
        if isinstance(schema_def, dict) and isinstance(schema_def.get("columns"), dict)
        else None
    )
    if not cols:
        return fallback
    meta = cols.get(col)
    if not isinstance(meta, dict):
        return fallback
    al = meta.get("aliases")
    if not isinstance(al, list) or not al:
        return fallback
    disp = str(al[0]).strip()
    if not disp:
        return fallback
    zh = _AGG_LABEL_ZH.get(agg_l, agg_l)
    return f"{disp}（{zh}）"


def _dataset_label_for_formula_alias(alias: str, schema_def: dict[str, Any] | None) -> str:
    if not schema_def or not isinstance(schema_def.get("indicators"), dict):
        return alias
    ind_map = schema_def["indicators"]
    if not isinstance(ind_map, dict):
        return alias
    ent = ind_map.get(alias)
    if isinstance(ent, dict):
        lbl = ent.get("label") or ent.get("name")
        if isinstance(lbl, str) and lbl.strip():
            return lbl.strip()
    return alias


def _agg_select_fragment(col: str, agg: str, out_alias: str, *, plain_ident: bool = False) -> str:
    if plain_ident:
        qc, qa = _sql_ident(col), _sql_ident(out_alias)
    else:
        qc, qa = _quote_ident(col), _quote_ident(out_alias)
    if agg == "sum":
        return f"SUM({qc}) AS {qa}"
    if agg == "avg":
        return f"AVG({qc}) AS {qa}"
    return f"COUNT({qc}) AS {qa}"


def intent_sql_blockers(intent: dict[str, Any], schema_def: dict[str, Any]) -> list[str]:
    """若非空，intent（v2）目前無法轉成 SQL。"""
    from pydantic import ValidationError

    from app.schemas.intent_v2 import IntentV2, intent_sql_blockers_v2

    if not column_allowlist_from_schema(schema_def):
        return ["schema 無 columns 可供欄位白名單校驗"]
    try:
        v2 = IntentV2.model_validate(intent)
    except ValidationError as e:
        logger.info("IntentV2 驗證失敗（intent_sql_blockers）: %s", e.errors())
        return [USER_FACING_INTENT_VALIDATION_MESSAGE]
    return intent_sql_blockers_v2(v2, schema_def)


def chart_from_sql_dataframe(
    df: pd.DataFrame,
    meta: dict[str, Any],
    *,
    sql_pushdown: bool = True,
    engine_version: int = 2,
) -> dict[str, Any]:
    group_cols: list[str] = meta.get("group_cols") or []
    aliases: list[str] = meta["agg_aliases"]
    labels_list: list[str]
    if group_cols:
        labels_list = (
            df[group_cols]
            .astype(str)
            .apply(lambda row: " | ".join(row.tolist()), axis=1)
            .tolist()
        )
    else:
        labels_list = ["總計"]

    def cell_float(v: Any) -> float:
        if v is None:
            return 0.0
        if isinstance(v, float) and math.isnan(v):
            return 0.0
        if isinstance(v, (int, float)):
            return float(v)
        try:
            return float(v)
        except (ValueError, TypeError):
            return 0.0

    def _resolve_df_column(df: pd.DataFrame, alias: str) -> str:
        if alias in df.columns:
            return str(alias)
        al = str(alias).lower()
        for c in df.columns:
            if str(c).lower() == al:
                return str(c)
        return str(alias)

    datasets: list[dict[str, Any]] = []
    for alias, lbl in zip(aliases, meta["dataset_labels"]):
        col_name = _resolve_df_column(df, alias)
        ratio_like = bool(meta.get("grand_share")) or _sql_chart_series_is_ratio_like(lbl, alias)
        if ratio_like:
            series = [_sql_chart_ratio_to_percent_display(cell_float(x)) for x in df[col_name].tolist()]
            lbl_out = _sql_chart_label_append_percent_unit(lbl)
        else:
            series = [cell_float(x) for x in df[col_name].tolist()]
            lbl_out = lbl
        datasets.append({"label": lbl_out, "data": series, "valueLabel": lbl_out})

    return {
        "labels": labels_list,
        "datasets": datasets,
        "computeEngine": {"version": engine_version, "sqlPushdown": sql_pushdown},
    }


def run_sql_compute_engine(
    path: Path,
    intent: dict[str, Any],
    schema_def: dict[str, Any],
    *,
    engine_version: int = 2,
) -> tuple[dict[str, Any] | None, str | None, dict[str, Any]]:
    """
    intent → SQL → DuckDB；唯一計算路徑（僅 Intent v2）。
    回傳 (chart_result, error_detail, debug)。
    """
    from pydantic import ValidationError

    from app.schemas.intent_v2 import IntentV2, intent_sql_blockers_v2
    from app.services.compute_engine_sql_v2 import try_build_sql_v2

    debug: dict[str, Any] = {"sql_only": True, "sql_pushdown": False}
    try:
        intent_v2 = IntentV2.model_validate(intent)
    except ValidationError as e:
        logger.info("IntentV2 驗證失敗（run_sql_compute_engine）: %s", e.errors())
        return None, USER_FACING_INTENT_VALIDATION_MESSAGE, debug

    blockers = intent_sql_blockers_v2(intent_v2, schema_def)
    if blockers:
        msg = "此 intent 無法轉為 SQL：" + "；".join(blockers)
        return None, msg, {**debug, "blockers": blockers}

    allow = column_allowlist_from_schema(schema_def)
    built = try_build_sql_v2(intent_v2, allow, schema_def)
    if not built:
        return None, "無法自 intent 組出 SQL（請檢查 metrics 與 compare 設定）", debug

    sql, params, meta = built
    debug = {
        "sql_only": True,
        "sql_pushdown": True,
        "sql": sql,
        "sql_params": list(params),
    }
    df = execute_sql_on_duckdb_file(path, sql, params if params else None)
    if df is None:
        debug["sql_execute_ok"] = False
        return None, "DuckDB 執行 SQL 失敗", debug

    debug["sql_execute_ok"] = True
    if df.empty:
        return None, "篩選或聚合後無資料列", debug

    chart = chart_from_sql_dataframe(df, meta, sql_pushdown=True, engine_version=engine_version)
    return chart, None, debug


def try_run_sql_compute_engine(
    path: Path,
    intent: dict[str, Any],
    schema_def: dict[str, Any],
    *,
    engine_version: int = 2,
) -> tuple[bool, dict[str, Any] | None, str | None, dict[str, Any]]:
    """相容舊簽名：改委派 run_sql_compute_engine。"""
    chart, err, dbg = run_sql_compute_engine(path, intent, schema_def, engine_version=engine_version)
    ok = chart is not None and err is None
    return ok, chart, err, dbg
