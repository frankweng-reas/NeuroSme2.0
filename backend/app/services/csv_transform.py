"""
CSV 轉換：依 mapping 對應至 Standard Schema，並計算衍生欄位（無未映射欄位預設值 fallback）

- gross_amount = unit_price * quantity
- sales_amount = gross_amount - discount_amount
- gross_profit = sales_amount - cost_amount
"""
import io
from typing import Any

import pandas as pd


def _to_numeric(val: Any) -> float:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(",", "")
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _parse_timestamp(val: Any) -> str:
    """解析為「日期＋時間」格式：YYYY-MM-DD HH:MM:SS"""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    s = str(val).strip()
    if not s:
        return ""
    try:
        dt = pd.to_datetime(s)
        return dt.strftime("%Y-%m-%d %H:%M:%S") if hasattr(dt, "strftime") else s
    except Exception:
        return s


def transform_csv_to_schema(
    csv_content: str,
    mapping: dict[str, str],
    schema_fields: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    將 CSV 依 mapping 轉換為 Standard Schema 格式。
    mapping: { "csv_column_name": "schema_field_name" }
    嚴格：mapping 必須與 schema 欄位一對一；不為未出現在 mapping 的欄位填預設值。
    """
    if not csv_content or not csv_content.strip():
        raise ValueError("CSV 內容為空")

    required = {f["field"] for f in schema_fields}
    got = set(mapping.values())
    if got != required:
        raise ValueError(
            "CSV 表頭與資料模板未完全對應：schema 需要欄位 "
            f"{sorted(required)}，已對應 {sorted(got)}"
        )
    if len(mapping) != len(required):
        raise ValueError("CSV 欄位對應必須與 schema 欄位一對一（不可多對一）")

    reverse: dict[str, str] = {}
    for csv_h, sf in mapping.items():
        ch = str(csv_h).strip().strip('"')
        if sf in reverse:
            raise ValueError(f"schema 欄位「{sf}」被多個 CSV 欄重複對應")
        reverse[sf] = ch

    try:
        df = pd.read_csv(io.StringIO(csv_content.strip()), encoding="utf-8-sig")
    except Exception as e:
        raise ValueError(f"無法解析 CSV：{e}") from e

    df.columns = [str(c).strip() for c in df.columns]

    for col in reverse.values():
        if col not in df.columns:
            raise ValueError(f"CSV 內缺少欄位「{col}」")

    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        out: dict[str, Any] = {}
        for field_def in schema_fields:
            field = field_def["field"]
            csv_col = reverse[field]
            val = row.get(csv_col)
            ftype = field_def.get("type", "str")
            if ftype == "num":
                out[field] = _to_numeric(val)
            elif ftype in ("timestamp", "time"):
                out[field] = _parse_timestamp(val)
            else:
                out[field] = "" if (val is None or (isinstance(val, float) and pd.isna(val))) else str(val).strip()

        field_names = {f["field"] for f in schema_fields}
        if field_names & {"gross_amount", "sales_amount", "gross_profit"}:
            unit_price = _to_numeric(out.get("unit_price", 0))
            quantity = _to_numeric(out.get("quantity", 1))
            discount_amount = _to_numeric(out.get("discount_amount", 0))
            cost_amount = _to_numeric(out.get("cost_amount", 0))
            gross_amount_mapped = _to_numeric(out.get("gross_amount", 0))
            sales_amount_mapped = _to_numeric(out.get("sales_amount", 0))
            gross_profit_mapped = _to_numeric(out.get("gross_profit", 0))

            gross_amount = gross_amount_mapped if gross_amount_mapped else unit_price * quantity
            sales_amount = sales_amount_mapped if sales_amount_mapped else gross_amount - discount_amount
            gross_profit = gross_profit_mapped if gross_profit_mapped else sales_amount - cost_amount

            if "gross_amount" in field_names:
                out["gross_amount"] = gross_amount
            if "sales_amount" in field_names:
                out["sales_amount"] = sales_amount
            if "gross_profit" in field_names:
                out["gross_profit"] = gross_profit

        rows.append({f["field"]: out[f["field"]] for f in schema_fields})

    return rows
