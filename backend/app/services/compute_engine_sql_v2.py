"""
Intent v2 → DuckDB SQL（唯一建構路徑）。
列級條件由結構化 filters 產生；聚合後條件由 post_aggregate.where 產生（必要時包一層子查詢）。
"""
from __future__ import annotations

import re
from typing import Any

from app.schemas.intent_v2 import (
    FilterCondition,
    IntentV2,
    MetricAggregateV2,
    MetricExpressionV2,
    MetricGrandShareV2,
    PostWhereClause,
    PostWhereLiteral,
    PostWhereRef,
)
from app.services.compute_engine_sql import (
    _agg_select_fragment,
    _build_compare_period_cte_alias_maps,
    _dataset_label_for_formula_alias,
    _dataset_label_for_value_spec,
    _formula_quote_allowlisted_cols,
    _growth_expr_sql,
    _sql_ident,
    column_allowlist_from_schema,
)


def _per_group_agg_sql_fragment(column: str, aggregation: str) -> str | None:
    """GROUP BY 內單欄聚合片段（與 select 內 aggregate metrics 一致）。"""
    qc = _sql_ident(column)
    if aggregation == "sum":
        return f"SUM({qc})"
    if aggregation == "avg":
        return f"AVG({qc})"
    if aggregation == "count":
        return f"COUNT({qc})"
    return None


def _expand_agg_metric_aliases_in_expression(expression: str, aggs: list[MetricAggregateV2]) -> str:
    """
    將 expression 內引用同 intent 中其他 aggregate 之 `as`（如 SUM(total_sales)）展開為視窗式加總，
    避免 DuckDB 在同層 SELECT 找不到別名或誤當成實體欄位。

    例：total_sales = SUM(col)，則 SUM(total_sales) → SUM(SUM(col)) OVER ()（全體加總，用於占比分母）。
    """
    out = expression
    for m in sorted(aggs, key=lambda x: -len(x.as_name)):
        alias = (m.as_name or "").strip()
        if not alias:
            continue
        inner = _per_group_agg_sql_fragment(m.column, m.aggregation)
        if inner is None:
            continue
        sum_over = f"SUM({inner}) OVER ()"
        avg_over = f"AVG({inner}) OVER ()"
        for pat, repl in (
            (rf'(?i)SUM\s*\(\s*"{re.escape(alias)}"\s*\)', sum_over),
            (rf"(?i)SUM\s*\(\s*{re.escape(alias)}\s*\)", sum_over),
            (rf'(?i)AVG\s*\(\s*"{re.escape(alias)}"\s*\)', avg_over),
            (rf"(?i)AVG\s*\(\s*{re.escape(alias)}\s*\)", avg_over),
        ):
            out = re.sub(pat, repl, out)
        bare = rf"(?<![\w.\"]){re.escape(alias)}(?![\w\"])"
        if re.search(bare, out):
            out = re.sub(bare, f"({sum_over})", out)
    return out


def _from_data(where_clause: str) -> str:
    """where_clause 已含 WHERE 或為空，回傳 'FROM data ' / 'FROM data WHERE ... '。"""
    if where_clause:
        return f"FROM data {where_clause} "
    return "FROM data "


def _sql_literal(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''")
    return f"'{s}'"


def _filter_condition_sql(f: FilterCondition) -> str | None:
    col = _sql_ident(f.column)
    op = f.op
    if op == "is_null":
        return f"{col} IS NULL"
    if op == "is_not_null":
        return f"{col} IS NOT NULL"
    if op == "between":
        v = f.value
        if not isinstance(v, (list, tuple)) or len(v) != 2:
            return None
        lo, hi = v[0], v[1]
        return f"({col} BETWEEN {_sql_literal(lo)} AND {_sql_literal(hi)})"
    if op == "in":
        v = f.value
        if not isinstance(v, (list, tuple)) or not v:
            return None
        inner = ", ".join(_sql_literal(x) for x in v)
        return f"{col} IN ({inner})"
    if op == "contains":
        if not isinstance(f.value, str):
            return None
        sub = f.value.strip()
        if not sub:
            return None
        lit = _sql_literal(sub)
        return f"contains(CAST({col} AS VARCHAR), {lit})"
    if f.value is None:
        return None
    rhs = _sql_literal(f.value)
    if op == "eq":
        return f"{col} = {rhs}"
    if op == "ne":
        return f"{col} <> {rhs}"
    if op == "gt":
        return f"{col} > {rhs}"
    if op == "gte":
        return f"{col} >= {rhs}"
    if op == "lt":
        return f"{col} < {rhs}"
    if op == "lte":
        return f"{col} <= {rhs}"
    return None


def _schema_column_type_lower(schema_def: dict[str, Any] | None, column: str) -> str:
    if not schema_def or not isinstance(schema_def, dict):
        return ""
    cols = schema_def.get("columns")
    if not isinstance(cols, dict):
        return ""
    meta = cols.get(column)
    if not isinstance(meta, dict):
        return ""
    return str(meta.get("type", "")).strip().lower()


def _time_filter_lhs_sql(column: str, schema_def: dict[str, Any] | None) -> str:
    """
    實務上日期常落到 DuckDB 為 VARCHAR（如 '2025-03-24 00:00:00'）；與 '2025-03-31' 做字串 BETWEEN
    在部分比較語意下會漏列。schema 標為 time 時改以 DATE 比較。
    """
    ident = _sql_ident(column)
    if _schema_column_type_lower(schema_def, column) == "time":
        return f"TRY_CAST({ident} AS DATE)"
    return ident


def _collect_filter_sql_parts(
    intent: IntentV2,
    schema_def: dict[str, Any] | None = None,
) -> list[str] | None:
    parts: list[str] = []
    for f in intent.filters:
        frag = _filter_condition_sql(f)
        if frag is None:
            return None
        parts.append(f"({frag})")
    if intent.dimensions.time_filter:
        tf = intent.dimensions.time_filter
        a, b = tf.value[0], tf.value[1]
        lhs = _time_filter_lhs_sql(tf.column, schema_def)
        if _schema_column_type_lower(schema_def, tf.column) == "time":
            parts.append(f"({lhs} BETWEEN CAST({_sql_literal(a)} AS DATE) AND CAST({_sql_literal(b)} AS DATE))")
        else:
            parts.append(f"({lhs} BETWEEN {_sql_literal(a)} AND {_sql_literal(b)})")
    return parts


def _ref_sql(r: PostWhereRef, group_cols: set[str]) -> str | None:
    if r.target == "dimension":
        if r.name not in group_cols:
            return None
        return _sql_ident(r.name)
    return _sql_ident(r.name)


def _post_where_clause_sql(
    w: PostWhereClause,
    group_cols: set[str],
    output_as: set[str],
) -> str | None:
    left_sql = _ref_sql(w.left, group_cols)
    if left_sql is None:
        return None
    if w.left.target == "as" and w.left.name not in output_as:
        return None

    op = w.op
    if op in ("is_null", "is_not_null"):
        if op == "is_null":
            return f"({left_sql} IS NULL)"
        return f"({left_sql} IS NOT NULL)"

    if w.right is None:
        return None
    if isinstance(w.right, PostWhereLiteral):
        rhs = _sql_literal(w.right.value)
    else:
        rhs = _ref_sql(w.right, group_cols)
        if rhs is None:
            return None
        if w.right.target == "as" and w.right.name not in output_as:
            return None

    sym = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}.get(op)
    if not sym:
        return None
    return f"({left_sql} {sym} {rhs})"


def _output_as_names(intent: IntentV2, include_prev_yoy: bool) -> set[str]:
    out: set[str] = set()
    for m in intent.metrics:
        if isinstance(m, MetricExpressionV2):
            out.add(m.as_name)
        elif isinstance(m, MetricGrandShareV2):
            out.add(m.as_name)
        elif isinstance(m, MetricAggregateV2):
            out.add(m.as_name)
            if include_prev_yoy and m.compare:
                if m.compare.previous_as:
                    out.add(m.compare.previous_as)
                if m.compare.yoy_as:
                    out.add(m.compare.yoy_as)
    return out


def _sort_sql_v2(intent: IntentV2, group_cols: list[str], default_as: str) -> str:
    pa = intent.post_aggregate
    group_set = set(group_cols)
    names = _output_as_names(intent, include_prev_yoy=True)
    if not pa or not pa.sort:
        return f" ORDER BY {_sql_ident(default_as)} DESC"
    parts: list[str] = []
    seen: set[str] = set()
    for s in pa.sort:
        if s.target == "dimension":
            if s.name not in group_set:
                continue
            key = s.name
        else:
            if s.name not in names:
                continue
            key = s.name
        if key in seen:
            continue
        seen.add(key)
        d = "ASC" if s.order == "asc" else "DESC"
        parts.append(f"{_sql_ident(key)} {d}")
    if not parts:
        return f" ORDER BY {_sql_ident(default_as)} DESC"
    return " ORDER BY " + ", ".join(parts)


def _limit_sql(intent: IntentV2, group_cols: list) -> str:
    pa = intent.post_aggregate
    if not pa or pa.limit is None or not group_cols:
        return ""
    return f" LIMIT {int(pa.limit)}"


def _aggregate_specs(intent: IntentV2) -> list[MetricAggregateV2]:
    return [m for m in intent.metrics if isinstance(m, MetricAggregateV2)]


def _try_build_sql_grand_share_v2(
    intent: IntentV2,
    allowlist: set[str],
    schema_def: dict[str, Any] | None,
    metrics: list[MetricGrandShareV2],
) -> tuple[str, list[Any], dict[str, Any]] | None:
    """
    全域佔比 SQL 分兩種（避免無 GROUP BY 時誤用 SUM(SUM(x)) OVER ()）：
    - **group_by 為空**：單列結果 — 分母為 `NULLIF(CAST(SUM(col) AS DOUBLE), 0)`；**不**加 ORDER BY。
    - **group_by 非空**：每組一列 — 分母為 `NULLIF(SUM(SUM(col)) OVER (), 0)`（各組分子／全體分母）；可 ORDER BY / LIMIT。
    """
    filter_parts = _collect_filter_sql_parts(intent, schema_def)
    if filter_parts is None:
        return None
    where_clause = f"WHERE {' AND '.join(filter_parts)}" if filter_parts else ""

    group_cols = list(intent.dimensions.group_by)
    for gc in group_cols:
        if gc not in allowlist:
            return None

    group_select = [f"{_sql_ident(g)} AS {_sql_ident(g)}" for g in group_cols]

    select_parts: list[str] = []
    agg_aliases: list[str] = []
    dataset_labels: list[str] = []
    for m in metrics:
        if m.column not in allowlist:
            return None
        num_frags: list[str] = []
        for f in m.numerator_filters:
            frag = _filter_condition_sql(f)
            if frag is None:
                return None
            num_frags.append(f"({frag})")
        case_pred = " AND ".join(num_frags)
        qc = _sql_ident(m.column)
        num = f"CAST(SUM(CASE WHEN {case_pred} THEN {qc} ELSE 0 END) AS DOUBLE)"
        if group_cols:
            den = f"NULLIF(SUM(SUM({qc})) OVER (), 0)"
        else:
            den = f"NULLIF(CAST(SUM({qc}) AS DOUBLE), 0)"
        expr = f"(({num}) / ({den}))"
        select_parts.append(f"{expr} AS {_sql_ident(m.as_name)}")
        agg_aliases.append(m.as_name)
        dataset_labels.append(_dataset_label_for_formula_alias(m.as_name, schema_def))

    if group_cols:
        gb_sql = ", ".join(_sql_ident(g) for g in group_cols)
        inner_sql = (
            f"SELECT {', '.join(group_select + select_parts)} "
            f"{_from_data(where_clause)}"
            f"GROUP BY {gb_sql}"
        )
    else:
        inner_sql = f"SELECT {', '.join(select_parts)} {_from_data(where_clause).rstrip()}"

    output_as = set(agg_aliases)
    group_set = set(group_cols)
    pa = intent.post_aggregate
    hav_parts: list[str] = []
    if pa and pa.where:
        for clause in pa.where:
            sql = _post_where_clause_sql(clause, group_set, output_as)
            if sql is None:
                return None
            hav_parts.append(sql)

    default_sort = agg_aliases[0] if agg_aliases else ""
    if group_cols:
        sort_lim = f"{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
    else:
        sort_lim = ""
    if hav_parts:
        sql = (
            f"SELECT * FROM ({inner_sql}) s WHERE {' AND '.join(f'({w})' for w in hav_parts)}"
            f"{sort_lim}"
        )
    else:
        sql = f"{inner_sql}{sort_lim}"

    meta: dict[str, Any] = {
        "group_cols": group_cols,
        "agg_aliases": agg_aliases,
        "dataset_labels": dataset_labels,
        "value_specs": [],
        "formula": True,
        "grand_share": True,
    }
    return sql, [], meta


def _try_build_sql_expression_v2(
    intent: IntentV2,
    allowlist: set[str],
    schema_def: dict[str, Any] | None,
    expr_m: MetricExpressionV2,
) -> tuple[str, list[Any], dict[str, Any]] | None:
    group_cols = list(intent.dimensions.group_by)
    fq = _formula_quote_allowlisted_cols(expr_m.expression, allowlist)
    if fq is None:
        return None
    q_alias = _sql_ident(expr_m.as_name)

    filter_parts = _collect_filter_sql_parts(intent, schema_def)
    if filter_parts is None:
        return None
    for gc in group_cols:
        if gc not in allowlist:
            return None
    for c in expr_m.refs["columns"]:
        if c not in allowlist:
            return None

    where_clause = f"WHERE {' AND '.join(filter_parts)}" if filter_parts else ""
    pa = intent.post_aggregate
    group_set = set(group_cols)
    output_as = {expr_m.as_name}

    select_parts: list[str] = []
    for gc in group_cols:
        select_parts.append(f"{_sql_ident(gc)} AS {_sql_ident(gc)}")
    select_parts.append(f"({fq}) AS {q_alias}")

    if group_cols:
        gb_sql = ", ".join(_sql_ident(g) for g in group_cols)
        inner = f"SELECT {', '.join(select_parts)} {_from_data(where_clause)}GROUP BY {gb_sql}"
    else:
        inner = f"SELECT {', '.join(select_parts)} {_from_data(where_clause).rstrip()}"

    outer_where: list[str] = []
    if pa and pa.where:
        for clause in pa.where:
            sql = _post_where_clause_sql(clause, group_set, output_as)
            if sql is None:
                return None
            outer_where.append(sql)

    sort_tail = _sort_sql_v2(intent, group_cols, expr_m.as_name)
    lim_tail = _limit_sql(intent, group_cols)
    if outer_where:
        sql = f"SELECT * FROM ({inner}) s WHERE {' AND '.join(f'({w})' for w in outer_where)}{sort_tail}{lim_tail}"
    else:
        sql = f"{inner}{sort_tail}{lim_tail}"

    meta: dict[str, Any] = {
        "group_cols": group_cols,
        "agg_aliases": [expr_m.as_name],
        "dataset_labels": [_dataset_label_for_formula_alias(expr_m.as_name, schema_def)],
        "value_specs": [],
        "formula": True,
    }
    return sql, [], meta


def _try_build_sql_agg_plus_expression_v2(
    intent: IntentV2,
    allowlist: set[str],
    schema_def: dict[str, Any] | None,
    aggs: list[MetricAggregateV2],
    expr_m: MetricExpressionV2,
) -> tuple[str, list[Any], dict[str, Any]] | None:
    """
    同一 GROUP BY：多個 aggregate + 一個 expression（如 SUM(col_8) 與 SUM(col_9)/SUM(col_8)）。
    不支援 compare_periods；不支援多於一個 expression。
    """
    if intent.dimensions.compare_periods is not None:
        return None
    if not aggs:
        return None
    group_cols = list(intent.dimensions.group_by)
    filter_parts = _collect_filter_sql_parts(intent, schema_def)
    if filter_parts is None:
        return None
    for gc in group_cols:
        if gc not in allowlist:
            return None
    expanded = _expand_agg_metric_aliases_in_expression(expr_m.expression, aggs)
    fq = _formula_quote_allowlisted_cols(expanded, allowlist)
    if fq is None:
        return None
    for c in expr_m.refs["columns"]:
        if c not in allowlist:
            return None

    select_parts: list[str] = []
    for gc in group_cols:
        select_parts.append(f"{_sql_ident(gc)} AS {_sql_ident(gc)}")

    agg_aliases: list[str] = []
    dataset_labels: list[str] = []
    specs: list[tuple[str, str]] = []

    for m in intent.metrics:
        if isinstance(m, MetricAggregateV2):
            if m.column not in allowlist:
                return None
            specs.append((m.column, m.aggregation))
            dataset_labels.append(_dataset_label_for_value_spec(m.column, m.aggregation, schema_def))
            if m.aggregation == "sum":
                select_parts.append(f"SUM({_sql_ident(m.column)}) AS {_sql_ident(m.as_name)}")
            elif m.aggregation == "avg":
                select_parts.append(f"AVG({_sql_ident(m.column)}) AS {_sql_ident(m.as_name)}")
            else:
                select_parts.append(f"COUNT({_sql_ident(m.column)}) AS {_sql_ident(m.as_name)}")
            agg_aliases.append(m.as_name)
        elif isinstance(m, MetricExpressionV2):
            if m.id != expr_m.id:
                return None
            select_parts.append(f"({fq}) AS {_sql_ident(m.as_name)}")
            agg_aliases.append(m.as_name)
            dataset_labels.append(_dataset_label_for_formula_alias(m.as_name, schema_def))

    where_clause = f"WHERE {' AND '.join(filter_parts)}" if filter_parts else ""
    group_set = set(group_cols)
    output_as = set(agg_aliases)

    pa = intent.post_aggregate
    hav_parts: list[str] = []
    needs_outer = bool(pa and pa.where)
    if pa and pa.where:
        for clause in pa.where:
            sql = _post_where_clause_sql(clause, group_set, output_as)
            if sql is None:
                return None
            hav_parts.append(sql)

    default_sort = agg_aliases[0] if agg_aliases else ""

    if group_cols:
        gb_sql = ", ".join(_sql_ident(g) for g in group_cols)
        inner_sql = f"SELECT {', '.join(select_parts)} {_from_data(where_clause)}GROUP BY {gb_sql}"
        if not needs_outer:
            sort_lim = f"{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
            sql = f"{inner_sql}{sort_lim}"
        else:
            sql = (
                f"SELECT * FROM ({inner_sql}) s WHERE {' AND '.join(f'({w})' for w in hav_parts)}"
                f"{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
            )
    else:
        inner_sql = f"SELECT {', '.join(select_parts)} {_from_data(where_clause).rstrip()}"
        if not needs_outer:
            sql = f"{inner_sql}{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
        else:
            sql = (
                f"SELECT * FROM ({inner_sql}) s WHERE {' AND '.join(f'({w})' for w in hav_parts)}"
                f"{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
            )

    meta: dict[str, Any] = {
        "group_cols": group_cols,
        "agg_aliases": agg_aliases,
        "dataset_labels": dataset_labels,
        "value_specs": specs,
        "formula": True,
    }
    return sql, [], meta


def _try_build_sql_simple_aggregate_v2(
    intent: IntentV2,
    allowlist: set[str],
    schema_def: dict[str, Any] | None,
) -> tuple[str, list[Any], dict[str, Any]] | None:
    aggs = _aggregate_specs(intent)
    if not aggs:
        return None
    group_cols = list(intent.dimensions.group_by)
    filter_parts = _collect_filter_sql_parts(intent, schema_def)
    if filter_parts is None:
        return None
    for m in aggs:
        if m.column not in allowlist:
            return None
    for gc in group_cols:
        if gc not in allowlist:
            return None

    output_aliases = [m.as_name for m in aggs]
    agg_aliases = list(output_aliases)
    dataset_labels: list[str] = []
    select_parts: list[str] = []
    for gc in group_cols:
        select_parts.append(f"{_sql_ident(gc)} AS {_sql_ident(gc)}")
    specs: list[tuple[str, str]] = []
    for m in aggs:
        specs.append((m.column, m.aggregation))
        dataset_labels.append(_dataset_label_for_value_spec(m.column, m.aggregation, schema_def))
        if m.aggregation == "sum":
            select_parts.append(f"SUM({_sql_ident(m.column)}) AS {_sql_ident(m.as_name)}")
        elif m.aggregation == "avg":
            select_parts.append(f"AVG({_sql_ident(m.column)}) AS {_sql_ident(m.as_name)}")
        else:
            select_parts.append(f"COUNT({_sql_ident(m.column)}) AS {_sql_ident(m.as_name)}")

    where_clause = f"WHERE {' AND '.join(filter_parts)}" if filter_parts else ""
    group_set = set(group_cols)
    output_as = set(agg_aliases)

    pa = intent.post_aggregate
    hav_parts: list[str] = []
    needs_outer = bool(pa and pa.where)
    if pa and pa.where:
        for clause in pa.where:
            sql = _post_where_clause_sql(clause, group_set, output_as)
            if sql is None:
                return None
            hav_parts.append(sql)

    default_sort = agg_aliases[0] if agg_aliases else ""

    if group_cols:
        gb_sql = ", ".join(_sql_ident(g) for g in group_cols)
        inner_sql = f"SELECT {', '.join(select_parts)} {_from_data(where_clause)}GROUP BY {gb_sql}"
        if not needs_outer:
            sort_lim = f"{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
            sql = f"{inner_sql}{sort_lim}"
        else:
            sql = (
                f"SELECT * FROM ({inner_sql}) s WHERE {' AND '.join(f'({w})' for w in hav_parts)}"
                f"{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
            )
    else:
        inner_sql = f"SELECT {', '.join(select_parts)} {_from_data(where_clause).rstrip()}"
        if not needs_outer:
            sql = inner_sql
        else:
            sql = (
                f"SELECT * FROM ({inner_sql}) s WHERE {' AND '.join(f'({w})' for w in hav_parts)}"
                f"{_sort_sql_v2(intent, group_cols, default_sort)}{_limit_sql(intent, group_cols)}"
            )

    meta = {
        "group_cols": group_cols,
        "agg_aliases": agg_aliases,
        "dataset_labels": dataset_labels,
        "value_specs": specs,
    }
    return sql, [], meta


def _try_build_sql_compare_v2(
    intent: IntentV2,
    allowlist: set[str],
    schema_def: dict[str, Any] | None,
) -> tuple[str, list[Any], dict[str, Any]] | None:
    cp = intent.dimensions.compare_periods
    if cp is None:
        return None
    aggs = _aggregate_specs(intent)
    if not aggs:
        return None
    group_cols = list(intent.dimensions.group_by)
    date_col = cp.column
    cur_lo, cur_hi = cp.current.start, cp.current.end
    cmp_lo, cmp_hi = cp.previous.start, cp.previous.end

    filter_parts = _collect_filter_sql_parts(intent, schema_def)
    if filter_parts is None:
        return None
    # 兩期：列級 filters 不重複套用日期（與舊版一致交由 CTE 日期）
    for gc in group_cols:
        if gc not in allowlist:
            return None
    for m in aggs:
        if m.column not in allowlist:
            return None
    if date_col not in allowlist:
        return None

    # CTE 內每個 (column, aggregation) 只聚合一次；重複 metric（同欄同聚合、不同 as）改在外層對 c./p. 映射
    cte_specs: list[tuple[str, str]] = []
    _seen_spec: set[tuple[str, str]] = set()
    for m in aggs:
        sp = (m.column, m.aggregation)
        if sp in _seen_spec:
            continue
        _seen_spec.add(sp)
        cte_specs.append(sp)

    group_dim_aliases, metric_aliases = _build_compare_period_cte_alias_maps(
        schema_def, group_cols, cte_specs
    )

    needs_prev = {
        m.column
        for m in aggs
        if m.compare and (m.compare.emit_previous or m.compare.emit_yoy_ratio)
    }
    if not needs_prev:
        needs_prev = {m.column for m in aggs}

    def period_where(lo: str, hi: str) -> str:
        period = f"({_sql_ident(date_col)} BETWEEN {_sql_literal(lo)} AND {_sql_literal(hi)})"
        if not filter_parts:
            return f"WHERE {period}"
        return f"WHERE {' AND '.join(filter_parts)} AND {period}"

    cur_sel_parts: list[str] = []
    cmp_sel_parts: list[str] = []
    for gc in group_cols:
        gdim = group_dim_aliases[gc]
        gq = _sql_ident(gc)
        cur_sel_parts.append(f"{gq} AS {_sql_ident(gdim)}")
        cmp_sel_parts.append(f"{gq} AS {_sql_ident(gdim)}")
    for col, agg in cte_specs:
        ca, _pa = metric_aliases[col]
        cur_sel_parts.append(_agg_select_fragment(col, agg, ca, plain_ident=True))
    for col, agg in cte_specs:
        if col not in needs_prev:
            continue
        _ca, pa = metric_aliases[col]
        cmp_sel_parts.append(_agg_select_fragment(col, agg, pa, plain_ident=True))

    gb_clause = ""
    if group_cols:
        gb_sql = ", ".join(_sql_ident(g) for g in group_cols)
        gb_clause = f" GROUP BY {gb_sql}"

    cte_curr = (
        f"current_period AS ( SELECT {', '.join(cur_sel_parts)} FROM data "
        f"{period_where(cur_lo, cur_hi)}{gb_clause} )"
    )
    cte_prev = (
        f"previous_period AS ( SELECT {', '.join(cmp_sel_parts)} FROM data "
        f"{period_where(cmp_lo, cmp_hi)}{gb_clause} )"
    )

    if group_cols:
        on_conds = " AND ".join(
            f"c.{_sql_ident(group_dim_aliases[g])} = p.{_sql_ident(group_dim_aliases[g])}"
            for g in group_cols
        )
        join_sql = f"FROM current_period c JOIN previous_period p ON {on_conds}"
    else:
        join_sql = "FROM current_period c CROSS JOIN previous_period p"

    out_sel: list[str] = []
    if group_cols:
        for g in group_cols:
            gdim = group_dim_aliases[g]
            out_sel.append(f"c.{_sql_ident(gdim)} AS {_sql_ident(g)}")
    agg_aliases_out: list[str] = []
    dataset_labels_out: list[str] = []
    spec_ordinal: dict[tuple[str, str], int] = {}
    for m in aggs:
        ca, pa = metric_aliases[m.column]
        base = _dataset_label_for_value_spec(m.column, m.aggregation, schema_def)
        key_sa = (m.column, m.aggregation)
        u = spec_ordinal.get(key_sa, 0)
        spec_ordinal[key_sa] = u + 1

        if u == 0:
            out_sel.append(f"c.{ca} AS {_sql_ident(m.as_name)}")
            agg_aliases_out.append(m.as_name)
            dataset_labels_out.append(f"{base}（本期）")
        else:
            # 同欄同聚合第二筆起：對照期（常見於 LLM 拆成兩個 metric 而未設 compare.emit_previous）
            out_sel.append(f"p.{pa} AS {_sql_ident(m.as_name)}")
            agg_aliases_out.append(m.as_name)
            dataset_labels_out.append(f"{base}（對照期）")

        if m.compare and m.compare.emit_previous and u == 0:
            p_as = m.compare.previous_as or ""
            out_sel.append(f"p.{pa} AS {_sql_ident(p_as)}")
            agg_aliases_out.append(p_as)
            dataset_labels_out.append(f"{base}（對照期）")
        if m.compare and m.compare.emit_yoy_ratio and u == 0:
            y_as = m.compare.yoy_as or ""
            out_sel.append(f"{_growth_expr_sql('c', ca, 'p', pa)} AS {_sql_ident(y_as)}")
            agg_aliases_out.append(y_as)
            dataset_labels_out.append(f"{base}（成長率）")

    inner_select = f"SELECT {', '.join(out_sel)} {join_sql}"

    group_set = set(group_cols)
    output_as = _output_as_names(intent, include_prev_yoy=True)
    hav_parts: list[str] = []
    pa = intent.post_aggregate
    if pa and pa.where:
        for clause in pa.where:
            sql = _post_where_clause_sql(clause, group_set, output_as)
            if sql is None:
                return None
            hav_parts.append(sql)

    order_sql = _sort_sql_v2(intent, group_cols, agg_aliases_out[0] if agg_aliases_out else "")
    limit_sql = _limit_sql(intent, group_cols)

    if hav_parts:
        sql = (
            f"WITH {cte_curr}, {cte_prev} "
            f"SELECT * FROM ({inner_select}) s"
            f" WHERE {' AND '.join(f'({w})' for w in hav_parts)}"
            f"{order_sql}{limit_sql}"
        )
    else:
        sql = f"WITH {cte_curr}, {cte_prev} {inner_select}{order_sql}{limit_sql}"

    meta = {
        "group_cols": group_cols,
        "agg_aliases": agg_aliases_out,
        "dataset_labels": dataset_labels_out,
        "value_specs": cte_specs,
        "compare_periods": True,
    }
    return sql, [], meta


def try_build_sql_v2(
    intent: IntentV2,
    allowlist: set[str],
    schema_def: dict[str, Any] | None = None,
) -> tuple[str, list[Any], dict[str, Any]] | None:
    grand = [m for m in intent.metrics if isinstance(m, MetricGrandShareV2)]
    if grand:
        return _try_build_sql_grand_share_v2(intent, allowlist, schema_def, grand)

    exprs = [m for m in intent.metrics if isinstance(m, MetricExpressionV2)]
    aggs = [m for m in intent.metrics if isinstance(m, MetricAggregateV2)]
    if exprs and aggs:
        if len(exprs) != 1:
            return None
        return _try_build_sql_agg_plus_expression_v2(intent, allowlist, schema_def, aggs, exprs[0])
    if exprs:
        if len(exprs) != 1:
            return None
        return _try_build_sql_expression_v2(intent, allowlist, schema_def, exprs[0])
    if intent.dimensions.compare_periods is not None:
        return _try_build_sql_compare_v2(intent, allowlist, schema_def)
    return _try_build_sql_simple_aggregate_v2(intent, allowlist, schema_def)
