#!/usr/bin/env python3
"""
手動驗證腳本：使用固定資料執行測試案例，輸出實際結果與預期值供比對。
執行：cd backend && python tests/run_manual_verification.py
"""
import sys
sys.path.insert(0, ".")
import importlib.util
spec = importlib.util.spec_from_file_location("ac", "app/services/analysis_compute.py")
ac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ac)

try:
    schema_mod = importlib.util.spec_from_file_location("schema_loader", "app/services/schema_loader.py")
    sl = importlib.util.module_from_spec(schema_mod)
    schema_mod.loader.exec_module(sl)
    SCHEMA_DEF = sl.load_schema("fact_business_operations")
except Exception as e:
    print(f"WARN: 無法載入 schema_loader: {e}，使用內建 schema")
    SCHEMA_DEF = {
        "columns": {
            "store_name": {"type": "str", "attr": "dim", "aliases": ["通路", "平台", "店"]},
            "channel": {"type": "str", "attr": "dim", "aliases": ["通路"]},
            "item_name": {"type": "str", "attr": "dim", "aliases": ["品名", "產品"]},
            "gross_profit": {"type": "num", "attr": "val", "aliases": ["毛利"]},
            "sales_amount": {"type": "num", "attr": "val", "aliases": ["營收", "銷售金額"]},
            "cost_amount": {"type": "num", "attr": "val", "aliases": ["成本"]},
            "quantity": {"type": "num", "attr": "val", "aliases": ["數量"]},
        },
        "indicators": {
            "margin_rate": {"type": "ratio", "display_label": "毛利率", "value_components": ["gross_profit", "sales_amount"], "as_percent": True},
            "roi": {"type": "ratio", "display_label": "ROI", "value_components": ["gross_profit", "cost_amount"], "as_percent": False},
        },
    }

CSV = """store_name,channel,item_name,gross_profit,sales_amount,cost_amount,quantity
店A,momo,商品X,100,200,50,10
店A,momo,商品Y,50,100,25,5
店A,shopee,商品X,80,160,40,8
店B,momo,商品X,200,400,100,20
店B,shopee,商品Y,30,60,15,3
店C,momo,商品X,40,200,40,20"""

rows = ac.parse_csv_content(CSV)
if not rows:
    print("ERROR: 無法解析 CSV")
    sys.exit(1)

def run_case(name, **kwargs):
    print(f"\n{'='*60}\n【{name}】\n{'='*60}")
    kwargs.setdefault("schema_def", SCHEMA_DEF)
    r = ac.compute_aggregate(rows, **kwargs)
    if not r:
        print("結果：None（失敗）")
        return
    print("labels:", r.get("labels"))
    if "datasets" in r:
        for d in r.get("datasets", []):
            print(f"  {d.get('label')}: {d.get('data')}")
    if "data" in r:
        print("data:", r.get("data"))
    return r

# 案例 1
run_case("案例 1：各店銷售額、毛利率、ROI",
    group_by_column=["store_name"],
    value_columns=[
        {"column": "gross_profit", "aggregation": "sum"},
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator=["margin_rate", "roi"],
    display_fields=["store_name", "sales_amount", "margin_rate", "roi"],
)
print("\n預期：銷售金額=[460,460,200], 毛利率=[50,50,20], ROI=[2,2,1]（labels 順序可能為店A,店B,店C）")

# 案例 2
run_case("案例 2：各店毛利率",
    group_by_column=["store_name"],
    value_columns=[
        {"column": "gross_profit", "aggregation": "sum"},
        {"column": "sales_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator=["margin_rate"],
    display_fields=["store_name", "margin_rate"],
)
print("\n預期：毛利率=[50,50,20]")

# 案例 3
run_case("案例 3：總計毛利率與 ROI",
    group_by_column=[],
    value_columns=[
        {"column": "gross_profit", "aggregation": "sum"},
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator=["margin_rate", "roi"],
)
print("\n預期：銷售金額=1120, 毛利=500, 成本=270, 毛利率≈44.64, ROI≈1.85")

# 案例 4
run_case("案例 4：各店各通路銷售額",
    group_by_column=["store_name"],
    series_by_column="channel",
    value_columns=[{"column": "sales_amount", "aggregation": "sum"}],
    chart_type="bar",
    display_fields=["sales_amount"],
)
print("\n預期：銷售金額-momo=[300,400,200], 銷售金額-shopee=[160,60,0]")

# 案例 5
run_case("案例 5：各店銷售額與成本",
    group_by_column=["store_name"],
    value_columns=[
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    display_fields=["sales_amount", "cost_amount"],
)
print("\n預期：銷售金額=[460,460,200], 成本=[115,115,40]")

# 案例 6
run_case("案例 6：總計多欄位",
    group_by_column=[],
    value_columns=[
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
        {"column": "gross_profit", "aggregation": "sum"},
    ],
    chart_type="bar",
)
print("\n預期：銷售金額=1120, 成本=270, 毛利=500")

# 案例 7：sort_order array 格式 - 依毛利率降冪、top_n=2
r7 = run_case("案例 7：依毛利率排序、top_n=2",
    group_by_column=["store_name"],
    value_columns=[
        {"column": "gross_profit", "aggregation": "sum"},
        {"column": "sales_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator=["margin_rate"],
    sort_order=[{"column": "毛利率", "order": "desc"}],
    top_n=2,
)
print("\n預期：依毛利率 desc，僅前 2 名 → 店A、店B（皆 50%）或 店B、店A")
if r7 and r7.get("labels"):
    assert len(r7["labels"]) == 2, f"top_n=2 應只回傳 2 筆，實際 {len(r7['labels'])}"
    assert "店C" not in r7["labels"], "店C 毛利率 20% 應被排除"
    print("✓ sort_order array 與 top_n 正常")

# 案例 8：compare_periods + ratio indicator (arpu)
SCHEMA_ARPU = {
    "columns": {
        "store_name": {"type": "str", "attr": "dim", "aliases": ["通路", "店"]},
        "timestamp": {"type": "time", "attr": "dim_time", "aliases": ["日期"]},
        "sales_amount": {"type": "num", "attr": "val_denom", "aliases": ["營收"]},
        "guest_count": {"type": "num", "attr": "val_denom", "aliases": ["來客數"]},
    },
    "indicators": {
        "arpu": {"type": "ratio", "display_label": "客單價", "value_components": ["sales_amount", "guest_count"], "as_percent": False},
    },
}
# 台北店：2026 期 3250/5=650，2025 期 2000/4=500，成長率 (650-500)/500=30%
rows_arpu = [
    {"store_name": "台北店", "timestamp": "2026-01-15", "sales_amount": 1500, "guest_count": 2},
    {"store_name": "台北店", "timestamp": "2026-02-10", "sales_amount": 1750, "guest_count": 3},
    {"store_name": "台北店", "timestamp": "2025-01-20", "sales_amount": 1000, "guest_count": 2},
    {"store_name": "台北店", "timestamp": "2025-03-01", "sales_amount": 1000, "guest_count": 2},
]
r8 = ac.compute_aggregate(
    rows_arpu,
    group_by_column=["store_name"],
    value_columns=[
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "guest_count", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator=["arpu"],
    display_fields=["store_name", "arpu", "previous_arpu", "客單價成長率"],
    compare_periods={
        "current": {"column": "timestamp", "value": "2026-01-01/2026-03-22"},
        "compare": {"column": "timestamp", "value": "2025-01-01/2025-03-22"},
    },
    filters=[{"column": "store_name", "op": "==", "value": "台北店"}],
    schema_def=SCHEMA_ARPU,
)
print("\n" + "="*60)
print("【案例 8：compare_periods + arpu（台北店）】")
print("="*60)
if r8:
    print("labels:", r8.get("labels"))
    for d in r8.get("datasets", []):
        print(f"  {d.get('label')}: {d.get('data')}")
    print("\n預期：客單價=650（2026期）, 前期客單價=500（2025期）, 客單價成長率=30%")
else:
    print("結果：None（失敗）")
    import traceback
    traceback.print_exc()

print("\n" + "="*60)
print("請對照 test_compute_manual_verification.md 中的預期值驗證上述結果")
print("="*60)
