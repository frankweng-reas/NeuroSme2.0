"""compute_engine：純邏輯單元測試（不依賴 DuckDB 檔案）；Intent 僅 v2。"""
import re

import pandas as pd
import pytest
from pydantic import ValidationError

from app.services.compute_engine import _aggregate_pairs, _apply_filters_v1
from app.schemas.intent_v2 import IntentV2, intent_sql_blockers_v2
from app.services.compute_engine_sql import chart_from_sql_dataframe, intent_sql_blockers
from app.services.compute_engine_sql_v2 import try_build_sql_v2


def test_aggregate_pairs_sum_by_group():
    rows = [{"a": "x", "b": 1}, {"a": "x", "b": 2}, {"a": "y", "b": 3}]
    pairs = _aggregate_pairs(rows, "a", "b", "sum")
    assert sorted(pairs, key=lambda t: t[0]) == [("x", 3.0), ("y", 3.0)]


def test_apply_filters_eq():
    rows = [{"k": 1, "region": "北"}, {"k": 2, "region": "南"}]
    intent = {"filters": [{"column": "region", "op": "==", "value": "北"}]}
    out = _apply_filters_v1(rows, intent)
    assert len(out) == 1 and out[0]["k"] == 1


def _v2(
    *,
    group_by=None,
    metrics=None,
    filters=None,
    time_filter=None,
    compare_periods=None,
    post_aggregate=None,
):
    dims = {"group_by": group_by or []}
    if time_filter:
        dims["time_filter"] = time_filter
    if compare_periods:
        dims["compare_periods"] = compare_periods
    return {
        "version": 2,
        "dimensions": dims,
        "filters": filters or [],
        "metrics": metrics or [],
        "post_aggregate": post_aggregate,
    }


def test_sql_builder_group_sum_filters():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["region"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "amount", "aggregation": "sum", "as": "total_amt"}
            ],
            filters=[{"column": "year", "op": "eq", "value": 2024}],
        )
    )
    allow = {"region", "amount", "year"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, params, meta = built
    assert "GROUP BY" in sql
    assert "SUM" in sql
    assert meta["group_cols"] == ["region"]
    assert params == []


def test_sql_builder_filter_contains():
    intent = IntentV2.model_validate(
        _v2(
            group_by=[],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_11", "aggregation": "sum", "as": "total_sales"}
            ],
            filters=[{"column": "col_4", "op": "contains", "value": "鮮乳"}],
        )
    )
    allow = {"col_1", "col_4", "col_11"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, _ = built
    assert re.search(r"contains\s*\(\s*CAST\s*\(\s*col_4\s+AS\s+VARCHAR\s*\)\s*,\s*'鮮乳'\s*\)", sql, re.IGNORECASE)


def test_intent_v2_contains_rejects_empty_value():
    with pytest.raises(ValidationError):
        IntentV2.model_validate(
            _v2(
                group_by=[],
                metrics=[
                    {"id": "m1", "kind": "aggregate", "column": "col_11", "aggregation": "sum", "as": "s"}
                ],
                filters=[{"column": "col_4", "op": "contains", "value": "   "}],
            )
        )


def test_sql_builder_grand_share():
    intent = IntentV2.model_validate(
        _v2(
            group_by=[],
            metrics=[
                {
                    "id": "gs1",
                    "kind": "grand_share",
                    "column": "col_11",
                    "as": "slice_grand_share",
                    "numerator_filters": [
                        {"column": "col_4", "op": "eq", "value": "燕麥大師"},
                        {"column": "col_5", "op": "contains", "value": "麥片"},
                    ],
                }
            ],
            time_filter={"column": "col_1", "op": "between", "value": ["2025-01-01", "2025-12-31"]},
        )
    )
    allow = {"col_1", "col_4", "col_5", "col_11"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert meta.get("grand_share") is True
    assert meta["group_cols"] == []
    assert re.search(r"SUM\s*\(\s*CASE\s+WHEN", sql, re.IGNORECASE)
    assert "OVER" not in sql.upper()
    assert re.search(
        r"NULLIF\s*\(\s*CAST\s*\(\s*SUM\s*\(\s*col_11\s*\)\s+AS\s+DOUBLE\s*\)\s*,\s*0\s*\)",
        sql,
        re.IGNORECASE,
    )
    assert "ORDER BY" not in sql.upper()


def test_sql_builder_grand_share_with_group_by():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {
                    "id": "gs1",
                    "kind": "grand_share",
                    "column": "col_11",
                    "as": "slice_share_by_region",
                    "numerator_filters": [{"column": "col_4", "op": "eq", "value": "燕麥大師"}],
                }
            ],
        )
    )
    allow = {"col_3", "col_4", "col_11"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert meta["group_cols"] == ["col_3"]
    assert "GROUP BY" in sql.upper()
    assert re.search(r"SUM\s*\(\s*SUM\s*\(\s*col_11\s*\)\s*\)\s+OVER\s*\(\s*\)", sql, re.IGNORECASE)


def test_intent_v2_grand_share_rejects_mixed_metrics():
    with pytest.raises(ValidationError):
        IntentV2.model_validate(
            _v2(
                group_by=[],
                metrics=[
                    {
                        "id": "gs1",
                        "kind": "grand_share",
                        "column": "col_11",
                        "as": "g",
                        "numerator_filters": [{"column": "col_4", "op": "eq", "value": "x"}],
                    },
                    {"id": "m1", "kind": "aggregate", "column": "col_11", "aggregation": "sum", "as": "t"},
                ],
            )
        )


def test_chart_from_sql_grand_share_meta_scales_ratio():
    df = pd.DataFrame({"slice_grand_share": [0.0314]})
    meta = {
        "group_cols": [],
        "agg_aliases": ["slice_grand_share"],
        "dataset_labels": ["slice"],
        "grand_share": True,
    }
    chart = chart_from_sql_dataframe(df, meta, sql_pushdown=True, engine_version=2)
    assert chart["datasets"][0]["data"][0] == pytest.approx(3.14)


def test_sql_builder_between_time_filter():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "s"}
            ],
            time_filter={"column": "col_2", "op": "between", "value": ["2026-01-01", "2026-12-31"]},
        )
    )
    allow = {"col_2", "col_3", "col_8"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, _ = built
    assert "BETWEEN '2026-01-01' AND '2026-12-31'" in sql


def test_sql_builder_time_filter_uses_try_cast_when_schema_type_time():
    """VARCHAR 存日期時間時，schema 標 time 應以 DATE 比較，避免漏列。"""
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "s"}
            ],
            time_filter={"column": "col_2", "op": "between", "value": ["2026-01-01", "2026-12-31"]},
        )
    )
    allow = {"col_2", "col_3", "col_8"}
    schema_def = {"columns": {"col_2": {"type": "time", "attr": "dim_time"}, "col_3": {}, "col_8": {}}, "indicators": {}}
    built = try_build_sql_v2(intent, allow, schema_def)
    assert built is not None
    sql, _, _ = built
    assert "TRY_CAST(col_2 AS DATE)" in sql
    assert "CAST('2026-01-01' AS DATE)" in sql


def test_intent_v2_rejects_v1_keys():
    with pytest.raises(ValidationError):
        IntentV2.model_validate(
            {"version": 2, "dimensions": {"group_by": []}, "value_columns": [], "metrics": []}
        )


def test_intent_v2_coerces_post_where_target_slip_metric_alias():
    """LLM 易把指標別名誤放在 left.target；應改為 target=as, name=該別名。"""
    raw = {
        "version": 2,
        "dimensions": {"group_by": []},
        "filters": [],
        "metrics": [
            {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "current_sales"}
        ],
        "post_aggregate": {
            "where": [
                {
                    "left": {"type": "ref", "target": "current_sales"},
                    "op": "gt",
                    "right": {"type": "literal", "value": 0},
                }
            ]
        },
    }
    v = IntentV2.model_validate(raw)
    left = v.post_aggregate.where[0].left
    assert left.target == "as"
    assert left.name == "current_sales"


def test_intent_v2_coerces_post_where_target_slip_group_dimension():
    """誤寫的維度欄位應對應 target=dimension。"""
    raw = {
        "version": 2,
        "dimensions": {"group_by": ["col_3"]},
        "filters": [],
        "metrics": [
            {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "s"}
        ],
        "post_aggregate": {
            "where": [
                {
                    "left": {"type": "ref", "target": "col_3"},
                    "op": "eq",
                    "right": {"type": "literal", "value": "台北店"},
                }
            ]
        },
    }
    v = IntentV2.model_validate(raw)
    left = v.post_aggregate.where[0].left
    assert left.target == "dimension"
    assert left.name == "col_3"


def test_intent_v2_coerces_post_sort_target_slip():
    raw = {
        "version": 2,
        "dimensions": {"group_by": []},
        "filters": [],
        "metrics": [
            {"id": "m1", "kind": "aggregate", "column": "amount", "aggregation": "sum", "as": "total_amt"}
        ],
        "post_aggregate": {"sort": [{"target": "total_amt", "order": "desc"}]},
    }
    v = IntentV2.model_validate(raw)
    s0 = v.post_aggregate.sort[0]
    assert s0.target == "as"
    assert s0.name == "total_amt"


def test_intent_v2_coerces_post_sort_singleton_dict():
    """LLM 常把 sort 誤為單一物件，應為陣列。"""
    raw = {
        "version": 2,
        "dimensions": {"group_by": ["col_4"]},
        "filters": [],
        "metrics": [
            {"id": "t", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "total_sales"}
        ],
        "post_aggregate": {
            "sort": {"target": "as", "name": "total_sales", "order": "desc"},
            "limit": 3,
        },
    }
    v = IntentV2.model_validate(raw)
    assert len(v.post_aggregate.sort) == 1
    assert v.post_aggregate.sort[0].name == "total_sales"


def test_intent_v2_coerces_post_sort_mistaken_where_left():
    """LLM 常把 sort 寫成帶 left 的 where 形狀。"""
    raw = {
        "version": 2,
        "dimensions": {"group_by": ["col_4"]},
        "filters": [],
        "metrics": [
            {"id": "t", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "total_sales"}
        ],
        "post_aggregate": {
            "sort": [{"left": {"type": "ref", "target": "as", "name": "total_sales"}, "order": "desc"}],
            "limit": 3,
        },
    }
    v = IntentV2.model_validate(raw)
    s0 = v.post_aggregate.sort[0]
    assert s0.target == "as"
    assert s0.name == "total_sales"
    assert s0.order == "desc"
    assert v.post_aggregate.limit == 3


def test_sql_builder_multi_group():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["a", "b"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "amount", "aggregation": "sum", "as": "s"}
            ],
        )
    )
    allow = {"a", "b", "amount"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _params, meta = built
    assert "GROUP BY" in sql and "a" in sql and "b" in sql
    assert meta["group_cols"] == ["a", "b"]


def test_sql_builder_aggregate_plus_expression():
    """aggregate 與 expression 併用時須能組出單一 SQL（含 post_aggregate 外包）。"""
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_4"],
            metrics=[
                {"id": "t", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "total_sales"},
                {
                    "id": "i",
                    "kind": "expression",
                    "expression": "SUM(col_9) / SUM(col_8)",
                    "as": "insurance_share",
                    "refs": {"columns": ["col_9", "col_8"]},
                },
            ],
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "insurance_share"},
                        "op": "gt",
                        "right": {"type": "literal", "value": 0.006},
                    },
                    {
                        "left": {"type": "ref", "target": "as", "name": "total_sales"},
                        "op": "gt",
                        "right": {"type": "literal", "value": 2_000_000},
                    },
                ]
            },
        )
    )
    allow = {"col_4", "col_8", "col_9"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert "SUM(" in sql and "col_8" in sql and "col_9" in sql
    assert "total_sales" in sql and "insurance_share" in sql
    assert "SELECT * FROM (" in sql and "2000000" in sql
    assert meta["agg_aliases"] == ["total_sales", "insurance_share"]


def test_sql_builder_aggregate_plus_expression_expands_agg_alias_in_sum():
    """expression 內 SUM(另一 metric 的 as) 須展開為視窗聚合，不可當成實體欄位。"""
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_4"],
            filters=[{"column": "col_5", "op": "eq", "value": "乳品"}],
            metrics=[
                {"id": "t", "kind": "aggregate", "column": "col_11", "aggregation": "sum", "as": "total_sales"},
                {
                    "id": "i",
                    "kind": "expression",
                    "expression": 'SUM(col_11) / SUM(total_sales)',
                    "as": "sales_ratio",
                    "refs": {"columns": ["col_11"]},
                },
            ],
            time_filter={"column": "col_1", "op": "between", "value": ["2025-03-01", "2025-03-31"]},
            post_aggregate={"limit": 1},
        )
    )
    allow = {"col_1", "col_4", "col_5", "col_11"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert "SUM(SUM(" in sql and "OVER ()" in sql
    assert "SUM(total_sales)" not in sql
    assert meta["agg_aliases"] == ["total_sales", "sales_ratio"]


def test_sql_builder_count():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["region"],
            metrics=[{"id": "m1", "kind": "aggregate", "column": "id", "aggregation": "count", "as": "cnt"}],
        )
    )
    allow = {"region", "id"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert "COUNT" in sql
    assert meta["dataset_labels"] == ["id_count"]


def test_sql_builder_dataset_label_uses_schema_first_alias():
    schema_def = {
        "columns": {
            "col_8": {"type": "num", "attr": "val", "aliases": ["營收", "col_8"]},
            "col_3": {"type": "str", "attr": "dim", "aliases": ["通路"]},
        },
        "indicators": {},
    }
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "s"}
            ],
        )
    )
    allow = {"col_3", "col_8"}
    built = try_build_sql_v2(intent, allow, schema_def)
    assert built is not None
    _sql, _, meta = built
    assert meta["dataset_labels"] == ["營收（加總）"]


def test_sql_builder_structured_filters():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "s"}
            ],
            filters=[
                {"column": "col_3", "op": "eq", "value": "momo"},
            ],
        )
    )
    allow = {"col_2", "col_3", "col_8"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, _ = built
    assert "col_3 = 'momo'" in sql


def test_sql_builder_compare_periods_no_group_sum():
    intent = IntentV2.model_validate(
        _v2(
            metrics=[
                {
                    "id": "m1",
                    "kind": "aggregate",
                    "column": "col_8",
                    "aggregation": "sum",
                    "as": "col_8",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "previous_col_8",
                        "emit_yoy_ratio": False,
                    },
                }
            ],
            compare_periods={
                "column": "col_2",
                "current": {"start": "2026-02-01", "end": "2026-02-28"},
                "previous": {"start": "2025-02-01", "end": "2025-02-28"},
            },
        )
    )
    allow = {"col_2", "col_8"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _params, meta = built
    assert "WITH current_period AS" in sql and "previous_period AS" in sql
    assert "BETWEEN '2026-02-01' AND '2026-02-28'" in sql
    assert "BETWEEN '2025-02-01' AND '2025-02-28'" in sql
    assert "CROSS JOIN" in sql
    assert "AS col_8" in sql or 'AS "col_8"' in sql
    assert "previous_col_8" in sql
    assert meta["group_cols"] == []
    assert meta["agg_aliases"] == ["col_8", "previous_col_8"]
    assert "yoy_growth" not in sql


def test_sql_builder_compare_periods_with_group_inner_join():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_6"],
            metrics=[
                {
                    "id": "m1",
                    "kind": "aggregate",
                    "column": "col_10",
                    "aggregation": "avg",
                    "as": "avg_col_10",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "previous_avg_col_10",
                        "emit_yoy_ratio": False,
                    },
                }
            ],
            filters=[{"column": "col_3", "op": "eq", "value": "台北店"}],
            compare_periods={
                "column": "col_2",
                "current": {"start": "2026-02-01", "end": "2026-02-28"},
                "previous": {"start": "2025-02-01", "end": "2025-02-28"},
            },
        )
    )
    allow = {"col_2", "col_3", "col_6", "col_10"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _params, meta = built
    assert "JOIN previous_period" in sql
    assert "col_3 = '台北店'" in sql
    assert "GROUP BY" in sql
    assert meta["group_cols"] == ["col_6"]
    assert "current_period AS" in sql and "previous_period AS" in sql
    assert "current_avg_k10" in sql


def test_sql_builder_compare_duplicate_sum_metrics_second_from_previous_cte():
    """同欄位、同 sum 的兩個 metric：CTE 僅一個 SUM；第二個輸出欄應為 p.*（非重複 c.*）。"""
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "current_sales"},
                {"id": "m2", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "previous_sales"},
            ],
            compare_periods={
                "column": "col_2",
                "current": {"start": "2026-01-01", "end": "2026-03-25"},
                "previous": {"start": "2025-01-01", "end": "2025-03-25"},
            },
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "current_sales"},
                        "op": "gt",
                        "right": {"type": "ref", "target": "as", "name": "previous_sales"},
                    }
                ]
            },
        )
    )
    allow = {"col_2", "col_3", "col_8"}
    built = try_build_sql_v2(intent, allow, None)
    assert built is not None
    sql, _, meta = built
    assert sql.count("SUM(col_8)") == 2
    assert "c.current_k8 AS current_sales" in sql
    assert "p.previous_k8 AS previous_sales" in sql
    assert "current_sales" in sql and "previous_sales" in sql and ">" in sql
    assert meta["agg_aliases"] == ["current_sales", "previous_sales"]


def test_compare_periods_blocker_bad_format():
    schema = {"columns": {"col_2": {}, "col_8": {}}, "indicators": {}}
    with pytest.raises(ValidationError):
        IntentV2.model_validate(
            {
                "version": 2,
                "dimensions": {
                    "group_by": [],
                    "compare_periods": {"column": "col_2"},
                },
                "filters": [],
                "metrics": [
                    {
                        "id": "m1",
                        "kind": "aggregate",
                        "column": "col_8",
                        "aggregation": "sum",
                        "as": "s",
                        "compare": {
                            "emit_previous": True,
                            "previous_as": "p",
                            "emit_yoy_ratio": False,
                        },
                    }
                ],
            }
        )


def test_sql_builder_formula_group_sort():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_6"],
            filters=[],
            metrics=[
                {
                    "id": "r1",
                    "kind": "expression",
                    "expression": "SUM(col_9) / COUNT(col_1)",
                    "as": "avg_insurance_p_unit",
                    "refs": {"columns": ["col_9", "col_1"]},
                }
            ],
            time_filter={"column": "col_2", "op": "between", "value": ["2026-01-01", "2026-03-25"]},
            post_aggregate={
                "sort": [{"target": "as", "name": "avg_insurance_p_unit", "order": "desc"}]
            },
        )
    )
    allow = {"col_1", "col_2", "col_6", "col_9"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _params, meta = built
    assert "SUM(" in sql
    assert "COUNT(" in sql
    assert "avg_insurance_p_unit" in sql
    assert "ORDER BY" in sql and "avg_insurance_p_unit" in sql
    assert meta["agg_aliases"] == ["avg_insurance_p_unit"]
    assert meta.get("formula") is True


def test_formula_ratio_post_aggregate_where():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_4"],
            metrics=[
                {
                    "id": "r1",
                    "kind": "expression",
                    "expression": "SUM(col_9) / SUM(col_8)",
                    "as": "col_9_ratio",
                    "refs": {"columns": ["col_8", "col_9"]},
                }
            ],
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "col_9_ratio"},
                        "op": "gt",
                        "right": {"type": "literal", "value": 0.01},
                    }
                ],
                "sort": [{"target": "as", "name": "col_9_ratio", "order": "desc"}],
            },
        )
    )
    allow = {"col_4", "col_8", "col_9"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert "SUM(" in sql and "col_9" in sql and "col_8" in sql
    assert "col_9_ratio" in sql
    assert "col_9_ratio" in sql.replace(" ", "") and "0.01" in sql
    assert meta["agg_aliases"] == ["col_9_ratio"]


def test_expression_and_compare_periods_rejected_at_validation():
    with pytest.raises(ValidationError, match="compare_periods"):
        IntentV2.model_validate(
            _v2(
                group_by=["col_4"],
                compare_periods={
                    "column": "col_2",
                    "current": {"start": "2026-02-01", "end": "2026-02-28"},
                    "previous": {"start": "2025-02-01", "end": "2025-02-28"},
                },
                metrics=[
                    {
                        "id": "r1",
                        "kind": "expression",
                        "expression": "SUM(col_8)",
                        "as": "x",
                        "refs": {"columns": ["col_8"]},
                    }
                ],
            )
        )


def test_sql_builder_post_aggregate_simple_agg():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_6"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "col_8"}
            ],
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "col_8"},
                        "op": "gt",
                        "right": {"type": "literal", "value": 100},
                    }
                ],
            },
        )
    )
    allow = {"col_6", "col_8"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert "SELECT * FROM (" in sql
    assert "col_8" in sql
    assert "100" in sql
    assert meta["agg_aliases"] == ["col_8"]


def test_sql_builder_multi_metric_post_aggregate():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_6"],
            metrics=[
                {"id": "m1", "kind": "aggregate", "column": "col_9", "aggregation": "sum", "as": "col_9"},
                {"id": "m2", "kind": "aggregate", "column": "col_12", "aggregation": "avg", "as": "avg_satisfaction"},
            ],
            filters=[{"column": "col_3", "op": "eq", "value": "台北旗艦店"}],
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "col_9"},
                        "op": "gt",
                        "right": {"type": "literal", "value": 20000},
                    },
                    {
                        "left": {"type": "ref", "target": "as", "name": "avg_satisfaction"},
                        "op": "gt",
                        "right": {"type": "literal", "value": 4},
                    },
                ],
                "sort": [{"target": "as", "name": "col_9", "order": "desc"}],
            },
        )
    )
    allow = {"col_3", "col_6", "col_9", "col_12"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert "SUM(col_9)" in sql and "AS col_9" in sql
    assert "AVG(col_12)" in sql and "avg_satisfaction" in sql
    assert "20000" in sql
    assert meta["agg_aliases"] == ["col_9", "avg_satisfaction"]


def test_compare_outer_where_two_metrics():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_6"],
            metrics=[
                {
                    "id": "m1",
                    "kind": "aggregate",
                    "column": "col_8",
                    "aggregation": "sum",
                    "as": "col_8",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "previous_col_8",
                        "emit_yoy_ratio": False,
                    },
                },
                {
                    "id": "m2",
                    "kind": "aggregate",
                    "column": "col_12",
                    "aggregation": "sum",
                    "as": "col_12",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "previous_col_12",
                        "emit_yoy_ratio": False,
                    },
                },
            ],
            compare_periods={
                "column": "col_2",
                "current": {"start": "2026-02-01", "end": "2026-02-28"},
                "previous": {"start": "2025-02-01", "end": "2025-02-28"},
            },
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "col_8"},
                        "op": "lt",
                        "right": {"type": "ref", "target": "as", "name": "previous_col_8"},
                    },
                    {
                        "left": {"type": "ref", "target": "as", "name": "col_12"},
                        "op": "gt",
                        "right": {"type": "ref", "target": "as", "name": "previous_col_12"},
                    },
                ],
            },
        )
    )
    allow = {"col_2", "col_6", "col_8", "col_12"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, _ = built
    assert " WHERE " in sql
    outer_where = sql.split(") s WHERE ", 1)[1].split(" ORDER BY")[0]
    assert "c." not in outer_where and "p." not in outer_where


def test_compare_avg_yoy_post_aggregate():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {
                    "id": "m1",
                    "kind": "aggregate",
                    "column": "col_10",
                    "aggregation": "avg",
                    "as": "avg_col_10",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "previous_avg_col_10",
                        "emit_yoy_ratio": True,
                        "yoy_as": "col_10_yoy_growth",
                    },
                }
            ],
            compare_periods={
                "column": "col_2",
                "current": {"start": "2026-01-01", "end": "2026-03-25"},
                "previous": {"start": "2025-01-01", "end": "2025-03-25"},
            },
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "avg_col_10"},
                        "op": "gt",
                        "right": {"type": "ref", "target": "as", "name": "previous_avg_col_10"},
                    },
                ],
                "sort": [{"target": "as", "name": "avg_col_10", "order": "desc"}],
            },
        )
    )
    allow = {"col_2", "col_3", "col_10"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql, _, meta = built
    assert "SELECT * FROM (" in sql
    assert "AS avg_col_10" in sql and "AS previous_avg_col_10" in sql and "AS col_10_yoy_growth" in sql
    outer_where = sql.split(") s WHERE ", 1)[1].split(" ORDER BY")[0]
    assert "avg_col_10" in outer_where and "previous_avg_col_10" in outer_where
    assert "c." not in outer_where and "p." not in outer_where
    assert meta["agg_aliases"] == [
        "avg_col_10",
        "previous_avg_col_10",
        "col_10_yoy_growth",
    ]


def test_compare_asymmetric_prev_cte_second_metric_no_compare():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_4"],
            metrics=[
                {
                    "id": "m1",
                    "kind": "aggregate",
                    "column": "col_9",
                    "aggregation": "sum",
                    "as": "col_9",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "previous_col_9",
                        "emit_yoy_ratio": True,
                        "yoy_as": "col_9_growth_rate",
                    },
                },
                {"id": "m2", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "col_8"},
            ],
            compare_periods={
                "column": "col_2",
                "current": {"start": "2026-01-01", "end": "2026-03-25"},
                "previous": {"start": "2025-01-01", "end": "2025-03-25"},
            },
            post_aggregate={
                "where": [
                    {
                        "left": {"type": "ref", "target": "as", "name": "col_9_growth_rate"},
                        "op": "is_not_null",
                    }
                ],
                "sort": [
                    {"target": "as", "name": "col_9_growth_rate", "order": "desc"},
                    {"target": "as", "name": "col_8", "order": "desc"},
                ],
            },
        )
    )
    allow = {"col_2", "col_4", "col_8", "col_9"}
    built = try_build_sql_v2(intent, allow)
    assert built is not None
    sql = built[0]
    assert "SELECT * FROM (" in sql
    assert "col_9_growth_rate" in sql and "IS NOT NULL" in sql
    assert "AS col_9_growth_rate" in sql
    assert "SUM(col_9)" in sql and "SUM(col_8)" in sql
    assert "ORDER BY col_9_growth_rate DESC" in sql and "col_8 DESC" in sql
    assert "previous_period AS" in sql
    assert sql.count("SUM(col_9)") == 2
    assert sql.count("SUM(col_8)") == 1


def test_compare_schema_aliases_short_names():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_3"],
            metrics=[
                {
                    "id": "m1",
                    "kind": "aggregate",
                    "column": "col_8",
                    "aggregation": "sum",
                    "as": "sum_col_8",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "prev_col_8",
                        "emit_yoy_ratio": False,
                    },
                },
                {
                    "id": "m2",
                    "kind": "aggregate",
                    "column": "col_12",
                    "aggregation": "avg",
                    "as": "avg_col_12",
                    "compare": {
                        "emit_previous": True,
                        "previous_as": "prev_col_12",
                        "emit_yoy_ratio": False,
                    },
                },
            ],
            compare_periods={
                "column": "col_2",
                "current": {"start": "2026-01-01", "end": "2026-03-25"},
                "previous": {"start": "2025-01-01", "end": "2025-03-25"},
            },
        )
    )
    allow = {"col_2", "col_3", "col_8", "col_12"}
    schema = {
        "columns": {
            "col_2": {"aliases": ["day"]},
            "col_3": {"aliases": ["center_name"]},
            "col_8": {"aliases": ["sales"]},
            "col_12": {"aliases": ["satisfaction"]},
        },
        "indicators": {},
    }
    built = try_build_sql_v2(intent, allow, schema)
    assert built is not None
    sql = built[0]
    assert "center_name" in sql and "current_sales" in sql and "previous_sales" in sql
    assert "current_avg_satisfaction" in sql and "previous_avg_satisfaction" in sql
    assert "JOIN previous_period p ON" in sql


def test_intent_v2_column_not_in_schema():
    intent = IntentV2.model_validate(
        _v2(
            group_by=["col_6"],
            metrics=[{"id": "m1", "kind": "aggregate", "column": "col_8", "aggregation": "sum", "as": "s"}],
        )
    )
    schema = {"columns": {k: {} for k in ("col_6", "col_8")}, "indicators": {}}
    b = intent_sql_blockers_v2(intent, schema)
    assert not b
    bad = IntentV2.model_validate(
        _v2(
            group_by=["col_6"],
            metrics=[{"id": "m1", "kind": "aggregate", "column": "col_99", "aggregation": "sum", "as": "s"}],
        )
    )
    b2 = intent_sql_blockers_v2(bad, schema)
    assert any("col_99" in x for x in b2)


def test_having_previous_without_compare_blocked():
    """無 compare 時不得出現對照期欄位需求；compare 未設會在結構驗證失敗。"""
    with pytest.raises(ValidationError):
        IntentV2.model_validate(
            _v2(
                group_by=["col_6"],
                metrics=[
                    {
                        "id": "m1",
                        "kind": "aggregate",
                        "column": "col_8",
                        "aggregation": "sum",
                        "as": "col_8",
                        "compare": {
                            "emit_previous": True,
                            "previous_as": "previous_col_8",
                            "emit_yoy_ratio": False,
                        },
                    }
                ],
            )
        )


def test_chart_from_sql_ratio_series_as_percent_display():
    import pandas as pd

    df = pd.DataFrame({"col_3": ["momo"], "sales_yoy": [-0.051470588235294115]})
    meta = {
        "group_cols": ["col_3"],
        "agg_aliases": ["sales_yoy"],
        "dataset_labels": ["銷售金額（加總）（成長率）"],
    }
    chart = chart_from_sql_dataframe(df, meta)
    assert chart["datasets"][0]["data"][0] == -5.15
    assert "（%）" in chart["datasets"][0]["label"]


def test_chart_from_sql_preserves_sum_precision_label():
    import pandas as pd

    df = pd.DataFrame({"col_3": ["momo"], "s": [1234567.891234]})
    meta = {
        "group_cols": ["col_3"],
        "agg_aliases": ["s"],
        "dataset_labels": ["銷售金額（加總）"],
    }
    chart = chart_from_sql_dataframe(df, meta)
    assert chart["datasets"][0]["data"][0] == 1234567.891234
