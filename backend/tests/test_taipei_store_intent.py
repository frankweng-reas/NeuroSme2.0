"""
測試「台北店，3/15營業狀況」：intent 通過後，篩選無資料應回傳「查無符合條件的資料」
"""
import importlib.util
import sys

sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("ac", "app/services/analysis_compute.py")
ac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ac)

try:
    schema_spec = importlib.util.spec_from_file_location("sl", "app/services/schema_loader.py")
    sl = importlib.util.module_from_spec(schema_spec)
    schema_spec.loader.exec_module(sl)
    SCHEMA_DEF = sl.load_schema("fact_business_operations")
except Exception:
    SCHEMA_DEF = {
        "columns": {
            "store_name": {"type": "str", "attr": "dim", "aliases": ["通路", "平台"]},
            "timestamp": {"type": "time", "attr": "dim_time", "aliases": ["日期", "時間"]},
            "sales_amount": {"type": "num", "attr": "val", "aliases": ["營收", "銷售金額"]},
            "gross_profit": {"type": "num", "attr": "val", "aliases": ["毛利"]},
        },
        "indicators": {},
    }

# 模擬 Sales Analytics schema：有信義店、板橋店，無台北店
CSV = """store_name,timestamp,sales_amount,gross_profit
信義店,2025-03-15,50000,12000
板橋店,2025-03-15,30000,8000
信義店,2025-03-16,45000,11000"""


def test_intent_passes_then_compute_no_data():
    """台北店 3/15：intent 有 filters，應通過 intent 檢查；compute 篩選後無資料，應得查無資料"""
    rows = ac.parse_csv_content(CSV)
    assert rows, "CSV 應解析成功"

    # 模擬 LLM 回傳的 intent（台北店、3/15 營業狀況）
    intent = {
        "group_by_column": ["store_name"],
        "value_columns": [{"column": "sales_amount", "aggregation": "sum"}],
        "filters": [
            {"column": "store_name", "op": "==", "value": "台北店"},
            {"column": "timestamp", "op": "==", "value": "2025-03-15"},
        ],
        "aggregation": "sum",
        "chart_type": "bar",
    }

    # 模擬 chat_compute_tool 的 filter 解析
    filters = intent.get("filters")
    parsed_filters = None
    if isinstance(filters, list):
        out = []
        for f in filters:
            if isinstance(f, dict):
                col = f.get("column") or f.get("col")
                val = f.get("value") if "value" in f else f.get("val")
                op = f.get("op")
                if col is not None and str(col).strip():
                    op_str = str(op).strip().lower() if op else "=="
                    out.append({"column": str(col).strip(), "op": op_str or "==", "value": val})
        if out:
            parsed_filters = out

    has_aggregate = intent.get("value_columns") or intent.get("indicator")
    has_group = bool(intent.get("group_by_column"))
    has_filters = bool(parsed_filters)

    assert has_group or has_aggregate or has_filters, "intent 應通過（有 group、value_columns、filters）"

    # 執行 compute
    error_list = []
    value_cols = intent.get("value_columns")
    if not value_cols:
        value_cols = [{"column": "sales_amount", "aggregation": "sum"}]
    chart_result = ac.compute_aggregate(
        rows,
        intent.get("group_by_column") or "",
        value_cols,
        "bar",
        filters=parsed_filters,
        schema_def=SCHEMA_DEF,
        error_out=error_list,
    )

    assert chart_result is None, "台北店不在資料中，應回傳 None"
    assert any("篩選後無資料" in e or "無資料" in e for e in error_list), f"error_list 應含篩選後無資料: {error_list}"

    # 模擬 chat_compute_tool 的錯誤訊息選擇
    err_msg = "; ".join(error_list)
    if "篩選後無資料" in err_msg or "無資料" in err_msg:
        content = "查無符合條件的資料，請調整篩選條件或時間範圍。"
    else:
        content = "後端計算失敗，請稍後再試或調整問題描述。"

    assert "查無符合條件" in content, f"應回傳查無資料，實際: {content}"
    print("OK: 台北店 3/15 -> 查無符合條件的資料")


def test_intent_with_col_alias():
    """LLM 用 col 而非 column 時，仍應解析成功"""
    intent = {
        "group_by_column": [],
        "value_columns": [],
        "filters": [
            {"col": "store_name", "value": "台北店"},
            {"col": "timestamp", "value": "2025-03-15"},
        ],
    }
    filters = intent.get("filters")
    out = []
    for f in filters:
        if isinstance(f, dict):
            col = f.get("column") or f.get("col")
            val = f.get("value") if "value" in f else f.get("val")
            if col is not None and str(col).strip():
                out.append({"column": str(col).strip(), "op": "==", "value": val})
    assert len(out) == 2, "col 別名應解析出 2 個 filter"
    assert out[0]["column"] == "store_name"
    print("OK: col 別名解析")


if __name__ == "__main__":
    test_intent_with_col_alias()
    test_intent_passes_then_compute_no_data()
    print("All 台北店 tests passed.")
