"""
分析 compute flow：意圖萃取、資料解析、後端計算

架構：
  Layer 1 資料輸入：parse_csv, infer_schema, get_schema_summary
  Layer 2 欄位解析：_resolve_columns, _apply_filter
  Layer 3 彙總計算：_aggregate_single_series, _aggregate_multi_series
  Layer 4 後處理：_apply_sort_top_n
"""
import csv
import io
import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

logger = logging.getLogger(__name__)

# =============================================================================
# Layer 1：資料輸入
# =============================================================================


def parse_csv_content(content: str) -> list[dict[str, Any]] | None:
    """解析 CSV 字串為 list of dict。第一列為 header。"""
    if not content or not content.strip():
        return None
    try:
        reader = csv.DictReader(io.StringIO(content.strip()), delimiter=",", quoting=csv.QUOTE_MINIMAL)
        rows = list(reader)
        return rows if rows else None
    except Exception as e:
        logger.warning("parse_csv_content 失敗: %s", e)
        return None


def infer_schema(rows: list[dict[str, Any]]) -> dict[str, str]:
    """從資料推斷欄位與型別。數值欄位：可轉 float 的樣本 > 50%；否則為 string。"""
    if not rows:
        return {}
    schema: dict[str, str] = {}
    sample = rows[: min(100, len(rows))]
    for key in rows[0].keys():
        if not key or not key.strip():
            continue
        k = key.strip()
        numeric_count = 0
        for r in sample:
            v = r.get(key)
            if v is None or v == "":
                continue
            try:
                float(str(v).replace(",", "").replace(" ", ""))
                numeric_count += 1
            except (ValueError, TypeError):
                pass
        schema[k] = "number" if numeric_count > len(sample) * 0.5 else "string"
    return schema


def get_schema_summary(rows: list[dict[str, Any]], schema_def: dict[str, Any] | None = None) -> str:
    """
    產生給 LLM 的 schema 摘要。
    schema_def 為 None 時：infer_schema + 第一列範例。
    schema_def 有值時：依 columns 產生「欄位名 (型別) [用途] 範例」，僅列出 rows 中存在的欄位。
    """
    if not rows:
        return "無資料"
    actual_keys = [k for k in rows[0].keys() if k and k.strip()]
    sample = rows[0]
    inferred = infer_schema(rows)

    if not schema_def or not schema_def.get("columns"):
        cols = list(inferred.keys())
        sample_str = ", ".join(f"{k}={repr(sample.get(k, ''))[:30]}" for k in cols[:8])
        return f"欄位：{cols}\n型別：{inferred}\n第一列範例：{sample_str}"

    lines: list[str] = []
    columns = schema_def.get("columns") or {}
    for col in actual_keys:
        col_def = columns.get(col) if isinstance(columns.get(col), dict) else None
        if col_def:
            purposes = col_def.get("purposes")
            purposes_str = ",".join(purposes) if isinstance(purposes, list) else str(purposes or "")
            col_type = col_def.get("type", inferred.get(col, "string"))
            ex = col_def.get("example") or sample.get(col, "")
            lines.append(f"{col} ({col_type}) [{purposes_str}] 範例: {ex}")
        else:
            col_type = inferred.get(col, "string")
            ex = sample.get(col, "")
            lines.append(f"{col} ({col_type}) 範例: {ex}")
    return "\n".join(lines)


# =============================================================================
# Layer 2：欄位解析與輔助
# =============================================================================


@dataclass
class _SchemaConfig:
    """從 schema_def 推導的執行期設定，取代 hardcoded 常數。"""

    group_aliases: dict[str, list[str]]
    value_aliases: dict[str, list[str]]
    value_key_to_column: dict[str, str]  # alias -> col_name，供動態 {col}_ratio 解析
    value_column_names: set[str]  # 數值欄位名，供動態佔比比對
    indicator_column_names: dict[str, tuple[str, str]]  # code -> (num_col, denom_col)
    indicator_as_percent: dict[str, bool]  # code -> as_percent
    compare_indicator_value_col: dict[str, str]  # code -> value_col
    indicator_labels: dict[str, str]
    indicator_decimal_places: dict[str, int]
    value_display_names: dict[str, str]
    value_suffix: dict[str, str]
    dataset_label_suffix: dict[str, str]
    display_field_aliases: dict[str, list[str]]
    # 指標 value_components 順序（語意名如 gross_profit），若 DuckDB 為 col_* 需與 value_columns 同序對位
    indicator_component_lists: dict[str, list[str]]


def _derive_schema_config(schema_def: dict[str, Any]) -> _SchemaConfig:
    """
    從 schema_def (YAML) 推導執行期 config。
    schema_def 為 None 或空時不可用，caller 須先檢查。
    """
    columns = schema_def.get("columns") or {}
    indicators = schema_def.get("indicators") or {}

    indicator_component_lists: dict[str, list[str]] = {}
    for code, meta in indicators.items():
        if not isinstance(meta, dict):
            continue
        vc = meta.get("value_components") or []
        if isinstance(vc, list) and vc:
            indicator_component_lists[code] = [str(x).strip() for x in vc if x]

    # group_aliases, value_aliases, value_key_to_column, value_column_names
    group_aliases: dict[str, list[str]] = {}
    value_aliases: dict[str, list[str]] = {}
    value_key_to_column: dict[str, str] = {}
    value_column_names: set[str] = set()
    for col_name, meta in columns.items():
        if not isinstance(meta, dict):
            continue
        attr = (meta.get("attr") or "dim").strip().lower()
        aliases = list(meta.get("aliases") or [])
        keywords = [col_name] + [str(a) for a in aliases if a]
        if attr in ("dim", "dim_time"):
            for kw in keywords:
                if kw and kw not in group_aliases:
                    group_aliases[kw] = keywords
        elif attr in ("val", "val_num", "val_denom"):
            value_column_names.add(col_name)
            for kw in keywords:
                if kw and kw not in value_aliases:
                    value_aliases[kw] = keywords
                value_key_to_column[kw] = col_name

    # indicator config
    indicator_column_names: dict[str, tuple[str, str]] = {}
    indicator_as_percent: dict[str, bool] = {}
    compare_indicator_value_col: dict[str, str] = {}
    indicator_labels: dict[str, str] = {}
    indicator_decimal_places: dict[str, int] = {}
    for code, meta in indicators.items():
        if not isinstance(meta, dict):
            continue
        ind_type = (meta.get("type") or "ratio").strip().lower()
        comp = meta.get("value_components") or []
        display_label = meta.get("display_label") or code
        indicator_labels[code] = display_label
        indicator_as_percent[code] = bool(meta.get("as_percent", False))
        if ind_type == "compare_period" and comp:
            compare_indicator_value_col[code] = str(comp[0])
            if code.endswith("_yoy_growth") and len(code) > 11:
                compare_indicator_value_col[f"{comp[0]}_yoy_growth"] = str(comp[0])
        elif ind_type == "ratio" and len(comp) >= 2:
            indicator_column_names[code] = (str(comp[0]), str(comp[1]))
        elif ind_type == "ratio" and len(comp) == 1:
            # 佔比型：同一欄位，分母為全體總和 (sum(group)/sum(all))
            indicator_column_names[code] = (str(comp[0]), "__total__")
        if meta.get("decimal_places") is not None:
            indicator_decimal_places[code] = int(meta.get("decimal_places"))

    # value display names：column -> 首個 alias 或 col_name
    value_display_names: dict[str, str] = {}
    value_suffix: dict[str, str] = {}
    for col_name, meta in columns.items():
        if not isinstance(meta, dict):
            continue
        attr = (meta.get("attr") or "").strip().lower()
        if attr not in ("val", "val_num", "val_denom"):
            continue
        aliases = meta.get("aliases") or []
        display = (aliases[0] if aliases else col_name)
        value_display_names[col_name] = str(display)
        suf = meta.get("value_suffix")
        if suf is not None:
            value_suffix[col_name] = str(suf)
            value_suffix[str(display)] = str(suf)
        else:
            nm = str(col_name).lower()
            # 僅 guest_count、patient_count 等「人數」欄位用「人」，避免 discount_amount 被誤判
            is_count_col = nm.endswith("_count") or nm == "count" or "人數" in str(display)
            value_suffix[col_name] = "人" if is_count_col else "元"
            value_suffix[str(display)] = value_suffix[col_name]

    # 動態佔比 {col}_ratio：從 value_column_names 動態產生（無硬編碼欄位名）
    for col in value_column_names:
        code = f"{col}_ratio"
        indicator_column_names[code] = (col, "__total__")
        indicator_labels[code] = value_display_names.get(col, col) + "佔比"
        indicator_as_percent[code] = True
        if "_" in col:
            base = col.split("_")[0]
            if base and f"{base}_ratio" not in indicator_column_names:
                indicator_column_names[f"{base}_ratio"] = (col, "__total__")
                indicator_labels[f"{base}_ratio"] = value_display_names.get(col, col) + "佔比"
                indicator_as_percent[f"{base}_ratio"] = True

    # dataset_label_suffix：indicator 與 value 的 % 或 元
    dataset_label_suffix: dict[str, str] = dict(value_suffix)
    for code, lbl in indicator_labels.items():
        meta = indicators.get(code) if isinstance(indicators, dict) else None
        as_pct = meta.get("as_percent", False) if isinstance(meta, dict) else False
        dataset_label_suffix[lbl] = "%" if as_pct else ("元" if "arpu" in code or "客單" in lbl else "")

    # display_field_aliases：label -> [column, aliases...]
    display_field_aliases: dict[str, list[str]] = {}
    for code, lbl in indicator_labels.items():
        display_field_aliases[lbl] = [lbl, code]
    for col_name, meta in columns.items():
        if not isinstance(meta, dict):
            continue
        aliases = meta.get("aliases") or []
        display = (aliases[0] if aliases else col_name)
        if display not in display_field_aliases:
            display_field_aliases[display] = [display, col_name] + [str(a) for a in aliases]
    display_field_aliases["YoY成長率"] = ["YoY成長率", "sales_yoy_growth", "yoy_growth"]
    display_field_aliases["去年同期銷售金額"] = ["去年同期銷售金額", "sales_amount_compare", "previous_sales_amount"]
    # 純數值欄 compare_periods：讓 previous_col_n、col_n_yoy_growth 能對到「去年同期{顯示名}」與 YoY
    for col in value_column_names:
        dn = value_display_names.get(col, col)
        prev_lbl = f"去年同期{dn}"
        extra_prev = [f"previous_{col}", f"{col}_compare"]
        if prev_lbl not in display_field_aliases:
            display_field_aliases[prev_lbl] = [prev_lbl, *extra_prev]
        else:
            display_field_aliases[prev_lbl].extend([a for a in extra_prev if a not in display_field_aliases[prev_lbl]])
        for yoy_a in (f"{col}_yoy_growth", f"{col}_growth"):
            if yoy_a not in display_field_aliases["YoY成長率"]:
                display_field_aliases["YoY成長率"].append(yoy_a)
    # 各 ratio 指標的「前期」「成長率」別名，供 compare_periods + ratio 流程使用
    for code, lbl in indicator_labels.items():
        if code in indicator_column_names and code not in compare_indicator_value_col:
            prev_lbl = f"前期{lbl}"
            display_field_aliases[prev_lbl] = [prev_lbl, f"previous_{code}", f"{code}_compare"]
            growth_lbl = f"{lbl}成長率"
            display_field_aliases[growth_lbl] = [
                growth_lbl, f"{code}_growth", f"{code}_yoy_growth"
            ]

    return _SchemaConfig(
        group_aliases=group_aliases,
        value_aliases=value_aliases,
        value_key_to_column=value_key_to_column,
        value_column_names=value_column_names,
        indicator_column_names=indicator_column_names,
        indicator_as_percent=indicator_as_percent,
        compare_indicator_value_col=compare_indicator_value_col,
        indicator_labels=indicator_labels,
        indicator_decimal_places=indicator_decimal_places,
        value_display_names=value_display_names,
        value_suffix=value_suffix,
        dataset_label_suffix=dataset_label_suffix,
        display_field_aliases=display_field_aliases,
        indicator_component_lists=indicator_component_lists,
    )


_HIERARCHY_SEP = "\x1f"


def _get_group_value(r: dict[str, Any], group_key: str, group_keys: list[str] | None) -> str:
    """取得分組值：單層用 group_key，多層用 group_keys 組成複合 key。"""
    if group_keys and len(group_keys) > 1:
        parts = [str(r.get(k, "") or "").strip() or "(空)" for k in group_keys]
        return _HIERARCHY_SEP.join(parts)
    return str(r.get(group_key, "") or "").strip() or "(空)"


def _parse_num(v: Any) -> float:
    """解析數值，支援千分位逗號"""
    if v is None or v == "":
        return 0.0
    try:
        return float(str(v).replace(",", "").replace(" ", ""))
    except (ValueError, TypeError):
        return 0.0


def _time_sort_key(s: str) -> tuple[int, int, int]:
    """將時間字串轉為 (year, month, sub) 用於排序。支援 YYYY、YYYY-MM、YYYY-Qn、YYYY-Wnn、YYYY-MM-DD"""
    s = str(s).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{4})-Q(\d{1,2})", s, re.I)
    if m:
        return (int(m.group(1)), int(m.group(2)) * 3, 0)  # Q1→3, Q2→6, Q3→9, Q4→12
    m = re.match(r"^(\d{4})-W(\d{1,2})", s, re.I)
    if m:
        return (int(m.group(1)), 0, int(m.group(2)))
    m = re.match(r"^(\d{4})-(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), 0)
    m = re.match(r"^(\d{4})$", s)
    if m:
        return (int(m.group(1)), 0, 0)
    m = re.match(r"^(\d{1,2})月", s)
    if m:
        return (0, int(m.group(1)), 0)
    months = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
    for name, num in months.items():
        if s.lower().startswith(name):
            return (0, num, 0)
    return (0, 0, 0)


def _find_matching_column(actual_keys: list[str], intent_name: str | None, aliases: dict[str, list[str]]) -> str | None:
    """依意圖名稱或別名，從實際欄位中找最佳匹配。"""
    if not intent_name or not actual_keys:
        return None
    intent_clean = intent_name.strip()
    for k in actual_keys:
        if k.strip() == intent_clean:
            return k
    for k in actual_keys:
        k_clean = k.strip()
        if intent_clean in k_clean or k_clean in intent_clean:
            return k
    for alias_key, keywords in aliases.items():
        if intent_clean in keywords or any(kw in intent_clean for kw in keywords):
            for k in actual_keys:
                k_clean = k.strip().lower()
                for kw in keywords:
                    if kw.lower() in k_clean or k_clean in kw.lower():
                        return k
    return None


def _normalize_for_match(s: str) -> str:
    """正規化字串用於比對：小寫、去空白、合併空格"""
    return "".join(str(s or "").strip().lower().split())


def _like_match(pattern: str, cell: str) -> bool:
    """SQL LIKE 語意：% 為萬用字元（任意字元）。pattern 與 cell 皆先 normalize。"""
    pat = _normalize_for_match(pattern)
    c = _normalize_for_match(str(cell or ""))
    if not pat:
        return True
    parts = pat.split("%")
    if len(parts) == 1:
        return pat == c
    idx = 0
    for i, part in enumerate(parts):
        if not part:
            continue
        pos = c.find(part, idx)
        if pos < 0:
            return False
        if i == 0 and pos != 0:
            return False
        idx = pos + len(part)
    if parts[-1] and idx != len(c):
        return False
    return True


def _parse_date_safe(s: str) -> tuple[int, int, int] | None:
    """解析日期字串為 (y, m, d)，支援 YYYY-MM-DD、YYYY/MM/DD、YYYYMMDD"""
    if not s or not isinstance(s, str):
        return None
    s = str(s).strip()
    m = re.match(r"^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _date_to_grain(date_val: Any, grain: str) -> str:
    """將日期轉為 time_grain 顆粒度：day 保持原樣，week→YYYY-Wnn，month→YYYY-MM，quarter→YYYY-Qn，year→YYYY"""
    if not date_val:
        return "(空)"
    parsed = _parse_date_safe(str(date_val))
    if not parsed:
        return str(date_val).strip() or "(空)"
    y, m, d = parsed
    g = (grain or "").strip().lower()
    if g == "year":
        return f"{y}"
    if g == "quarter":
        q = (m - 1) // 3 + 1
        return f"{y}-Q{q}"
    if g == "month":
        return f"{y}-{m:02d}"
    if g == "week":
        try:
            t = date(y, m, d)
            iso = t.isocalendar()
            return f"{iso[0]}-W{iso[1]:02d}"
        except (ValueError, TypeError):
            return f"{y}-{m:02d}-{d:02d}"
    # day 或未指定：保持原樣
    return f"{y}-{m:02d}-{d:02d}"


_TIME_GRAIN_BUCKET_COL = "__time_grain_bucket"

_DATE_COLUMN_NAMES: frozenset[str] = frozenset({"timestamp", "event_date", "event-date", "date", "月份", "month", "時間"})


def _parse_compare_periods(cp: Any) -> dict[str, Any] | None:
    """解析 compare_periods，回傳 { date_col, current_val, compare_val } 或 None。"""
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
    return {"date_col": col, "current_val": cur_val, "compare_val": cmp_val}


def _indicator_str(indicator: list[str] | None) -> str:
    """indicator 為 array 時，回傳單一 string（供需要單一指標的邏輯使用）"""
    if indicator and len(indicator) > 0:
        return str(indicator[0]).strip().lower()
    return ""


def _is_date_column(column: str, schema_def: dict[str, Any] | None = None) -> bool:
    """是否為日期欄位（用於 BETWEEN/>= <= 邏輯）。`col_2` 等須依 schema columns.attr=dim_time 判斷。"""
    c = (column or "").strip().lower()
    if c in _DATE_COLUMN_NAMES or "date" in c:
        return True
    if schema_def and isinstance(schema_def.get("columns"), dict):
        for k, m in schema_def["columns"].items():
            if not isinstance(m, dict):
                continue
            if str(k).strip().lower() == c:
                if (m.get("attr") or "").strip().lower() == "dim_time":
                    return True
                break
    return False


def _apply_filter(
    rows: list[dict[str, Any]],
    filter_key: str,
    filter_value: Any,
    *,
    op: str = "==",
    is_date_column: bool = False,
) -> list[dict[str, Any]]:
    """依 filter_value 與 op 篩選 rows。op: ==, !=, >, <, >=, <=, like, contains。日期區間維持現有邏輯，op 不影響。"""
    if not rows or not filter_key or filter_value is None:
        return rows
    op = (op or "==").strip().lower().replace(" ", "") or "=="

    if isinstance(filter_value, list):
        if is_date_column:
            # 日期欄位：多個區間為 OR，取聯集
            seen_ids: set[int] = set()
            result: list[dict[str, Any]] = []
            for v in filter_value:
                if v is None:
                    continue
                val_str = str(v).strip()
                if "/" in val_str and re.match(
                    r"^\d{4}[-/]?\d{1,2}[-/]?\d{1,2}\s*/\s*\d{4}[-/]?\d{1,2}[-/]?\d{1,2}",
                    val_str.replace(" ", ""),
                ):
                    parts = val_str.split("/", 1)
                    start_d = _parse_date_safe(parts[0].strip())
                    end_d = _parse_date_safe(parts[1].strip())
                    if start_d and end_d:
                        for r in rows:
                            if id(r) in seen_ids:
                                continue
                            cell = r.get(filter_key)
                            d = _parse_date_safe(str(cell) if cell is not None else "")
                            if d and start_d <= d <= end_d:
                                seen_ids.add(id(r))
                                result.append(r)
                else:
                    single_d = _parse_date_safe(val_str)
                    if single_d:
                        for r in rows:
                            if id(r) in seen_ids:
                                continue
                            if _parse_date_safe(str(r.get(filter_key, "") or "")) == single_d:
                                seen_ids.add(id(r))
                                result.append(r)
            return result
        if op == "!=":
            excluded = {_normalize_for_match(str(v)) for v in filter_value if v}
            return [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) not in excluded]
        if op == "==":
            allowed_norm = {_normalize_for_match(str(v)) for v in filter_value if v}
            result = [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) in allowed_norm]
            if not result:
                result = [r for r in rows if any(t in _normalize_for_match(str(r.get(filter_key, "") or "")) for t in allowed_norm)]
            return result
        if op == "like":
            result = []
            for r in rows:
                cell = str(r.get(filter_key, "") or "")
                if any(_like_match(str(v), cell) for v in filter_value if v):
                    result.append(r)
            return result
        return rows
    val_str = str(filter_value).strip()

    # 日期欄位：維持現有邏輯，op 不影響。value 為 start/end 時用 BETWEEN
    if is_date_column:
        if "/" in val_str and re.match(r"^\d{4}[-/]?\d{1,2}[-/]?\d{1,2}\s*/\s*\d{4}[-/]?\d{1,2}[-/]?\d{1,2}", val_str.replace(" ", "")):
            parts = val_str.split("/", 1)
            start_d = _parse_date_safe(parts[0].strip())
            end_d = _parse_date_safe(parts[1].strip())
            if start_d and end_d:
                result = []
                for r in rows:
                    cell = r.get(filter_key)
                    d = _parse_date_safe(str(cell) if cell is not None else "")
                    if d and start_d <= d <= end_d:
                        result.append(r)
                return result
        else:
            single_d = _parse_date_safe(val_str)
            if single_d:
                if op in (">", "<", ">=", "<="):
                    result = []
                    for r in rows:
                        cell = r.get(filter_key)
                        d = _parse_date_safe(str(cell) if cell is not None else "")
                        if d:
                            if op == ">" and d > single_d:
                                result.append(r)
                            elif op == "<" and d < single_d:
                                result.append(r)
                            elif op == ">=" and d >= single_d:
                                result.append(r)
                            elif op == "<=" and d <= single_d:
                                result.append(r)
                    return result
                result = [r for r in rows if _parse_date_safe(str(r.get(filter_key, "") or "")) == single_d]
                if result:
                    return result

    # 數值比較：op 明確指定，value 須為數字
    if op in (">", "<", ">=", "<="):
        try:
            threshold = float(str(filter_value).replace(",", "").strip())
        except (ValueError, TypeError):
            return rows
        result = []
        for r in rows:
            v = _parse_num(r.get(filter_key))
            if op == ">" and v > threshold:
                result.append(r)
            elif op == "<" and v < threshold:
                result.append(r)
            elif op == ">=" and v >= threshold:
                result.append(r)
            elif op == "<=" and v <= threshold:
                result.append(r)
        return result
    if op == "!=":
        try:
            threshold = float(str(filter_value).replace(",", "").strip())
        except (ValueError, TypeError):
            threshold = None
        if threshold is not None:
            return [r for r in rows if _parse_num(r.get(filter_key)) != threshold]
        # 字串 !=
        target_norm = _normalize_for_match(val_str)
        return [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) != target_norm]
    if op == "like":
        return [r for r in rows if _like_match(val_str, str(r.get(filter_key, "") or ""))]
    if op == "contains":
        needle = val_str
        if not needle:
            return rows
        return [r for r in rows if needle in str(r.get(filter_key, "") or "")]
    # op == "=="（預設）
    target_norm = _normalize_for_match(val_str)
    exact = [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) == target_norm]
    contains = [r for r in rows if target_norm in _normalize_for_match(str(r.get(filter_key, "") or ""))]
    if exact:
        seen = {id(r) for r in exact}
        for r in contains:
            if id(r) not in seen:
                exact.append(r)
                seen.add(id(r))
        return exact
    return contains if contains else []


@dataclass
class _ResolvedColumns:
    """解析後的欄位對應"""
    group_key: str
    group_keys: list[str]  # 多層時為 [cat_l1, cat_l2, item_name]，單層為 [group_key]
    value_keys: list[str]
    value_aggregations: list[str]  # 與 value_keys 同序，每欄位的 sum|avg|count
    filter_key: str | None
    series_key: str | None


def _resolve_columns(
    rows: list[dict[str, Any]],
    group_by_column: str | list[str] | None,
    value_columns: list[dict[str, Any]],
    filter_column: str | None,
    series_by_column: str | None,
    *,
    group_aliases: dict[str, list[str]] | None = None,
    value_aliases: dict[str, list[str]] | None = None,
    error_out: list[str] | None = None,
) -> _ResolvedColumns | None:
    """
    將 intent 的欄位名稱解析為實際的 row keys。
    value_columns 為 [{ column, aggregation }, ...]，每項必含 column 與 aggregation。
    group_by_column 可為 str 或 list[str]（多層階級）。
    """
    if not rows:
        if error_out is not None:
            error_out.append("rows 為空")
        return None
    if not value_columns:
        if error_out is not None:
            error_out.append("value_columns 為空")
        return None
    gb_raw = group_by_column
    gb_list: list[str] = []
    if isinstance(gb_raw, list):
        gb_list = [str(x).strip() for x in gb_raw if x]
    elif gb_raw and str(gb_raw).strip():
        gb_list = [str(gb_raw).strip()]
    if not gb_list:
        if error_out is not None:
            error_out.append("group_by_column 為空")
        return None
    actual_keys = [k for k in rows[0].keys() if k and k.strip()]
    g_aliases = group_aliases or {}
    v_aliases = value_aliases or {}

    # value_keys, value_aggregations（從 value_columns 物件陣列解析）
    value_keys: list[str] = []
    value_aggregations: list[str] = []
    for vc in value_columns:
        if not isinstance(vc, dict):
            continue
        col = vc.get("column")
        agg = (vc.get("aggregation") or "sum").strip().lower()
        if agg not in ("sum", "avg", "count"):
            agg = "sum"
        if not col or not str(col).strip():
            continue
        vc_clean = str(col).strip()
        k = next((ak for ak in actual_keys if ak.strip() == vc_clean), None) or _find_matching_column(actual_keys, vc_clean, v_aliases)
        if not k:
            for ak in actual_keys:
                if vc_clean.lower() in ak.strip().lower() or ak.strip().lower() in vc_clean.lower():
                    k = ak
                    break
        if k and k not in value_keys:
            value_keys.append(k)
            value_aggregations.append(agg)
    if not value_keys:
        msg = f"找不到 value 欄位: value_columns={value_columns!r}"
        logger.warning("%s", msg)
        if error_out is not None:
            error_out.append(msg)
        return None

    # group_keys（支援多層）
    group_keys: list[str] = []
    for gb in gb_list:
        k = next((ak for ak in actual_keys if ak.strip() == gb), None) or _find_matching_column(actual_keys, gb, g_aliases)
        if not k:
            msg = f"找不到 group_by 欄位: {gb!r}"
            logger.warning("%s", msg)
            if error_out is not None:
                error_out.append(msg)
            return None
        group_keys.append(k)
    group_key = group_keys[-1]

    # filter_key
    filter_key = None
    if filter_column:
        filter_key = _find_matching_column(actual_keys, filter_column, g_aliases) or (filter_column if filter_column in actual_keys else None)

    # series_key
    series_key = None
    if series_by_column:
        series_key = next((ak for ak in actual_keys if ak.strip() == series_by_column.strip()), None) or _find_matching_column(actual_keys, series_by_column, g_aliases)

    return _ResolvedColumns(
        group_key=group_key,
        group_keys=group_keys,
        value_keys=value_keys,
        value_aggregations=value_aggregations,
        filter_key=filter_key,
        series_key=series_key,
    )


# =============================================================================
# Layer 3：彙總計算
# =============================================================================


def _compute_derived_indicator_rows(
    rows: list[dict[str, Any]],
    indicator_names: set[str],
    actual_keys: list[str],
    cfg: _SchemaConfig,
) -> None:
    """對 rows 就地計算衍生指標並寫入每列。"""
    for ind in indicator_names:
        if ind not in cfg.indicator_column_names:
            continue
        num_col, denom_col = cfg.indicator_column_names[ind]
        num_key = next((ak for ak in actual_keys if ak.strip() == num_col), None) or _find_matching_column(actual_keys, num_col, cfg.value_aliases)
        denom_key = next((ak for ak in actual_keys if ak.strip() == denom_col), None) or _find_matching_column(actual_keys, denom_col, cfg.value_aliases)
        if not num_key or not denom_key:
            continue
        for r in rows:
            num_val = _parse_num(r.get(num_key))
            denom_val = _parse_num(r.get(denom_key))
            val = (num_val / denom_val) if denom_val != 0 else 0.0
            r[ind] = val


def _is_compare_indicator(indicator: list[str] | None, cfg: _SchemaConfig) -> tuple[bool, str | None]:
    """indicator 是否含比較期間類型，回傳 (True, value_col) 或 (False, None)。"""
    if not indicator:
        return (False, None)
    for ind in indicator:
        ic = _canonical_indicator_code(str(ind or ""), cfg)
        if ic in cfg.compare_indicator_value_col:
            return (True, cfg.compare_indicator_value_col[ic])
        s = (ind or "").strip().lower()
        if s.endswith("_yoy_growth") and len(s) > 11:
            vcol = s[:-11].strip()
            if vcol:
                return (True, vcol)
    return (False, None)


def _resolve_dynamic_ratio_column(base: str, cfg: _SchemaConfig) -> str | None:
    """動態佔比 {col}_ratio：base 對應到數值欄位。例: sales->sales_amount, quantity->quantity"""
    base_lower = base.strip().lower()
    if not base_lower:
        return None
    for col in cfg.value_column_names:
        if base_lower == col.lower():
            return col
        if len(base_lower) >= 2 and base_lower in col.lower():
            return col
    return None


def _canonical_indicator_code(ind: str, cfg: _SchemaConfig) -> str:
    """與 schema 中 indicators 鍵一致（大小寫不敏感，如 roi ↔ ROI）；含 compare_period 與動態 *_yoy_growth 對照。"""
    s = str(ind).strip()
    if not s:
        return ind
    sl = s.lower()
    for k in cfg.indicator_column_names:
        if str(k).lower() == sl:
            return str(k)
    for k in cfg.indicator_labels:
        if str(k).lower() == sl:
            return str(k)
    for k in cfg.compare_indicator_value_col:
        if str(k).lower() == sl:
            return str(k)
    return ind


def _get_indicator_keys(ind: str, value_keys: list[str], cfg: _SchemaConfig) -> tuple[str, str, bool] | None:
    """依欄位名稱解析 indicator 的 num_key, denom_key, as_percent。支援 config、運算式 (A/B)、動態 {col}_ratio。"""
    ind = _canonical_indicator_code(ind, cfg)
    if ind in cfg.indicator_column_names:
        num_col, denom_col = cfg.indicator_column_names[ind]
        as_pct = cfg.indicator_as_percent.get(ind, False)
        num_key = next(
            (k for k in value_keys if
             k.strip().lower() == num_col.lower() or num_col.lower() in k.strip().lower() or
             cfg.value_key_to_column.get(k) == num_col or
             (num_col and k in (cfg.value_aliases.get(num_col) or []))),
            None,
        )
        if not num_key:
            # 指標語意名（gross_profit）與實體欄（col_9）不一致時：依 value_components 順序與 value_columns 同序對位
            comps = list(cfg.indicator_component_lists.get(ind) or [])
            if len(comps) < 2 and denom_col != "__total__" and num_col and denom_col:
                comps = [num_col, denom_col]
            if (
                comps
                and len(comps) == 2
                and denom_col != "__total__"
                and len(value_keys) == len(comps)
            ):
                def _idx(comp_list: list[str], name: str) -> int | None:
                    nl = (name or "").strip().lower()
                    for i, c in enumerate(comp_list):
                        if str(c).strip().lower() == nl:
                            return i
                    return None

                ni = _idx(comps, str(num_col))
                di = _idx(comps, str(denom_col))
                if ni is not None and di is not None:
                    try:
                        return (value_keys[ni], value_keys[di], as_pct)
                    except IndexError:
                        pass
            return None
        if denom_col == "__total__":
            return (num_key, "__total__", as_pct)
        denom_key = next((k for k in value_keys if k.strip().lower() == denom_col.lower() or denom_col.lower() in k.strip().lower()), None)
        if not denom_key:
            comps = list(cfg.indicator_component_lists.get(ind) or [])
            if len(comps) < 2 and denom_col != "__total__" and num_col and denom_col:
                comps = [num_col, denom_col]
            if (
                comps
                and len(comps) == 2
                and denom_col != "__total__"
                and len(value_keys) == len(comps)
            ):
                def _idx2(comp_list: list[str], name: str) -> int | None:
                    nl = (name or "").strip().lower()
                    for i, c in enumerate(comp_list):
                        if str(c).strip().lower() == nl:
                            return i
                    return None

                ni = _idx2(comps, str(num_col))
                di = _idx2(comps, str(denom_col))
                if ni is not None and di is not None:
                    try:
                        return (value_keys[ni], value_keys[di], as_pct)
                    except IndexError:
                        pass
        return (num_key, denom_key, as_pct) if denom_key else None
    if ind and ind.endswith("_ratio") and len(ind) > 5:
        base = ind[:-5]
        col = _resolve_dynamic_ratio_column(base, cfg)
        if col:
            num_key = next(
                (k for k in value_keys if
                 cfg.value_key_to_column.get(k) == col or k.strip().lower() == col.lower() or
                 (col and k in (cfg.value_aliases.get(col) or []))),
                None,
            )
            if num_key:
                return (num_key, "__total__", True)
    if ind and "/" in ind:
        parts = ind.strip().split("/")
        if len(parts) == 2:
            num_col, denom_col = parts[0].strip(), parts[1].strip()
            if num_col and denom_col:
                num_key = next((k for k in value_keys if k.strip().lower() == num_col.lower()), None)
                denom_key = next((k for k in value_keys if k.strip().lower() == denom_col.lower()), None)
                if num_key and denom_key:
                    return (num_key, denom_key, True)
    return None


def _dataset_item(lbl: str, data: list[float], cfg: _SchemaConfig) -> dict[str, Any]:
    """單一 dataset 項目，含 label、data、valueLabel。"""
    return {"label": lbl, "data": data, "valueLabel": lbl}


def _filter_datasets_by_display_fields(
    datasets: list[tuple[str, list[float]]],
    display_fields: list[str] | None,
    cfg: _SchemaConfig,
) -> list[tuple[str, list[float]]]:
    """
    依 display_fields 過濾 datasets。
    - 支援 dataset label 大小寫不一致、以及指標 code（如 roi）與 display_label（如 ROI）對應。
    - display_fields 常混入 group_by 欄位名（僅軸／labels，非 series）：若無任何匹配則回傳原 datasets，避免過濾成空導致後續 list index out of range。
    """
    if not display_fields:
        return datasets
    label_to_data = {lbl: data for lbl, data in datasets}
    filtered: list[tuple[str, list[float]]] = []
    seen: set[str] = set()

    def _add_if_matched(token: str) -> bool:
        """依 token 找 label_to_data 的 key（精確或不分大小寫）。"""
        if not token:
            return False
        if token in label_to_data and token not in seen:
            filtered.append((token, label_to_data[token]))
            seen.add(token)
            return True
        tl = token.lower()
        for k in label_to_data:
            if k.lower() == tl and k not in seen:
                filtered.append((k, label_to_data[k]))
                seen.add(k)
                return True
        return False

    for df in display_fields:
        df_clean = (df or "").strip()
        if not df_clean:
            continue
        if _add_if_matched(df_clean):
            continue
        # 指標 code / display_label（與 intent 中 ROI、roi 混用一致）
        matched_code = False
        for code, disp in cfg.indicator_labels.items():
            if df_clean.lower() not in (str(code).lower(), str(disp).lower()):
                continue
            if _add_if_matched(str(disp)) or _add_if_matched(str(code)):
                matched_code = True
                break
        if matched_code:
            continue
        matched_this_df = False
        for label, aliases in cfg.display_field_aliases.items():
            if df_clean not in aliases and df_clean != label:
                continue
            for lbl, data in datasets:
                base = lbl.split(" - ")[0].strip() if " - " in lbl else lbl
                if (base == label or base in aliases) and lbl not in seen:
                    filtered.append((lbl, data))
                    seen.add(lbl)
                    matched_this_df = True
            if matched_this_df:
                break
    if not filtered and datasets:
        return datasets
    return filtered


def _schema_column_codes_and_aliases(col: str, cfg: _SchemaConfig) -> set[str]:
    """欄位實際名與 display_field_aliases 內所有可指到該欄的字串（小寫）。"""
    c = (col or "").strip().lower()
    out: set[str] = {c}
    for label, aliases in cfg.display_field_aliases.items():
        al = [str(x).strip().lower() for x in (aliases or [])]
        lb = str(label).strip().lower()
        if c == lb or c in al:
            out.add(lb)
            out.update(al)
    return out


def _alias_entry_is_resolved_group_column(
    entry_label: str,
    entry_aliases: Any,
    resolved: _ResolvedColumns,
) -> bool:
    """
    display_field_aliases 的一條目是否對應到目前的 group_by 欄位（物理名或別名）。
    若維度顯示名／別名與某分組值字面相同（例如維度第一別名為「車系」且某列 col_6=「車系」），
    避免把該顯示名誤當成「只保留此桶」過濾 pairs。
    """
    if resolved.group_keys:
        gcols = [str(x).strip() for x in resolved.group_keys if x]
    else:
        gcols = [str(resolved.group_key).strip()] if resolved.group_key else []
    gnorm = {g.lower() for g in gcols if g}
    alist: list[str] = entry_aliases if isinstance(entry_aliases, list) else [entry_aliases]
    tokens = {str(entry_label).strip().lower()}
    for a in alist:
        if a is not None and str(a).strip():
            tokens.add(str(a).strip().lower())
    return bool(gnorm & tokens)


def _apply_display_fields(
    pairs: list[tuple[str, float]],
    display_fields: list[str],
    cfg: _SchemaConfig,
    *,
    resolved: _ResolvedColumns | None = None,
) -> list[tuple[str, float]]:
    """
    依 display_fields 過濾 pairs（多指標／總計列等仍須子集合時使用）。
    註：有分組且僅單一 value、無 indicator 時，caller 不會呼叫此函式（見 compute_aggregate）。
    """
    if not display_fields or not pairs:
        return pairs
    label_to_val = {p[0]: p[1] for p in pairs}
    result: list[tuple[str, float]] = []
    seen: set[str] = set()
    for df in display_fields:
        df_clean = (df or "").strip()
        if not df_clean:
            continue
        for label, aliases in cfg.display_field_aliases.items():
            if label in seen:
                continue
            if df_clean in aliases or df_clean == label:
                if resolved and _alias_entry_is_resolved_group_column(label, aliases, resolved):
                    break
                if label in label_to_val:
                    result.append((label, label_to_val[label]))
                    seen.add(label)
                break
    if not result and resolved and len(resolved.value_keys) >= 1:
        allowed: set[str] = set()
        for gcol in (resolved.group_keys or [resolved.group_key]):
            allowed |= _schema_column_codes_and_aliases(gcol, cfg)
        for vk in resolved.value_keys:
            allowed |= _schema_column_codes_and_aliases(vk, cfg)
        if all(
            (df or "").strip().lower() in allowed
            for df in display_fields
            if (df or "").strip()
        ):
            return pairs
    return result


def _aggregate_indicator_plus_values_by_group(
    rows: list[dict[str, Any]],
    group_key: str,
    num_key: str,
    denom_key: str,
    as_percent: bool,
    extra_value_keys: list[str],
    extra_value_aggregations: list[str],
    ind: str,
    group_keys: list[str] | None = None,
    cfg: _SchemaConfig | None = None,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """
    indicator + 額外 value 欄位，依 group 分組。extra 欄位各有 aggregation。
    回傳 (group_vals, datasets)，順序：indicator、extra1、extra2...
    """
    groups_num: dict[str, float] = {}
    groups_denom: dict[str, float] = {}
    pivots: dict[str, dict[str, float]] = {vk: {} for vk in extra_value_keys}
    counts: dict[str, int] = {}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        groups_num[gv] = groups_num.get(gv, 0) + _parse_num(r.get(num_key))
        groups_denom[gv] = groups_denom.get(gv, 0) + _parse_num(r.get(denom_key))
        counts[gv] = counts.get(gv, 0) + 1
        for i, vk in enumerate(extra_value_keys):
            agg = (extra_value_aggregations[i] if i < len(extra_value_aggregations) else "sum").lower()
            val = 1.0 if agg == "count" else _parse_num(r.get(vk))
            pivots[vk][gv] = pivots[vk].get(gv, 0) + val
    group_vals = sorted(
        {g for g in groups_num} | {g for p in pivots.values() for g in p}
    )
    for i, vk in enumerate(extra_value_keys):
        agg = (extra_value_aggregations[i] if i < len(extra_value_aggregations) else "sum").lower()
        if agg == "avg":
            for gv in pivots[vk]:
                if counts.get(gv, 0) > 0:
                    pivots[vk][gv] = pivots[vk][gv] / counts[gv]
    ind_label = (cfg.indicator_labels.get(ind, ind) if cfg else ind)
    decimals = (cfg.indicator_decimal_places.get((ind or "").strip().lower(), 4) if cfg else 4)
    datasets: list[tuple[str, list[float]]] = []
    vals = []
    for gv in group_vals:
        denom = groups_denom.get(gv, 0)
        num = groups_num.get(gv, 0)
        v = round(num / denom, decimals) if denom else 0.0
        if as_percent:
            v = round(v * 100, 2)
        vals.append(v)
    datasets.append((ind_label, vals))
    for vk in extra_value_keys:
        label = (cfg.value_display_names.get(vk, vk) if cfg else vk)
        data = [round(pivots[vk].get(gv, 0), 2) for gv in group_vals]
        datasets.append((label, data))
    return group_vals, datasets


def _aggregate_indicator_share(
    rows: list[dict[str, Any]],
    group_key: str,
    value_key: str,
    as_percent: bool,
    group_keys: list[str] | None = None,
    indicator: str | None = None,
    cfg: _SchemaConfig | None = None,
) -> list[tuple[str, float]]:
    """佔比型指標：依 group 分組，每組 sum(value)/sum(all)。as_percent 時 ×100"""
    groups_val: dict[str, float] = {}
    total = 0.0
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        v = _parse_num(r.get(value_key))
        groups_val[gv] = groups_val.get(gv, 0) + v
        total += v
    decimals = (cfg.indicator_decimal_places.get((indicator or "").strip().lower(), 4) if cfg else 4)
    result: list[tuple[str, float]] = []
    for gv in groups_val:
        if total <= 0:
            result.append((gv, 0.0))
        else:
            val = groups_val[gv] / total
            if as_percent:
                val = round(val * 100, 2)
            else:
                val = round(val, decimals)
            result.append((gv, val))
    return result


def _aggregate_indicator_ratio_or_share(
    rows: list[dict[str, Any]],
    group_key: str,
    num_key: str,
    denom_key: str,
    as_percent: bool,
    group_keys: list[str] | None = None,
    indicator: str | None = None,
    cfg: _SchemaConfig | None = None,
) -> list[tuple[str, float]]:
    """依 denom_key 分派：__total__ 用 share，否則用 ratio"""
    if denom_key == "__total__":
        return _aggregate_indicator_share(
            rows, group_key, num_key, as_percent, group_keys=group_keys, indicator=indicator, cfg=cfg,
        )
    return _aggregate_indicator_ratio(
        rows, group_key, num_key, denom_key, as_percent, group_keys=group_keys, indicator=indicator, cfg=cfg,
    )


def _aggregate_indicator_ratio(
    rows: list[dict[str, Any]],
    group_key: str,
    num_key: str,
    denom_key: str,
    as_percent: bool,
    group_keys: list[str] | None = None,
    indicator: str | None = None,
    cfg: _SchemaConfig | None = None,
) -> list[tuple[str, float]]:
    """複合指標：依 group 分組，每組 sum(num)/sum(denom)。as_percent 時 ×100"""
    groups_num: dict[str, float] = {}
    groups_denom: dict[str, float] = {}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        groups_num[gv] = groups_num.get(gv, 0) + _parse_num(r.get(num_key))
        groups_denom[gv] = groups_denom.get(gv, 0) + _parse_num(r.get(denom_key))
    decimals = (cfg.indicator_decimal_places.get((indicator or "").strip().lower(), 4) if cfg else 4)
    result: list[tuple[str, float]] = []
    for gv in groups_num:
        denom = groups_denom.get(gv, 0)
        if denom == 0:
            result.append((gv, 0.0))
        else:
            val = groups_num[gv] / denom
            if as_percent:
                val = round(val * 100, 2)
            else:
                val = round(val, decimals)
            result.append((gv, val))
    return result


def _aggregate_multi_value(
    rows: list[dict[str, Any]],
    value_keys: list[str],
    value_aggregations: list[str],
    cfg: _SchemaConfig | None = None,
) -> list[tuple[str, float]]:
    """多欄位分別彙總（無分組）：每欄位可有不同 aggregation，回傳 [(label, value), ...]"""
    result: list[tuple[str, float]] = []
    n = len(rows)
    for i, vk in enumerate(value_keys):
        agg = (value_aggregations[i] if i < len(value_aggregations) else "sum").lower()
        total = sum(_parse_num(r.get(vk)) for r in rows)
        if agg == "avg" and n > 0:
            total = total / n
        elif agg == "count":
            total = float(n)
        label = (cfg.value_display_names.get(vk, vk) if cfg else vk)
        result.append((label, round(total, 2)))
    return result


def _aggregate_multi_value_by_group(
    rows: list[dict[str, Any]],
    group_key: str,
    value_keys: list[str],
    value_aggregations: list[str],
    group_keys: list[str] | None = None,
    cfg: _SchemaConfig | None = None,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """
    多 value 欄位分別彙總，依 group_key 分組。每欄位可有不同 aggregation。
    回傳 (group_vals, [(series_label, [val per group]), ...])
    """
    pivots: dict[str, dict[str, float]] = {vk: {} for vk in value_keys}
    counts: dict[str, int] = {}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        counts[gv] = counts.get(gv, 0) + 1
        for i, vk in enumerate(value_keys):
            agg = (value_aggregations[i] if i < len(value_aggregations) else "sum").lower()
            val = 1.0 if agg == "count" else _parse_num(r.get(vk))
            pivots[vk][gv] = pivots[vk].get(gv, 0) + val
    group_vals = sorted({g for p in pivots.values() for g in p.keys()})
    for i, vk in enumerate(value_keys):
        agg = (value_aggregations[i] if i < len(value_aggregations) else "sum").lower()
        if agg == "avg":
            for gv in pivots[vk]:
                if counts.get(gv, 0) > 0:
                    pivots[vk][gv] = pivots[vk][gv] / counts[gv]
    datasets: list[tuple[str, list[float]]] = []
    for vk in value_keys:
        label = (cfg.value_display_names.get(vk, vk) if cfg else vk)
        data = [round(pivots[vk].get(gv, 0), 2) for gv in group_vals]
        datasets.append((label, data))
    return group_vals, datasets


def _read_group_domain_for_column(schema_def: dict[str, Any] | None, group_col: str) -> list[str] | None:
    """
    維度欄可選 group_domain 或 allowed_values（字串列表），用於固定輸出分組順序並對缺資料組別補 0。
    """
    if not schema_def or not group_col or not str(group_col).strip():
        return None
    cols = schema_def.get("columns")
    if not isinstance(cols, dict):
        return None
    meta = cols.get(group_col)
    if not isinstance(meta, dict):
        return None
    raw = meta.get("group_domain")
    if raw is None:
        raw = meta.get("allowed_values")
    if not isinstance(raw, list) or not raw:
        return None
    out = [str(x).strip() for x in raw if x is not None and str(x).strip()]
    return out or None


def _pairs_reordered_by_domain(
    pairs: list[tuple[str, float]],
    domain: list[str],
) -> list[tuple[str, float]]:
    lut = {str(k): float(v) for k, v in pairs}
    return [(g, lut.get(g, 0.0)) for g in domain]


def _aggregate_single_series(
    rows: list[dict[str, Any]],
    group_key: str,
    value_keys: list[str],
    value_aggregations: list[str],
    group_keys: list[str] | None = None,
) -> list[tuple[str, float]]:
    """單一系列：依 group_key 分組，對 value_keys 彙總（單一數值輸出時多欄位合併）。回傳 [(label, value), ...]"""
    agg = (value_aggregations[0] if value_aggregations else "sum").lower()
    groups: dict[str, float] = {}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        val = 1.0 if agg == "count" else sum(_parse_num(r.get(k)) for k in value_keys)
        groups[gv] = groups.get(gv, 0) + val
    if agg == "avg" and groups:
        counts: dict[str, float] = {}
        for r in rows:
            gv = _get_group_value(r, group_key, group_keys)
            counts[gv] = counts.get(gv, 0) + 1
        for k in groups:
            if counts.get(k, 0) > 0:
                groups[k] = groups[k] / counts[k]
    return list(groups.items())


def _aggregate_multi_series(
    rows: list[dict[str, Any]],
    group_key: str,
    series_key: str,
    value_keys: list[str],
    value_aggregations: list[str],
    group_keys: list[str] | None = None,
    cfg: _SchemaConfig | None = None,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """多系列：每 (group_val, series_val) 每欄位獨立彙總。回傳 (labels, [(series_label, [vals])])"""
    pivots: dict[str, dict[tuple[str, str], float]] = {vk: {} for vk in value_keys}
    counts: dict[tuple[str, str], int] = {}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        sv = str(r.get(series_key, "") or "").strip() or "(空)"
        key = (gv, sv)
        counts[key] = counts.get(key, 0) + 1
        for i, vk in enumerate(value_keys):
            agg = (value_aggregations[i] if i < len(value_aggregations) else "sum").lower()
            val = 1.0 if agg == "count" else _parse_num(r.get(vk))
            pivots[vk][key] = pivots[vk].get(key, 0) + val
    group_vals = sorted({g for p in pivots.values() for g, _ in p.keys()})
    series_vals = sorted({s for p in pivots.values() for _, s in p.keys()})
    for i, vk in enumerate(value_keys):
        agg = (value_aggregations[i] if i < len(value_aggregations) else "sum").lower()
        if agg == "avg":
            for key in pivots[vk]:
                if counts.get(key, 0) > 0:
                    pivots[vk][key] = pivots[vk][key] / counts[key]
    datasets: list[tuple[str, list[float]]] = []
    for vk in value_keys:
        lbl = (cfg.value_display_names.get(vk, vk) if cfg else vk)
        for sv in series_vals:
            data = [round(pivots[vk].get((gv, sv), 0), 2) for gv in group_vals]
            datasets.append((f"{lbl} - {sv}", data))
    return group_vals, datasets


def _aggregate_multi_series_with_metrics(
    rows: list[dict[str, Any]],
    group_key: str,
    series_key: str,
    value_keys: list[str],
    value_aggregations: list[str],
    indicator: str | None,
    display_fields: list[str],
    group_keys: list[str] | None = None,
    cfg: _SchemaConfig | None = None,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """多系列 + 多指標：支援 indicator (ROI 等) 與 display_fields。每欄位可有不同 aggregation。"""
    ind = (indicator or "").strip().lower()
    pivots: dict[str, dict[tuple[str, str], float]] = {}
    for vk in value_keys:
        pivots[vk] = {}
    pivot_ind_num: dict[tuple[str, str], float] = {}
    pivot_ind_denom: dict[tuple[str, str], float] = {}
    counts: dict[tuple[str, str], int] = {}
    num_key = denom_key = None
    if cfg and ind in cfg.indicator_column_names:
        nc, dc = cfg.indicator_column_names[ind]
        num_key = next((k for k in value_keys if k == nc or nc in k), None)
        denom_key = next((k for k in value_keys if k == dc or dc in k), None)
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        sv = str(r.get(series_key, "") or "").strip() or "(空)"
        key = (gv, sv)
        counts[key] = counts.get(key, 0) + 1
        for i, vk in enumerate(value_keys):
            agg = (value_aggregations[i] if i < len(value_aggregations) else "sum").lower()
            val = 1.0 if agg == "count" else _parse_num(r.get(vk))
            pivots[vk][key] = pivots[vk].get(key, 0) + val
        if num_key and denom_key:
            pivot_ind_num[key] = pivot_ind_num.get(key, 0) + _parse_num(r.get(num_key))
            pivot_ind_denom[key] = pivot_ind_denom.get(key, 0) + _parse_num(r.get(denom_key))
    for i, vk in enumerate(value_keys):
        agg = (value_aggregations[i] if i < len(value_aggregations) else "sum").lower()
        if agg == "avg":
            for key in pivots[vk]:
                if counts.get(key, 0) > 0:
                    pivots[vk][key] = pivots[vk][key] / counts[key]
    group_vals = sorted({g for p in pivots.values() for g, _ in p.keys()} | {g for g, _ in pivot_ind_num.keys()})
    series_vals = sorted({s for p in pivots.values() for _, s in p.keys()} | {s for _, s in pivot_ind_num.keys()})
    # datasets = 全部 value_keys + indicator；回傳前依 display_fields 過濾
    metrics_to_show: list[tuple[str, str, str]] = []  # (display_label, type, key)
    for vk in value_keys:
        metrics_to_show.append((cfg.value_display_names.get(vk, vk) if cfg else vk, "value", vk))
    if ind and num_key and denom_key and cfg and ind in cfg.indicator_labels:
        metrics_to_show.append((cfg.indicator_labels[ind], "indicator", ind))
    ind_decimals = (cfg.indicator_decimal_places.get((ind or "").strip().lower(), 4) if cfg else 4)
    datasets_out: list[tuple[str, list[float]]] = []
    for metric_label, mtype, mkey in metrics_to_show:
        for sv in series_vals:
            if mtype == "indicator" and num_key and denom_key:
                vals = []
                for gv in group_vals:
                    denom = pivot_ind_denom.get((gv, sv), 0)
                    vals.append(round(pivot_ind_num.get((gv, sv), 0) / denom, ind_decimals) if denom else 0.0)
                datasets_out.append((f"{metric_label} - {sv}", vals))
            elif mtype == "value":
                vals = [round(pivots.get(mkey, {}).get((gv, sv), 0), 2) for gv in group_vals]
                datasets_out.append((f"{metric_label} - {sv}", vals))
    datasets_out = _filter_datasets_by_display_fields(datasets_out, display_fields, cfg) if cfg else datasets_out
    return group_vals, datasets_out


def _resolve_having_column_to_values(
    column: str,
    group_vals: list[str],
    datasets: list[tuple[str, list[float]]] | None,
    pairs: list[tuple[str, float]] | None,
    value_keys: list[str],
    indicator: str | None,
    is_total: bool = False,
    cfg: _SchemaConfig | None = None,
) -> list[float] | None:
    """將 having_filter 的 column 解析為對應的數值序列，與 group_vals 同序。"""
    col_lower = (column or "").strip().lower()
    if not col_lower:
        return None
    if pairs is not None:
        # 運算式指標：column 等於 indicator 時，回傳 pairs 的數值序列
        if indicator and "/" in indicator and col_lower == indicator.strip().lower():
            return [p[1] for p in pairs]
        if is_total:
            for lbl, v in pairs:
                if col_lower == (lbl or "").strip().lower():
                    return [v]
            if cfg:
                for ind_name, ind_label in cfg.indicator_labels.items():
                    if col_lower == ind_name or col_lower == (ind_label or "").strip().lower():
                        for lbl, v in pairs:
                            if (lbl or "").strip() == ind_label:
                                return [v]
                for label, aliases in cfg.display_field_aliases.items():
                    alist = aliases if isinstance(aliases, list) else [aliases]
                    if col_lower in [str(a).strip().lower() for a in alist]:
                        for lbl, v in pairs:
                            if (lbl or "").strip() == label:
                                return [v]
            for vk in value_keys:
                if col_lower == vk.strip().lower():
                    lbl = (cfg.value_display_names.get(vk, vk) if cfg else vk)
                    for l, v in pairs:
                        if (l or "").strip() == lbl:
                            return [v]
            return None
        return [p[1] for p in pairs]
    if datasets is None:
        return None
    for label, data in datasets:
        lbl = (label or "").strip().lower()
        if col_lower == lbl:
            return data
    for vk in value_keys:
        if col_lower == vk.strip().lower():
            lbl = (cfg.value_display_names.get(vk, vk) if cfg else vk)
            for label, data in datasets:
                if (label or "").strip() == lbl:
                    return data
    if cfg:
        for ind_name, ind_label in cfg.indicator_labels.items():
            if col_lower == ind_name or col_lower == (ind_label or "").strip().lower():
                for label, data in datasets:
                    if (label or "").strip() == ind_label:
                        return data
    if indicator and "/" in indicator:
        ind_lower = indicator.strip().lower()
        if col_lower == ind_lower:
            for label, data in datasets:
                if (label or "").strip().lower() == ind_lower:
                    return data
            for label, data in datasets:
                if indicator in (label or "") or (label or "").replace(" ", "") == indicator.replace(" ", ""):
                    return data
    if cfg:
        for label, aliases in cfg.display_field_aliases.items():
            alist = aliases if isinstance(aliases, list) else [aliases]
            if col_lower in [str(a).strip().lower() for a in alist]:
                for lbl, data in datasets:
                    if (lbl or "").strip() == label:
                        return data
    return None


def _apply_having_filters(
    group_vals: list[str],
    having_filters: list[dict[str, Any]],
    *,
    datasets: list[tuple[str, list[float]]] | None = None,
    pairs: list[tuple[str, float]] | None = None,
    value_keys: list[str] | None = None,
    indicator: str | None = None,
    is_total: bool = False,
    cfg: _SchemaConfig | None = None,
) -> list[int]:
    """依 having_filters 篩選彙總結果，回傳保留的索引。依 column 從 datasets 或 pairs 解析數值。"""
    if not having_filters:
        return list(range(len(group_vals)))
    n = len(group_vals)
    keep = set(range(n))
    for hf in having_filters:
        if not isinstance(hf, dict):
            continue
        col = (hf.get("column") or "").strip()
        op = (hf.get("op") or "==").strip().lower().replace(" ", "") or "=="
        val = hf.get("value")
        if not col:
            continue
        try:
            threshold = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            continue
        col_lower = col.strip().lower()
        if col_lower in ("margin_rate", "discount_rate", "毛利率", "折扣率") and 0 < threshold < 1:
            threshold = threshold * 100
        vals = _resolve_having_column_to_values(col, group_vals, datasets, pairs, value_keys or [], indicator, is_total, cfg)
        if vals is None or len(vals) != n:
            continue
        still_keep: set[int] = set()
        for i in keep:
            v = vals[i] if i < len(vals) else 0.0
            if op == ">" and v > threshold:
                still_keep.add(i)
            elif op == "<" and v < threshold:
                still_keep.add(i)
            elif op == ">=" and v >= threshold:
                still_keep.add(i)
            elif op == "<=" and v <= threshold:
                still_keep.add(i)
            elif op == "==" and abs(v - threshold) <= 1e-9:
                still_keep.add(i)
            elif op == "!=" and abs(v - threshold) > 1e-9:
                still_keep.add(i)
        keep = still_keep
    return sorted(keep)


def _normalize_sort_order(sort_order: Any) -> list[dict[str, str]]:
    """將 sort_order 正規化為 [{ column, order }, ...]。支援舊格式 "desc"/"asc"。"""
    if isinstance(sort_order, list) and sort_order:
        out: list[dict[str, str]] = []
        for item in sort_order:
            if not isinstance(item, dict):
                continue
            col = (item.get("column") or "_first_").strip()
            ord_val = (item.get("order") or "desc").strip().lower()
            ord_val = "desc" if ord_val == "desc" else "asc"
            out.append({"column": col or "_first_", "order": ord_val})
        return out if out else [{"column": "_first_", "order": "desc"}]
    s = str(sort_order or "desc").strip().lower()
    return [{"column": "_first_", "order": "desc" if s == "desc" else "asc"}]


def _resolve_sort_values(
    spec: dict[str, str],
    pairs: list[tuple[str, float]],
    datasets: list[tuple[str, list[float]]] | None,
    cfg: _SchemaConfig | None = None,
) -> tuple[bool, Any]:
    """解析排序依據。回傳 (by_group_label, key_values)。"""
    col = (spec.get("column") or "_first_").strip().lower()
    if col in ("_group_", "_label_"):
        return (True, None)
    if not datasets or col == "_first_":
        return (False, [p[1] for p in pairs])
    col_raw = (spec.get("column") or "").strip()
    for lbl, values in datasets:
        if lbl.strip() == col_raw or (col_raw and col_raw.lower() in str(lbl).lower()):
            if len(values) == len(pairs):
                return (False, values)
            return (False, [p[1] for p in pairs])
    if cfg:
        for label, aliases in cfg.display_field_aliases.items():
            if not isinstance(aliases, list):
                continue
            if col_raw.lower() in [str(a).strip().lower() for a in aliases]:
                for lbl, values in datasets:
                    if (lbl or "").strip() == label or label in (lbl or ""):
                        if len(values) == len(pairs):
                            return (False, values)
                        return (False, [p[1] for p in pairs])
                break
    return (False, [p[1] for p in pairs])


def _apply_sort_top_n(
    pairs: list[tuple[str, float]],
    sort_order: str | list[dict[str, str]],
    top_n: int | None,
    time_order: bool,
    datasets: list[tuple[str, list[float]]] | None = None,
    cfg: _SchemaConfig | None = None,
) -> list[tuple[str, float]]:
    """排序並截斷 top_n。sort_order 可為 "desc"|"asc" 或 [{ column, order }, ...]。"""
    specs = _normalize_sort_order(sort_order)
    if time_order:
        pairs = sorted(pairs, key=lambda p: _time_sort_key(p[0]))
    elif specs:
        by_group, key_vals = _resolve_sort_values(specs[0], pairs, datasets, cfg)
        if by_group:
            pairs = sorted(pairs, key=lambda p: _time_sort_key(p[0]))
        else:
            def _sort_key(idx: int) -> tuple:
                row: list[Any] = []
                for spec in specs:
                    by_g, kv = _resolve_sort_values(spec, pairs, datasets, cfg)
                    rev = (spec.get("order", "desc") or "desc").strip().lower() == "desc"
                    if by_g:
                        row.append(_time_sort_key(pairs[idx][0]))
                    else:
                        v = float(kv[idx]) if kv and idx < len(kv) else (pairs[idx][1] if idx < len(pairs) else 0.0)
                        row.append(-v if rev else v)
                return tuple(row)

            order_idx = sorted(range(len(pairs)), key=lambda i: _sort_key(i))
            pairs = [pairs[i] for i in order_idx]
    if top_n is not None and top_n > 0:
        pairs = pairs[:top_n]
    return pairs


def _to_pie_percent(pairs: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """將數值轉為百分比（總和為 100）"""
    total = sum(p[1] for p in pairs)
    if total <= 0:
        return pairs
    return [(lbl, round(100 * v / total, 2)) for lbl, v in pairs]


def _run_compare_periods_flow(
    work_rows: list[dict[str, Any]],
    group_by_column: str | list[str],
    resolved: _ResolvedColumns,
    filters: list[dict[str, Any]] | None,
    compare_periods: dict[str, Any],
    value_col_for_yoy: str,
    top_n: int | None,
    sort_order: str | list[dict[str, str]],
    display_fields: list[str] | None,
    having_filters: list[dict[str, Any]] | None,
    g_aliases: dict[str, list[str]],
    error_out: list[str] | None,
    cfg: _SchemaConfig,
    schema_def: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """
    比較期間流程：分別彙總 current / compare 兩期間，join 後計算 YoY。
    value_col_for_yoy：用於 YoY 計算的 value key（如 sales_amount）。
    """
    date_col_raw = (compare_periods.get("date_col") or "").strip()
    cur_val = compare_periods.get("current_val")
    cmp_val = compare_periods.get("compare_val")
    actual_keys = [k for k in work_rows[0].keys() if k and k.strip()]
    date_col = (
        next((ak for ak in actual_keys if ak.strip().lower() == date_col_raw.strip().lower()), None)
        or _find_matching_column(actual_keys, date_col_raw, g_aliases)
    )
    if not date_col:
        if error_out is not None:
            error_out.append(f"compare_periods 的 date 欄位找不到: {date_col_raw!r}")
        return None

    # 1. 套用 filters（排除 compare_periods 的 date column）
    base = work_rows
    if filters:
        merged: dict[tuple[str, str], list[Any]] = {}
        for f in filters:
            if not isinstance(f, dict):
                continue
            col = f.get("column")
            val = f.get("value")
            op = (f.get("op") or "==").strip().lower().replace(" ", "") or "=="
            if col is None or val is None:
                continue
            col_str = str(col).strip()
            if col_str and date_col and col_str.strip().lower() == date_col.strip().lower():
                continue
            key = (col_str, op)
            if key not in merged:
                merged[key] = []
            if isinstance(val, list):
                merged[key].extend(v for v in val if v is not None)
            else:
                merged[key].append(val)
        for (col_str, op_str), vals in merged.items():
            if not vals:
                continue
            key = next((ak for ak in actual_keys if ak.strip().lower() == col_str.strip().lower()), None) or _find_matching_column(actual_keys, col_str, g_aliases)
            if key:
                v = vals[0] if len(vals) == 1 else vals
                base = _apply_filter(
                    base, key, v, op=op_str, is_date_column=_is_date_column(col_str, schema_def)
                )
                if not base:
                    if error_out is not None:
                        error_out.append(f"filters 篩選後無資料: column={col_str!r}")
                    return None

    # 2. 依期間切分
    current_rows = _apply_filter(base, date_col, cur_val, op="==", is_date_column=True)
    compare_rows = _apply_filter(base, date_col, cmp_val, op="==", is_date_column=True)
    if not current_rows and not compare_rows:
        if error_out is not None:
            error_out.append("compare_periods 兩期間皆無資料")
        return None

    gk = resolved.group_keys
    group_key = resolved.group_key
    value_keys = resolved.value_keys
    value_aggs = resolved.value_aggregations

    # 3. 兩次彙總（只取 value_col_for_yoy 對應的 value_key）
    vk_idx = next(
        (i for i, k in enumerate(value_keys) if k.strip().lower() == value_col_for_yoy.strip().lower()),
        None,
    )
    if vk_idx is None:
        if error_out is not None:
            error_out.append(
                f"compare_periods 數值欄位無法對應: {value_col_for_yoy!r} 不在 value_keys={value_keys!r}"
            )
        return None
    vk = value_keys[vk_idx]
    agg = (value_aggs[vk_idx] if vk_idx < len(value_aggs) else "sum").lower()

    def _agg_by_group(rows: list[dict[str, Any]]) -> dict[str, float]:
        out: dict[str, float] = {}
        for r in rows:
            gv = _get_group_value(r, group_key, gk)
            v = _parse_num(r.get(vk))
            out[gv] = out.get(gv, 0) + v
        return out

    cur_map = _agg_by_group(current_rows)
    cmp_map = _agg_by_group(compare_rows)

    # 4. Full outer join + YoY
    all_groups = sorted(set(cur_map.keys()) | set(cmp_map.keys()))
    cur_data = [cur_map.get(g, 0.0) for g in all_groups]
    cmp_data = [cmp_map.get(g, 0.0) for g in all_groups]
    yoy_data: list[float] = []
    for i, g in enumerate(all_groups):
        c = cur_data[i]
        p = cmp_data[i]
        if p == 0:
            yoy_data.append(0.0 if c == 0 else 100.0)
        else:
            yoy_data.append(round(100 * (c - p) / p, 2))

    # 5. 組 datasets
    v_label = cfg.value_display_names.get(vk, vk)
    datasets: list[tuple[str, list[float]]] = [
        (v_label, [round(x, 2) for x in cur_data]),
        (f"去年同期{v_label}", [round(x, 2) for x in cmp_data]),
        ("YoY成長率", yoy_data),
    ]
    datasets = _filter_datasets_by_display_fields(datasets, display_fields, cfg)
    if not datasets:
        if error_out is not None:
            error_out.append("display_fields 無法對應任何輸出序列，請檢查別名或 display_fields")
        return None

    # 6. having_filters
    if having_filters:
        keep_idx = _apply_having_filters(
            all_groups, having_filters,
            datasets=datasets, value_keys=[],
            indicator=None, cfg=cfg,
        )
        if keep_idx:
            all_groups = [all_groups[i] for i in keep_idx]
            datasets = [(lbl, [d[i] for i in keep_idx]) for lbl, d in datasets]
        else:
            all_groups, datasets = [], []

    # 7. sort + top_n
    sort_vals = datasets[0][1] if datasets else cur_data[: len(all_groups)]
    pairs_for_sort = [(all_groups[i], sort_vals[i] if i < len(sort_vals) else 0.0) for i in range(len(all_groups))]
    pairs_sorted = _apply_sort_top_n(pairs_for_sort, sort_order, top_n, False, datasets=datasets, cfg=cfg)
    new_groups = [p[0] for p in pairs_sorted]
    g_to_i = {g: i for i, g in enumerate(all_groups)}
    datasets = [(lbl, [d[g_to_i[g]] for g in new_groups if g in g_to_i]) for lbl, d in datasets]
    out: dict[str, Any] = {
        "labels": new_groups,
        "datasets": [_dataset_item(lbl, d, cfg) for lbl, d in datasets],
    }
    return out


def _run_compare_periods_ratio_flow(
    work_rows: list[dict[str, Any]],
    group_by_column: str | list[str],
    resolved: _ResolvedColumns,
    filters: list[dict[str, Any]] | None,
    compare_periods: dict[str, Any],
    indicator: str,
    top_n: int | None,
    sort_order: str | list[dict[str, str]],
    display_fields: list[str] | None,
    having_filters: list[dict[str, Any]] | None,
    g_aliases: dict[str, list[str]],
    error_out: list[str] | None,
    cfg: _SchemaConfig,
    schema_def: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """
    compare_periods + ratio 指標：分別彙總 current / compare 兩期間的指標，輸出本期與前期。
    """
    date_col_raw = (compare_periods.get("date_col") or "").strip()
    cur_val = compare_periods.get("current_val")
    cmp_val = compare_periods.get("compare_val")
    actual_keys = [k for k in work_rows[0].keys() if k and k.strip()]
    date_col = (
        next((ak for ak in actual_keys if ak.strip().lower() == date_col_raw.strip().lower()), None)
        or _find_matching_column(actual_keys, date_col_raw, g_aliases)
    )
    if not date_col:
        if error_out is not None:
            error_out.append(f"compare_periods 的 date 欄位找不到: {date_col_raw!r}")
        return None

    keys_result = _get_indicator_keys(indicator, resolved.value_keys, cfg)
    if not keys_result:
        if error_out is not None:
            error_out.append(f"ratio 指標無法解析: indicator={indicator!r} value_keys={resolved.value_keys!r}")
        return None
    num_key, denom_key, as_pct = keys_result

    # 1. 套用 filters（排除 compare_periods 的 date column）
    base = work_rows
    if filters:
        merged: dict[tuple[str, str], list[Any]] = {}
        for f in filters:
            if not isinstance(f, dict):
                continue
            col = f.get("column")
            val = f.get("value")
            op = (f.get("op") or "==").strip().lower().replace(" ", "") or "=="
            if col is None or val is None:
                continue
            col_str = str(col).strip()
            if col_str and date_col and col_str.strip().lower() == date_col.strip().lower():
                continue
            key = (col_str, op)
            if key not in merged:
                merged[key] = []
            if isinstance(val, list):
                merged[key].extend(v for v in val if v is not None)
            else:
                merged[key].append(val)
        for (col_str, op_str), vals in merged.items():
            if not vals:
                continue
            key = next((ak for ak in actual_keys if ak.strip().lower() == col_str.strip().lower()), None) or _find_matching_column(actual_keys, col_str, g_aliases)
            if key:
                v = vals[0] if len(vals) == 1 else vals
                base = _apply_filter(
                    base, key, v, op=op_str, is_date_column=_is_date_column(col_str, schema_def)
                )
                if not base:
                    if error_out is not None:
                        error_out.append(f"filters 篩選後無資料: column={col_str!r}")
                    return None

    # 2. 依期間切分
    current_rows = _apply_filter(base, date_col, cur_val, op="==", is_date_column=True)
    compare_rows = _apply_filter(base, date_col, cmp_val, op="==", is_date_column=True)
    if not current_rows and not compare_rows:
        if error_out is not None:
            error_out.append("compare_periods 兩期間皆無資料")
        return None

    gk = resolved.group_keys
    group_key = resolved.group_key

    # 3. 兩期間分別計算 ratio（含佔比型 denom_key==__total__）
    cur_pairs = _aggregate_indicator_ratio_or_share(
        current_rows, group_key, num_key, denom_key, as_pct,
        group_keys=gk, indicator=indicator, cfg=cfg,
    )
    cmp_pairs = _aggregate_indicator_ratio_or_share(
        compare_rows, group_key, num_key, denom_key, as_pct,
        group_keys=gk, indicator=indicator, cfg=cfg,
    )
    cur_map = {gv: v for gv, v in cur_pairs}
    cmp_map = {gv: v for gv, v in cmp_pairs}

    # 4. Full outer join + 成長率
    all_groups = sorted(set(cur_map.keys()) | set(cmp_map.keys()))
    cur_data = [cur_map.get(g, 0.0) for g in all_groups]
    cmp_data = [cmp_map.get(g, 0.0) for g in all_groups]
    growth_data: list[float] = []
    for i, g in enumerate(all_groups):
        c, p = cur_data[i], cmp_data[i]
        if p == 0:
            growth_data.append(100.0 if c != 0 else 0.0)
        else:
            growth_data.append(round(100 * (c - p) / p, 2))

    ind_label = cfg.indicator_labels.get(indicator, indicator)
    prev_label = f"前期{ind_label}"
    growth_label = f"{ind_label}成長率"
    datasets: list[tuple[str, list[float]]] = [
        (ind_label, cur_data),
        (prev_label, cmp_data),
        (growth_label, growth_data),
    ]
    datasets = _filter_datasets_by_display_fields(datasets, display_fields, cfg)
    if not datasets:
        if error_out is not None:
            error_out.append("display_fields 無法對應任何輸出序列，請檢查別名或 display_fields")
        return None

    # 5. having_filters
    if having_filters:
        keep_idx = _apply_having_filters(
            all_groups, having_filters,
            datasets=datasets, value_keys=[],
            indicator=indicator, cfg=cfg,
        )
        if keep_idx:
            all_groups = [all_groups[i] for i in keep_idx]
            datasets = [(lbl, [d[i] for i in keep_idx]) for lbl, d in datasets]
        else:
            all_groups, datasets = [], []

    # 6. sort + top_n
    sort_vals = datasets[0][1] if datasets else cur_data[: len(all_groups)]
    pairs_for_sort = [(all_groups[i], sort_vals[i] if i < len(sort_vals) else 0.0) for i in range(len(all_groups))]
    pairs_sorted = _apply_sort_top_n(pairs_for_sort, sort_order, top_n, False, datasets=datasets, cfg=cfg)
    new_groups = [p[0] for p in pairs_sorted]
    g_to_i = {g: i for i, g in enumerate(all_groups)}
    datasets = [(lbl, [d[g_to_i[g]] for g in new_groups if g in g_to_i]) for lbl, d in datasets]

    labels, group_details = _to_labels_and_details_for_ratio(new_groups, gk)
    out: dict[str, Any] = {
        "labels": labels,
        "datasets": [_dataset_item(lbl, d, cfg) for lbl, d in datasets],
    }
    if group_details is not None:
        out["groupDetails"] = group_details
    return out


def _to_labels_and_details_for_ratio(
    group_vals: list[str],
    group_keys: list[str] | None,
) -> tuple[list[Any], list[dict[str, Any]] | None]:
    """單層時 labels 即 group_vals，group_details 為 None；多層時需 hierarchy。"""
    if not group_keys or len(group_keys) <= 1:
        return group_vals, None
    details: list[dict[str, Any]] = []
    for gv in group_vals:
        if _HIERARCHY_SEP in str(gv):
            parts = gv.split(_HIERARCHY_SEP)
            d = {k: (parts[i] if i < len(parts) else "") for i, k in enumerate(group_keys)}
        else:
            d = {group_keys[-1]: gv}
        details.append(d)
    labels = [d.get(group_keys[-1], gv) for d, gv in zip(details, group_vals)]
    return labels, details


def compute_aggregate(
    rows: list[dict[str, Any]],
    group_by_column: str | list[str],
    value_columns: list[dict[str, Any]],
    *,
    series_by_column: str | None = None,
    filters: list[dict[str, Any]] | None = None,
    top_n: int | None = None,
    sort_order: str | list[dict[str, str]] = "desc",
    time_order: bool = False,
    indicator: list[str] | None = None,
    display_fields: list[str] | None = None,
    having_filters: list[dict[str, Any]] | None = None,
    time_grain: str | None = None,
    schema_def: dict[str, Any] | None = None,
    compare_periods: dict[str, Any] | None = None,
    error_out: list[str] | None = None,
) -> dict[str, Any] | None:
    """
    主入口：依 intent 參數對 rows 做彙總，回傳 chart 資料。
    schema_def 必填：從 YAML 載入的 schema，內含 columns、indicators，供推導 aliases 與指標。
    value_columns 為 [{ column, aggregation }, ...]，每欄位必帶 aggregation (sum|avg|count)。
    """
    if not rows:
        if error_out is not None:
            error_out.append("rows 為空")
        return None
    if not schema_def or not isinstance(schema_def, dict):
        if error_out is not None:
            error_out.append("schema_def 必填，請從 load_schema_from_db()（bi_schemas）載入")
        return None
    cfg = _derive_schema_config(schema_def)
    g_aliases = cfg.group_aliases
    v_aliases = cfg.value_aliases
    # 正規化 group_by_column 為 list（支援舊格式 str，intent 新格式為 array）
    if isinstance(group_by_column, str):
        gb_list_norm = [group_by_column.strip()] if group_by_column and group_by_column.strip() else []
    elif isinstance(group_by_column, list):
        gb_list_norm = [str(x).strip() for x in group_by_column if x]
    else:
        gb_list_norm = []
    # 無分組時：單一總計
    _SYNTHETIC_GROUP = "__total__"
    if not gb_list_norm:
        group_by_column = _SYNTHETIC_GROUP
        ind_key = _indicator_str(indicator)
        # 僅當第一個 indicator 為已定義指標時用其顯示名；否則用「總計」（避免 col_n 變成假分組標籤）
        synth_label = cfg.indicator_labels.get(ind_key) or "總計"
        work_rows = [{**r, _SYNTHETIC_GROUP: synth_label} for r in rows]
    else:
        group_by_column = gb_list_norm
        work_rows = rows
        # time_grain：當 group_by 為單一日期欄位時，依月/季/年彙總
        gb_single = (
            group_by_column if isinstance(group_by_column, str) else
            (group_by_column[0] if isinstance(group_by_column, list) and len(group_by_column) == 1 else None)
        )
        grain = (time_grain or "").strip().lower()
        if gb_single and grain in ("day", "week", "month", "quarter", "year") and _is_date_column(
            gb_single, schema_def
        ):
            actual_keys = [k for k in work_rows[0].keys() if k and k.strip()]
            date_col = (
                next((ak for ak in actual_keys if ak.strip() == gb_single.strip()), None)
                or _find_matching_column(actual_keys, gb_single, g_aliases)
            )
            if date_col:
                work_rows = [
                    {**r, _TIME_GRAIN_BUCKET_COL: _date_to_grain(r.get(date_col), grain)}
                    for r in work_rows
                ]
                group_by_column = _TIME_GRAIN_BUCKET_COL
    resolved = _resolve_columns(
        work_rows, group_by_column, value_columns, None, series_by_column,
        group_aliases=g_aliases, value_aliases=v_aliases,
        error_out=error_out,
    )
    if not resolved:
        if error_out is not None and not error_out:
            error_out.append(f"_resolve_columns 失敗: group_by={group_by_column!r} value_columns={value_columns!r}")
        return None

    # 比較期間流程：需有可彙總的維度（真實分組或合成 __total__ 單一桶）
    compare_periods_has_group = bool(gb_list_norm) or resolved.group_key == _SYNTHETIC_GROUP

    # 比較期間流程
    cp = _parse_compare_periods(compare_periods)
    is_compare, value_col_yoy = _is_compare_indicator(indicator, cfg)
    ind_str = _indicator_str(indicator)
    is_ratio_indicator = (
        (ind_str in cfg.indicator_column_names and ind_str not in cfg.compare_indicator_value_col)
        or (ind_str.endswith("_ratio") and len(ind_str) > 5 and _resolve_dynamic_ratio_column(ind_str[:-5], cfg))
    )

    # 優先用 ratio flow：arpu_yoy_growth 等 ratio 型 YoY 必須走此流程
    if cp and is_ratio_indicator and compare_periods_has_group and _get_indicator_keys(ind_str, resolved.value_keys, cfg):
        return _run_compare_periods_ratio_flow(
            work_rows,
            group_by_column,
            resolved,
            filters,
            cp,
            ind_str,
            top_n,
            sort_order,
            display_fields,
            having_filters,
            g_aliases,
            error_out,
            cfg,
            schema_def,
        )
    if cp and is_compare and value_col_yoy and compare_periods_has_group:
        return _run_compare_periods_flow(
            work_rows,
            group_by_column,
            resolved,
            filters,
            cp,
            value_col_yoy,
            top_n,
            sort_order,
            display_fields,
            having_filters,
            g_aliases,
            error_out,
            cfg,
            schema_def,
        )

    # Intent v2 兩期比較：常見情況是 dimensions.compare_periods + 單一 aggregate 的 as_name，
    # 但 indicator 列表僅有「本期」別名，未含 *_yoy_growth／schema 的 compare 對照鍵。
    # 原邏輯在此會落入單期彙總，chart 結構易與後續「格式化給 LLM」步驟不一致 → detail 列為空。
    # 略過 is_ratio_indicator（應由上列 ratio flow 處理；未滿足鍵時不強制改走簡單兩期以免誤算比率）。
    if (
        cp
        and compare_periods_has_group
        and resolved.value_keys
        and not is_ratio_indicator
    ):
        return _run_compare_periods_flow(
            work_rows,
            group_by_column,
            resolved,
            filters,
            cp,
            resolved.value_keys[0],
            top_n,
            sort_order,
            display_fields,
            having_filters,
            g_aliases,
            error_out,
            cfg,
            schema_def,
        )

    work = work_rows
    actual_keys = [k for k in work_rows[0].keys() if k and k.strip()]
    # 依 (column, op) 合併：op=="==" 時同欄位 OR（IN）；op=="!=" 時 NOT IN
    merged: dict[tuple[str, str], list[Any]] = {}
    for f in (filters or []):
        col = f.get("column") if isinstance(f, dict) else None
        val = f.get("value") if isinstance(f, dict) else None
        op = (f.get("op") or "==") if isinstance(f, dict) else "=="
        if col is None or val is None:
            continue
        col_str = str(col).strip()
        op_str = str(op).strip().lower().replace(" ", "") or "=="
        key = (col_str, op_str)
        if key not in merged:
            merged[key] = []
        if isinstance(val, list):
            merged[key].extend(v for v in val if v is not None)
        else:
            merged[key].append(val)
    # 若 filter 含衍生指標（roi, margin_rate 等），先計算並寫入 rows
    indicator_filter_cols = {
        c.strip().lower() for (c, _) in merged
        if c and c.strip().lower() in cfg.indicator_column_names
    }
    if indicator_filter_cols:
        _compute_derived_indicator_rows(work, indicator_filter_cols, actual_keys, cfg)
        actual_keys = [k for k in work[0].keys() if k and k.strip()]
    for (col_str, op_str), vals in merged.items():
        if not vals:
            continue
        key = (
            next((ak for ak in actual_keys if ak.strip().lower() == col_str.strip().lower()), None)
            or _find_matching_column(actual_keys, col_str, g_aliases or {})
        )
        if key:
            val = vals[0] if len(vals) == 1 else vals
            work = _apply_filter(
                work, key, val, op=op_str, is_date_column=_is_date_column(col_str, schema_def)
            )
            if not work:
                msg = f"filters 篩選後無資料: column={col_str!r} op={op_str!r} value={val!r}"
                logger.warning("%s", msg)
                if error_out is not None:
                    error_out.append(msg)
                return None
    gk = resolved.group_keys if len(resolved.group_keys) > 1 else None
    # 多層 group 時建立 hierarchy：composite_key -> {k: v for k in group_keys}
    hierarchy: dict[str, dict[str, Any]] = {}
    if gk:
        for r in work:
            gv = _get_group_value(r, resolved.group_key, gk)
            if gv not in hierarchy:
                hierarchy[gv] = {k: r.get(k) for k in gk}

    def _to_labels_and_details(group_vals: list[str]) -> tuple[list[Any], list[dict[str, Any]] | None]:
        """多層時：labels 用 leaf，並回傳 group_details；單層時 labels 即 group_vals，group_details 為 None"""
        if not gk:
            return group_vals, None
        details: list[dict[str, Any]] = []
        for gv in group_vals:
            d = hierarchy.get(gv)
            if d is None and _HIERARCHY_SEP in gv:
                parts = gv.split(_HIERARCHY_SEP)
                d = {k: (parts[i] if i < len(parts) else "") for i, k in enumerate(gk)}
            if d is None:
                d = {gk[-1]: gv}
            details.append(d)
        labels = [d.get(gk[-1], gv) for d, gv in zip(details, group_vals)]
        return labels, details

    if resolved.series_key:
        ind_check = _indicator_str(indicator)
        nc, dc = cfg.indicator_column_names.get(ind_check, ("", ""))
        has_indicator_cols = (
            ind_check in cfg.indicator_column_names
            and any(k == nc or nc in k for k in resolved.value_keys)
            and any(k == dc or dc in k for k in resolved.value_keys)
        )
        if has_indicator_cols:
            group_vals, datasets = _aggregate_multi_series_with_metrics(
                work, resolved.group_key, resolved.series_key, resolved.value_keys,
                resolved.value_aggregations, ind_check, display_fields, group_keys=gk, cfg=cfg,
            )
        else:
            group_vals, datasets = _aggregate_multi_series(
                work, resolved.group_key, resolved.series_key, resolved.value_keys,
                resolved.value_aggregations, group_keys=gk, cfg=cfg,
            )
            datasets = _filter_datasets_by_display_fields(datasets, display_fields, cfg)
        if time_order:
            group_vals = sorted(group_vals, key=_time_sort_key)
        if having_filters:
            keep_idx = _apply_having_filters(
                group_vals, having_filters,
                datasets=datasets, value_keys=resolved.value_keys, indicator=ind_check, cfg=cfg,
            )
            if keep_idx:
                group_vals = [group_vals[i] for i in keep_idx]
                datasets = [(lbl, [data[i] for i in keep_idx]) for lbl, data in datasets]
            else:
                group_vals, datasets = [], []
        labels, group_details = _to_labels_and_details(group_vals)
        out: dict[str, Any] = {
            "labels": labels,
            "datasets": [_dataset_item(lbl, data, cfg) for lbl, data in datasets],
        }
        if group_details is not None:
            out["groupDetails"] = group_details
        return out

    def _normalize_indicator(indic: list[str] | None) -> list[str]:
        label_to_code = {str(v).strip().lower(): k for k, v in cfg.indicator_labels.items() if v}
        def _to_code(ind_s: str) -> str | None:
            s = str(ind_s).strip().lower()
            if not s:
                return None
            for k in cfg.indicator_column_names:
                if str(k).lower() == s:
                    return k
            for k in cfg.indicator_labels:
                if str(k).lower() == s:
                    return k
            if s in label_to_code:
                return label_to_code[s]
            if "/" in s and len(s.split("/")) == 2:
                return s
            if s.endswith("_ratio") and len(s) > 5 and _resolve_dynamic_ratio_column(s[:-5], cfg):
                return s
            return None
        if isinstance(indic, list):
            return [c for x in indic if x and (c := _to_code(str(x).strip()))]
        return []

    ind_list = _normalize_indicator(indicator)
    ind = ind_list[0] if len(ind_list) == 1 else ""

    # 統一：indicator(s) + 有 group → 全 value 彙總 + 各 indicator，再依 display_fields 過濾
    if len(ind_list) >= 1 and resolved.group_key != "__total__" and len(resolved.value_keys) >= 1:
        all_group_vals: set[str] = set()
        indicator_results: list[tuple[str, dict[str, float]]] = []
        for ind_name in ind_list:
            keys = _get_indicator_keys(ind_name, resolved.value_keys, cfg)
            if not keys:
                continue
            nk, dk, ap = keys
            pairs = _aggregate_indicator_ratio_or_share(
                work, resolved.group_key, nk, dk, ap, group_keys=gk, indicator=ind_name, cfg=cfg,
            )
            gv_to_val = {gv: v for gv, v in pairs}
            all_group_vals.update(gv_to_val.keys())
            label = cfg.indicator_labels.get(ind_name, ind_name)
            indicator_results.append((label, gv_to_val))
        if not indicator_results:
            pass
        else:
            # datasets = value_columns 全彙總 + indicators；顯示時依 display_fields 過濾
            label_to_gv_val: dict[str, dict[str, float]] = {lbl: gv2v for lbl, gv2v in indicator_results}
            v_grp, v_ds = _aggregate_multi_value_by_group(
                work, resolved.group_key, resolved.value_keys, resolved.value_aggregations, group_keys=gk, cfg=cfg,
            )
            all_group_vals.update(v_grp)
            for lbl, data in v_ds:
                label_to_gv_val[lbl] = {gv: data[i] for i, gv in enumerate(v_grp)}
            group_vals = sorted(all_group_vals)
            datasets = [(lbl, [gv2v.get(gv, 0.0) for gv in group_vals]) for lbl, gv2v in label_to_gv_val.items()]
            datasets = _filter_datasets_by_display_fields(datasets, display_fields, cfg)
            if having_filters:
                keep_idx = _apply_having_filters(
                    group_vals, having_filters,
                    datasets=datasets, value_keys=resolved.value_keys, indicator=ind_list[0], cfg=cfg,
                )
                if keep_idx:
                    group_vals = [group_vals[i] for i in keep_idx]
                    datasets = [(lbl, [data[i] for i in keep_idx]) for lbl, data in datasets]
                else:
                    group_vals, datasets = [], []
            order_pairs = (
                [(group_vals[i], datasets[0][1][i]) for i in range(len(group_vals))]
                if group_vals and datasets
                else []
            )
            order_pairs = _apply_sort_top_n(order_pairs, sort_order, top_n, time_order, datasets=datasets)
            new_group_vals = [p[0] for p in order_pairs]
            gv_to_idx = {gv: i for i, gv in enumerate(group_vals)}
            new_datasets = [
                (lbl, [data[gv_to_idx[gv]] for gv in new_group_vals])
                for lbl, data in datasets
            ]
            labels, group_details = _to_labels_and_details(new_group_vals)
            out_multi: dict[str, Any] = {
                "labels": labels,
                "datasets": [_dataset_item(lbl, d, cfg) for lbl, d in new_datasets],
            }
            if group_details is not None:
                out_multi["groupDetails"] = group_details
            return out_multi

    # 多 indicator + __total__：raw_pairs + 各 indicator（labels = 指標名）
    if len(ind_list) > 1 and resolved.group_key == "__total__" and len(resolved.value_keys) >= 2:
        raw_pairs = _aggregate_multi_value(work, resolved.value_keys, resolved.value_aggregations, cfg)
        for ind_name in ind_list:
            keys = _get_indicator_keys(ind_name, resolved.value_keys, cfg)
            if keys:
                nk, dk, ap = keys
                ipairs = _aggregate_indicator_ratio_or_share(
                    work, resolved.group_key, nk, dk, ap, group_keys=gk, indicator=ind_name, cfg=cfg,
                )
                lbl = cfg.indicator_labels.get(ind_name, ind_name)
                raw_pairs.append((lbl, ipairs[0][1] if ipairs else 0.0))
        pairs = raw_pairs
    else:
        keys_result = _get_indicator_keys(ind, resolved.value_keys, cfg) if ind else None
        if len(resolved.value_keys) >= 1 and ind and keys_result:
            num_key, denom_key, as_pct = keys_result
            ind_pairs = _aggregate_indicator_ratio_or_share(
                work, resolved.group_key, num_key, denom_key, as_pct, group_keys=gk, indicator=ind, cfg=cfg,
            )
            if resolved.group_key == "__total__":
                raw_pairs = _aggregate_multi_value(work, resolved.value_keys, resolved.value_aggregations, cfg)
                ind_label = cfg.indicator_labels.get(ind, ind)
                ind_val = ind_pairs[0][1] if ind_pairs else 0.0
                pairs = raw_pairs + [(ind_label, ind_val)]
            else:
                pairs = ind_pairs
        elif len(resolved.value_keys) > 1 and not ind and resolved.group_key == "__total__":
            pairs = _aggregate_multi_value(work, resolved.value_keys, resolved.value_aggregations, cfg)
        elif len(resolved.value_keys) > 1 and not ind:
            # 多 value 欄位 + 有 group：每欄位獨立彙總，回傳 datasets
            group_vals, datasets = _aggregate_multi_value_by_group(
                work, resolved.group_key, resolved.value_keys, resolved.value_aggregations, group_keys=gk, cfg=cfg,
            )
            datasets = _filter_datasets_by_display_fields(datasets, display_fields, cfg)
            if having_filters:
                keep_idx = _apply_having_filters(
                    group_vals, having_filters,
                    datasets=datasets, value_keys=resolved.value_keys, indicator=None, cfg=cfg,
                )
                if keep_idx:
                    group_vals = [group_vals[i] for i in keep_idx]
                    datasets = [(lbl, [data[i] for i in keep_idx]) for lbl, data in datasets]
                else:
                    group_vals, datasets = [], []
            # sort / top_n 可依指定 column 排序，未指定則依第一組 data
            order_pairs = (
                [(group_vals[i], datasets[0][1][i]) for i in range(len(group_vals))]
                if group_vals and datasets
                else []
            )
            order_pairs = _apply_sort_top_n(order_pairs, sort_order, top_n, time_order, datasets=datasets, cfg=cfg)
            new_group_vals = [p[0] for p in order_pairs]
            gv_to_idx = {gv: i for i, gv in enumerate(group_vals)}
            new_datasets = [
                (lbl, [data[gv_to_idx[gv]] for gv in new_group_vals])
                for lbl, data in datasets
            ]
            labels, group_details = _to_labels_and_details(new_group_vals)
            ret2: dict[str, Any] = {
                "labels": labels,
                "datasets": [_dataset_item(lbl, d, cfg) for lbl, d in new_datasets],
            }
            if group_details is not None:
                ret2["groupDetails"] = group_details
            return ret2
        else:
            pairs = _aggregate_single_series(work, resolved.group_key, resolved.value_keys, resolved.value_aggregations, group_keys=gk)
    if having_filters and pairs:
        if resolved.group_key == "__total__":
            group_vals_p = ["__total__"]
            keep_idx = _apply_having_filters(
                group_vals_p, having_filters,
                pairs=pairs, value_keys=resolved.value_keys, indicator=ind, is_total=True, cfg=cfg,
            )
            if not keep_idx:
                pairs = []
        else:
            group_vals_p = [p[0] for p in pairs]
            keep_idx = _apply_having_filters(
                group_vals_p, having_filters,
                pairs=pairs, value_keys=resolved.value_keys, indicator=ind, cfg=cfg,
            )
            if keep_idx:
                keep_set = set(keep_idx)
                pairs = [p for i, p in enumerate(pairs) if i in keep_set]
            else:
                pairs = []
    group_domain = _read_group_domain_for_column(schema_def, resolved.group_key)
    simple_grouped_one_metric = (
        resolved.group_key != _SYNTHETIC_GROUP
        and len(resolved.value_keys) == 1
    )
    if simple_grouped_one_metric and group_domain:
        pairs = _pairs_reordered_by_domain(pairs, group_domain)
        if top_n is not None and top_n > 0:
            pairs = pairs[:top_n]
    else:
        pairs = _apply_sort_top_n(pairs, sort_order, top_n, time_order, datasets=None, cfg=cfg)

    # 有分組 + 僅一個量值：pairs 即 GROUP BY × 該欄 aggregation；display_fields 只描述呈現欄位，不應再當築跅寫 pairs。
    #（即使 ind_list 非空但若落到此段 pairs，仍不篩分組，避免误殺多 bucket。）
    if not simple_grouped_one_metric:
        pairs = _apply_display_fields(pairs, display_fields or [], cfg, resolved=resolved)
    if ind in cfg.indicator_column_names:
        as_pct = cfg.indicator_as_percent.get(ind, False)
        value_label = cfg.indicator_labels.get(ind, ind)
    elif ind and "/" in ind:
        value_label = ind
    elif resolved.value_aggregations and (resolved.value_aggregations[0] if resolved.value_aggregations else "") == "count":
        value_label = "筆數"
    else:
        vk = resolved.value_keys[0] if resolved.value_keys else ""
        value_label = cfg.value_display_names.get(vk, vk)
    group_vals_from_pairs = [p[0] for p in pairs]
    labels, group_details = _to_labels_and_details(group_vals_from_pairs)
    out_final: dict[str, Any] = {
        "labels": labels,
        "data": [p[1] for p in pairs],
    }
    # 多指標（無分組且 labels 為多個不同指標）時不輸出 valueLabel，避免 LLM 誤解
    is_multi_metric = resolved.group_key == "__total__" and len(pairs) > 1
    if not is_multi_metric:
        out_final["valueLabel"] = value_label
    if group_details is not None:
        out_final["groupDetails"] = group_details
    return out_final