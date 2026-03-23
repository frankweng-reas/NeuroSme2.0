"""
端對端測試：模擬 chat_compute_tool 的 Intent 流程（不含 LLM）
驗證「momo深度保濕精華液的銷售額」在各種 intent 下都能正確回答
"""
import importlib.util
import re
import sys

sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("ac", "app/services/analysis_compute.py")
ac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ac)
schema_spec = importlib.util.spec_from_file_location("sl", "app/services/schema_loader.py")
sl = importlib.util.module_from_spec(schema_spec)
schema_spec.loader.exec_module(sl)
SCHEMA_FACT = sl.load_schema("fact_business_operations")


def get_schema_summary(rows):
    schema = ac.infer_schema(rows)
    cols = list(schema.keys())
    sample = rows[0] if rows else {}
    sample_str = ", ".join(f"{k}={repr(sample.get(k, ''))[:30]}" for k in cols[:8])
    return f"欄位：{cols}\n型別：{schema}\n第一列範例：{sample_str}"


def safe_int(v):
    if v is None:
        return None
    try:
        return int(v) if v else None
    except (TypeError, ValueError):
        return None


SCHEMA_E2E = {
    "columns": {
        "平台": {"type": "str", "attr": "dim", "aliases": ["平台", "通路", "店"]},
        "月份": {"type": "str", "attr": "dim", "aliases": ["月份", "月"]},
        "產品名稱": {"type": "str", "attr": "dim", "aliases": ["產品名稱", "產品", "品名"]},
        "銷售數量": {"type": "num", "attr": "val", "aliases": ["銷售數量", "數量"]},
        "銷售金額": {"type": "num", "attr": "val", "aliases": ["銷售金額", "銷售額", "金額"]},
    },
    "indicators": {},
}

SCHEMA_CHANNEL_NET = {
    "columns": {
        "channel_id": {"type": "str", "attr": "dim", "aliases": ["channel_id", "通路"]},
        "item_name": {"type": "str", "attr": "dim", "aliases": ["item_name", "產品"]},
        "net_amount": {"type": "num", "attr": "val", "aliases": ["net_amount", "銷售金額"]},
        "gross_profit": {"type": "num", "attr": "val", "aliases": ["gross_profit", "毛利"]},
        "cost_amount": {"type": "num", "attr": "val", "aliases": ["cost_amount", "成本"]},
    },
    "indicators": {
        "margin_rate": {"type": "ratio", "display_label": "毛利率", "value_components": ["gross_profit", "net_amount"], "as_percent": True},
        "roi": {"type": "ratio", "display_label": "ROI", "value_components": ["gross_profit", "cost_amount"], "as_percent": False},
    },
}

SCHEMA_DOCTOR = {
    "columns": {
        "doctor_name": {"type": "str", "attr": "dim", "aliases": []},
        "department": {"type": "str", "attr": "dim", "aliases": []},
        "wait_time": {"type": "num", "attr": "val", "aliases": []},
        "patient_count": {"type": "num", "attr": "val", "aliases": []},
    },
    "indicators": {},
}

CSV = """平台,月份,產品名稱,銷售數量,銷售金額
momo,1月,momo深度保濕精華液,10,1000
momo,2月,momo 深度保濕精華液,5,500
pchome,1月,其他產品,20,2000"""

USER_CONTENT = "momo深度保濕精華液的銷售額"


def _to_value_cols(intent: dict) -> list[dict[str, str]]:
    """將 intent 轉為 value_columns 新格式 [{ column, aggregation }]"""
    agg = (intent.get("aggregation") or "sum").strip().lower()
    if agg not in ("sum", "avg", "count"):
        agg = "sum"
    vc = intent.get("value_columns")
    if isinstance(vc, list) and vc:
        out = []
        for item in vc:
            if isinstance(item, dict) and item.get("column"):
                out.append({
                    "column": str(item["column"]).strip(),
                    "aggregation": (item.get("aggregation") or agg).strip().lower() or "sum",
                })
        if out:
            return out
        # 舊格式 list[str]
        return [{"column": str(v).strip(), "aggregation": agg} for v in vc if v]
    vcol = intent.get("value_column")
    if vcol:
        return [{"column": str(vcol).strip(), "aggregation": agg}]
    return [{"column": "sales_amount", "aggregation": "sum"}]


def run_flow(intent: dict) -> dict | None:
    """模擬 chat_compute_tool 的 intent 流程"""
    rows = ac.parse_csv_content(CSV)
    if not rows:
        return None
    schema_summary = get_schema_summary(rows)

    group_by = intent.get("group_by_column")
    filter_col = intent.get("filter_column")
    filter_val = intent.get("filter_value")

    # 補強：問「X的銷售額」時
    if "的銷售額" in USER_CONTENT:
        m = re.search(r"(.+?)的銷售額", USER_CONTENT.strip())
        has_product_col = any(k in schema_summary for k in ("產品名稱", "產品", "商品名稱", "商品", "品名"))
        has_value_col = any(k in schema_summary for k in ("銷售金額", "銷售額", "銷售數量", "金額", "數量"))
        if m and has_product_col and has_value_col:
            inferred_product = re.sub(r"[\s,，、]+", "", m.group(1).strip())
            group_by = "產品名稱"
            filter_col = "產品名稱"
            filter_val = inferred_product
            if not intent.get("value_column") and not intent.get("value_columns"):
                intent = dict(intent)
                intent["value_column"] = "銷售金額" if "銷售金額" in schema_summary else ("銷售額" if "銷售額" in schema_summary else "銷售數量")

    has_gb = (bool(group_by) if isinstance(group_by, list) else bool((group_by or "").strip()))
    if not has_gb:
        return None

    filters = None
    if isinstance(intent.get("filters"), list):
        filters = [{"column": str(f.get("column", "")).strip(), "value": f.get("value")} for f in intent.get("filters", []) if isinstance(f, dict) and f.get("column") is not None]
        filters = filters if filters else None
    elif filter_col and filter_val is not None:
        filters = [{"column": filter_col, "value": filter_val}]
    value_cols = _to_value_cols(intent)
    chart_result = ac.compute_aggregate(
        rows,
        group_by,
        value_cols,
        series_by_column=intent.get("series_by_column"),
        filters=filters,
        top_n=safe_int(intent.get("top_n")),
        sort_order=intent.get("sort_order") or "desc",
        time_order=intent.get("time_order") in (True, "true", 1),
        indicator=intent.get("indicator") if isinstance(intent.get("indicator"), list) else None,
        schema_def=SCHEMA_E2E,
    )
    return chart_result


def test_wrong_intent_no_filter():
    """LLM 輸出錯誤：無 filter"""
    intent = {
        "group_by_column": ["平台"],
        "value_column": "銷售金額",
        "aggregation": "sum",
        "chart_type": "bar",
        "filter_column": None,
        "filter_value": None,
    }
    r = run_flow(intent)
    assert r, "應由補強修正，不應失敗"
    total = sum(r["data"])
    assert total == 1500, f"預期 1500（momo深度保濕精華液），實際 {total}"


def test_wrong_intent_wrong_group():
    """LLM 輸出錯誤：group_by=平台"""
    intent = {
        "group_by_column": ["平台"],
        "value_column": "銷售金額",
        "filter_column": None,
        "filter_value": None,
    }
    r = run_flow(intent)
    assert r, "應由補強修正"
    total = sum(r["data"])
    assert total == 1500, f"預期 1500，實際 {total}"


def test_correct_intent():
    """LLM 輸出正確"""
    intent = {
        "group_by_column": ["產品名稱"],
        "value_column": "銷售金額",
        "filter_column": "產品名稱",
        "filter_value": "momo深度保濕精華液",
    }
    r = run_flow(intent)
    assert r
    assert sum(r["data"]) == 1500


def test_different_column_names():
    """CSV 欄位為 商品名稱、銷售額（非 產品名稱、銷售金額）"""
    csv2 = """平台,月份,商品名稱,銷售數量,銷售額
momo,1月,momo深度保濕精華液,10,1000
pchome,1月,其他產品,20,2000"""
    rows = ac.parse_csv_content(csv2)
    schema_summary = get_schema_summary(rows)
    assert "商品名稱" in schema_summary and "銷售額" in schema_summary
    # 補強會設 group_by=產品名稱，_resolve_columns 會透過 alias 對應到 商品名稱
    intent = {"group_by_column": ["平台"], "value_column": None, "filter_column": None, "filter_value": None}
    group_by, filter_col, filter_val = "平台", None, None
    if "的銷售額" in USER_CONTENT:
        m = re.search(r"(.+?)的銷售額", USER_CONTENT.strip())
        has_product_col = any(k in schema_summary for k in ("產品名稱", "產品", "商品名稱", "商品", "品名"))
        has_value_col = any(k in schema_summary for k in ("銷售金額", "銷售額", "銷售數量", "金額", "數量"))
        if m and has_product_col and has_value_col:
            group_by = "產品名稱"
            filter_col = "產品名稱"
            filter_val = m.group(1).strip()
            intent = dict(intent)
            intent["value_column"] = "銷售金額" if "銷售金額" in schema_summary else "銷售額"
    filters = [{"column": filter_col, "value": filter_val}] if filter_col and filter_val is not None else None
    r = ac.compute_aggregate(
        rows, group_by,
        [{"column": intent.get("value_column") or "銷售額", "aggregation": "sum"}],
        filters=filters,
        schema_def=SCHEMA_E2E,
    )
    assert r, "alias 應對應 產品名稱->商品名稱"
    assert sum(r["data"]) == 1000


def test_product_with_comma():
    """輸入「momo, 深度保濕精華液的銷售額」時，應正規化為 momo深度保濕精華液"""
    USER_WITH_COMMA = "momo, 深度保濕精華液的銷售額"
    rows = ac.parse_csv_content(CSV)
    schema_summary = get_schema_summary(rows)
    intent = {"group_by_column": ["平台"], "value_column": "銷售金額", "filter_column": None, "filter_value": None}
    group_by, filter_col, filter_val = "平台", None, None
    if "的銷售額" in USER_WITH_COMMA:
        m = re.search(r"(.+?)的銷售額", USER_WITH_COMMA.strip())
        has_product_col = any(k in schema_summary for k in ("產品名稱", "產品", "商品名稱", "商品", "品名"))
        has_value_col = any(k in schema_summary for k in ("銷售金額", "銷售額", "銷售數量", "金額", "數量"))
        if m and has_product_col and has_value_col:
            inferred_product = re.sub(r"[\s,，、]+", "", m.group(1).strip())
            group_by = "產品名稱"
            filter_col = "產品名稱"
            filter_val = inferred_product
    assert filter_val == "momo深度保濕精華液", f"應正規化為 momo深度保濕精華液，實際 {filter_val}"
    r = ac.compute_aggregate(
        rows, group_by,
        [{"column": "銷售金額", "aggregation": "sum"}],
        filters=[{"column": filter_col, "value": filter_val}],
        schema_def=SCHEMA_E2E,
    )
    assert r and sum(r["data"]) == 1500


def test_momo_platform_product():
    """momo深度保濕精華液 = 平台 momo + 產品 深度保濕精華液"""
    csv = """平台,月份,產品名稱,銷售數量,銷售金額
momo,1月,momo深度保濕精華液,10,1000
momo,2月,深度保濕精華液,5,500
pchome,1月,深度保濕精華液,20,2000"""
    rows = ac.parse_csv_content(csv)
    r = ac.compute_aggregate(
        rows, "產品名稱",
        [{"column": "銷售金額", "aggregation": "sum"}],
        filters=[{"column": "平台", "value": "momo"}, {"column": "產品名稱", "value": "深度保濕精華液"}],
        schema_def=SCHEMA_E2E,
    )
    assert r, "應篩選 momo 平台"
    assert sum(r["data"]) == 1500, f"momo 平台應為 1500，實際 {sum(r['data'])}"


def test_arpu_with_guest_count():
    """ARPU 分母可為 guest_count（人均營收 = sales_amount / guest_count）"""
    csv = """timestamp,store_name,sales_amount,guest_count
2026-03-17,台北店,1508,1
2026-03-17,台中店,1286,1"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 2
    r = ac.compute_aggregate(
        rows,
        "timestamp",
        [{"column": "sales_amount", "aggregation": "sum"}, {"column": "guest_count", "aggregation": "sum"}],
        indicator=["arpu"],
        series_by_column="store_name",
        display_fields=["sales_amount", "arpu"],
        schema_def=SCHEMA_FACT,
    )
    assert r, "arpu + guest_count 應成功"
    assert "datasets" in r
    labels = [d["label"] for d in r["datasets"]]
    assert any("客單價" in lbl or "arpu" in lbl.lower() for lbl in labels), "應含 ARPU 客單價"
    assert any("銷售金額" in lbl or "sales" in lbl.lower() for lbl in labels), "應含銷售金額"


def test_indicator_as_array():
    """indicator 為陣列 ["arpu"] 時不應報 'list' object has no attribute 'strip'"""
    csv = """store_name,sales_amount,guest_count
momo,1000,10
pchome,2000,20"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 2
    r = ac.compute_aggregate(
        rows,
        "store_name",
        [{"column": "sales_amount", "aggregation": "sum"}, {"column": "guest_count", "aggregation": "sum"}],
        indicator=["arpu"],
        schema_def=SCHEMA_FACT,
    )
    assert r, "indicator 為陣列應成功"
    data_by_label = dict(zip(r["labels"], r["data"]))
    assert data_by_label.get("momo") == 100.0  # 1000/10
    assert data_by_label.get("pchome") == 100.0  # 2000/20


def test_indicator_margin_rate():
    """複合指標：毛利率 margin_rate = gross_profit / net_amount"""
    csv = """channel_id,net_amount,gross_profit
momo,1000,300
pchome,2000,600
shopee,500,100"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 3
    r = ac.compute_aggregate(
        rows,
        "channel_id",
        [{"column": "gross_profit", "aggregation": "sum"}, {"column": "net_amount", "aggregation": "sum"}],
        indicator=["margin_rate"],
        schema_def=SCHEMA_CHANNEL_NET,
    )
    assert r, "indicator margin_rate 應成功"
    assert "labels" in r and "data" in r
    # momo: 300/1000=30%, pchome: 600/2000=30%, shopee: 100/500=20%
    data_by_label = dict(zip(r["labels"], r["data"]))
    assert data_by_label.get("momo") == 30.0
    assert data_by_label.get("pchome") == 30.0
    assert data_by_label.get("shopee") == 20.0


def test_indicator_multi():
    """複合指標陣列：indicator=["margin_rate","roi"]"""
    csv = """item_name,gross_profit,net_amount,cost_amount,channel_id
A,100,200,50,momo
A,50,100,25,momo
B,200,400,100,momo"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 3
    r = ac.compute_aggregate(
        rows,
        "item_name",
        [
            {"column": "gross_profit", "aggregation": "sum"},
            {"column": "net_amount", "aggregation": "sum"},
            {"column": "cost_amount", "aggregation": "sum"},
        ],
        indicator=["margin_rate", "roi"],
        display_fields=["item_name", "margin_rate", "roi"],
        filters=[{"column": "channel_id", "op": "==", "value": "momo"}],
        schema_def=SCHEMA_CHANNEL_NET,
    )
    assert r, "indicator 陣列應成功"
    assert "labels" in r and "datasets" in r
    # A: margin_rate=150/300=50%, roi=150/75=200%
    # B: margin_rate=200/400=50%, roi=200/100=200%
    labels = r["labels"]
    datasets = r["datasets"]
    assert len(datasets) == 2
    assert any(d.get("label") == "毛利率" for d in datasets)
    assert any(d.get("label") == "ROI" for d in datasets)


def test_indicator_no_group_by():
    """group_by_column=null 時，視為單一總計（如「momo 的毛利率」）"""
    csv = """channel_id,net_amount,gross_profit
momo,1000,300
momo,500,150"""
    rows = ac.parse_csv_content(csv)
    r = ac.compute_aggregate(
        rows,
        " ",  # 空 group_by
        [{"column": "gross_profit", "aggregation": "sum"}, {"column": "net_amount", "aggregation": "sum"}],
        indicator=["margin_rate"],
        filters=[{"column": "channel_id", "value": "momo"}],
        schema_def=SCHEMA_CHANNEL_NET,
    )
    assert r, "group_by 空 + indicator 應成功"
    assert len(r["labels"]) == 3 and "毛利率" in r["labels"]
    idx = r["labels"].index("毛利率")
    assert r["data"][idx] == 30.0  # (300+150)/(1000+500)=30%


def test_new_schema_sales_amount_store_name():
    """新 schema：sales_amount、store_name 取代 net_amount、channel_id"""
    csv = """store_name,sales_amount,gross_profit
momo,1000,300
pchome,2000,600
shopee,500,100"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 3
    r = ac.compute_aggregate(
        rows,
        "store_name",
        [{"column": "gross_profit", "aggregation": "sum"}, {"column": "sales_amount", "aggregation": "sum"}],
        indicator=["margin_rate"],
        schema_def=SCHEMA_FACT,
    )
    assert r, "新 schema sales_amount + store_name 應成功"
    data_by_label = dict(zip(r["labels"], r["data"]))
    assert data_by_label.get("momo") == 30.0
    assert data_by_label.get("pchome") == 30.0
    assert data_by_label.get("shopee") == 20.0


def test_no_value_column():
    """LLM 未輸出 value_column，補強應推斷"""
    intent = {
        "group_by_column": ["平台"],
        "value_column": None,  # 缺失
        "filter_column": None,
        "filter_value": None,
    }
    r = run_flow(intent)
    assert r, "補強應推斷 value_column=銷售金額"
    assert sum(r["data"]) == 1500


def test_expression_indicator():
    """運算式指標：discount_amount/gross_amount"""
    csv = """store_name,discount_amount,gross_amount,sales_amount
momo,100,1000,900
pchome,200,2000,1800
shopee,50,500,450"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 3
    SCHEMA_DISC = {"columns": {"store_name": {"type": "str", "attr": "dim", "aliases": []}, "discount_amount": {"type": "num", "attr": "val", "aliases": []}, "gross_amount": {"type": "num", "attr": "val", "aliases": []}}, "indicators": {}}
    r = ac.compute_aggregate(
        rows,
        "store_name",
        [
            {"column": "discount_amount", "aggregation": "sum"},
            {"column": "gross_amount", "aggregation": "sum"},
        ],
        indicator=["discount_amount/gross_amount"],
        schema_def=SCHEMA_DISC,
    )
    assert r, "運算式指標應成功"
    assert "labels" in r and "data" in r
    data_by_label = dict(zip(r["labels"], r["data"]))
    # momo: 100/1000=10%, pchome: 200/2000=10%, shopee: 50/500=10%
    assert data_by_label.get("momo") == 10.0
    assert data_by_label.get("pchome") == 10.0
    assert data_by_label.get("shopee") == 10.0
    print("OK: expression indicator (discount_amount/gross_amount)")


def test_per_column_aggregation():
    """每欄位不同 aggregation：avg(wait_time) + count(patient_id)"""
    csv = """doctor_name,department,wait_time,patient_id
王醫師,內科,10,101
王醫師,內科,20,102
李醫師,內科,30,201"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 3
    value_cols = [
        {"column": "wait_time", "aggregation": "avg"},
        {"column": "patient_id", "aggregation": "count"},
    ]
    r = ac.compute_aggregate(
        rows,
        "doctor_name",
        value_cols,
        filters=[{"column": "department", "op": "==", "value": "內科"}],
        schema_def=SCHEMA_DOCTOR,
    )
    assert r, "per-column agg 應成功"
    assert "datasets" in r
    label_to_data = {d["label"]: d["data"] for d in r["datasets"]}
    # 王醫師: avg wait_time=(10+20)/2=15, count=2
    # 李醫師: avg wait_time=30, count=1
    assert "wait_time" in str(label_to_data) or any("wait" in k.lower() for k in label_to_data)
    # 依 labels 順序（通常 李醫師 < 王醫師）：data[0]=李醫師(30,1), data[1]=王醫師(15,2)
    got_wait = None
    got_count = None
    for d in r["datasets"]:
        lbl = d.get("label", "")
        if "wait_time" in lbl or lbl == "wait_time":
            got_wait = d["data"]
        if "patient_id" in lbl or lbl == "patient_id":
            got_count = d["data"]
    if got_wait:
        # 李醫師 avg=30, 王醫師 avg=15（sort 後可能 李<王）
        assert 30.0 in got_wait and 15.0 in got_wait
    if got_count:
        assert 1 in got_count and 2 in got_count
    print("OK: per-column aggregation (avg + count)")


if __name__ == "__main__":
    test_arpu_with_guest_count()
    print("OK: arpu + guest_count")
    test_indicator_as_array()
    print("OK: indicator 為陣列")
    test_new_schema_sales_amount_store_name()
    print("OK: 新 schema sales_amount/store_name")
    test_expression_indicator()
    print("OK: expression indicator")
    test_per_column_aggregation()
    print("OK: per-column aggregation")
    test_wrong_intent_no_filter()
    print("OK: wrong intent (no filter) -> 補強成功")
    test_wrong_intent_wrong_group()
    print("OK: wrong intent (group_by=平台) -> 補強成功")
    test_correct_intent()
    print("OK: correct intent")
    test_no_value_column()
    print("OK: no value_column -> 補強成功")
    test_product_with_comma()
    print("OK: momo, 深度保濕精華液 正規化")
    test_momo_platform_product()
    print("OK: momo 平台 + 產品 雙重篩選")
    test_indicator_margin_rate()
    print("OK: indicator margin_rate")
    test_indicator_no_group_by()
    print("OK: indicator + group_by null")
    test_different_column_names()
    print("OK: 商品名稱/銷售額 alias 對應")
    print("All E2E tests passed.")
