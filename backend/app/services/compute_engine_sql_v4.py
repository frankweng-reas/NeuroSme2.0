"""
Intent v4.0 → DuckDB SQL。

**規範 SSOT**：`docs/intent_v4_protocol.md`。

## metric 三種類型（由 group_override 決定）

| group_override | 類型   | CTE             | 合併方式        |
|----------------|--------|-----------------|-----------------|
| None（省略）   | normal | GROUP BY 所有 dims.groups | FULL OUTER JOIN |
| []             | scalar | 無 GROUP BY（純量 CTE）   | CROSS JOIN      |
| ["col_x", …]  | subset | GROUP BY 子集 dims         | LEFT JOIN       |

## SQL 架構（calculate 模式）

```
WITH
  cte_m1 AS (... GROUP BY col_5, col_4),   ← normal
  cte_m2 AS (... GROUP BY col_5),           ← subset
  cte_m3 AS (... /* 無 GROUP BY */),        ← scalar
SELECT * FROM (
  SELECT mrg.*, derived_expr AS alias
  FROM (
    SELECT COALESCE(t0._g0,…) AS dim_0,
           COALESCE(t0._g1,…) AS dim_1,
           t0.m1_alias, s0.m2_alias, w0.m3_alias
    FROM cte_m1 t0
    FULL OUTER JOIN cte_m1b t1 ON t0._g0=t1._g0 AND t0._g1=t1._g1
    LEFT JOIN cte_m2 s0 ON t0._g0 = s0._g0
    CROSS JOIN cte_m3 w0
  ) AS mrg
) AS v0
[WHERE ...] [ORDER BY ...] [LIMIT ...]
```
"""
from __future__ import annotations

import re
from collections import defaultdict, deque
from typing import Any

from app.schemas.intent_v4 import FilterClauseV4, IntentV4, MetricV4
from app.services.compute_engine_sql import (
    _dataset_label_for_formula_alias,
    _sql_ident,
    column_allowlist_from_schema,
)


def _schema_column_type_lower(schema_def: dict[str, Any] | None, col: str) -> str:
    """回傳 schema 中欄位 attr 小寫，如 'dim_time' → 'dim_time'；找不到回傳空字串。"""
    if not schema_def or not isinstance(schema_def.get("columns"), dict):
        return ""
    meta = schema_def["columns"].get(col)
    if not isinstance(meta, dict):
        return ""
    attr = (meta.get("attr") or "").strip().lower()
    # dim_time 欄位在 filter 時需要 CAST AS DATE
    if attr == "dim_time":
        return "time"
    return attr


def _sql_literal(v: Any) -> str:
    """將 Python 值轉為 DuckDB SQL 字面量（字串加單引號、數字直接輸出）。"""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


def _time_filter_lhs_sql(col_sql: str) -> str:
    """時間欄位 filter 左側：TRY_CAST(col AS DATE)。"""
    return f"TRY_CAST({col_sql} AS DATE)"

_GROUP_FN = re.compile(
    r"^\s*([A-Za-z_][a-zA-Z0-9_]*)\s*\(\s*(col_[a-zA-Z0-9_]+)\s*\)\s*$",
    re.IGNORECASE,
)
_ATOMIC_AGG = re.compile(
    r"^\s*([A-Za-z_][a-zA-Z0-9_]*)\s*\(\s*(col_[a-zA-Z0-9_]+)\s*\)\s*$",
    re.IGNORECASE,
)
_COUNT_DISTINCT_AGG = re.compile(
    r"^\s*COUNT\s*\(\s*DISTINCT\s+(col_[a-zA-Z0-9_]+)\s*\)\s*$",
    re.IGNORECASE,
)
_METRIC_REF = re.compile(r"\bm\d+\b", re.IGNORECASE)

_ALLOWED_GROUP_FN = frozenset({"MONTH", "YEAR", "QUARTER"})
_ALLOWED_ATOMIC_AGG = frozenset({"SUM", "AVG", "COUNT", "MIN", "MAX"})

# metric 類型常數
_NORMAL = "normal"   # group_override=None → 使用所有 dims.groups
_SCALAR = "scalar"   # group_override=[]  → 無 GROUP BY
_SUBSET = "subset"   # group_override=[..] → 部分 dims.groups


def _filter_clause_sql(
    f: FilterClauseV4,
    schema_def: dict[str, Any] | None,
    *,
    table_alias: str | None = None,
) -> str | None:
    c0 = f.col.strip()
    is_time = _schema_column_type_lower(schema_def, c0) == "time"
    raw_col = (
        f"{_sql_ident(table_alias)}.{_sql_ident(c0)}"
        if table_alias
        else _sql_ident(c0)
    )
    typed_col = f"TRY_CAST({raw_col} AS DATE)" if is_time else raw_col
    op = f.op
    if op == "is_null":
        return f"{raw_col} IS NULL"
    if op == "is_not_null":
        return f"{raw_col} IS NOT NULL"
    if op == "between":
        v = f.val
        if not isinstance(v, (list, tuple)) or len(v) != 2:
            return None
        lo, hi = v[0], v[1]
        if is_time:
            return (
                f"{typed_col} BETWEEN CAST({_sql_literal(lo)} AS DATE) "
                f"AND CAST({_sql_literal(hi)} AS DATE)"
            )
        return f"{typed_col} BETWEEN {_sql_literal(lo)} AND {_sql_literal(hi)}"
    if op == "in":
        v = f.val
        if not isinstance(v, (list, tuple)) or not v:
            return None
        vals_sql = ", ".join(_sql_literal(x) for x in v)
        return f"{raw_col} IN ({vals_sql})"
    if op == "contains":
        if not isinstance(f.val, str):
            return None
        sub = f.val.strip()
        if not sub:
            return None
        return f"contains(CAST({raw_col} AS VARCHAR), {_sql_literal(sub)})"
    if f.val is None:
        return None
    _OP_MAP = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    sql_op = _OP_MAP.get(op)
    if sql_op is None:
        return None
    if is_time:
        return f"{typed_col} {sql_op} CAST({_sql_literal(f.val)} AS DATE)"
    return f"{raw_col} {sql_op} {_sql_literal(f.val)}"


def _where_from_clauses(
    clauses: list[FilterClauseV4],
    schema_def: dict[str, Any] | None,
) -> str | None:
    parts: list[str] = []
    for c in clauses:
        frag = _filter_clause_sql(c, schema_def)
        if frag is None:
            return None
        parts.append(f"({frag})")
    if not parts:
        return ""
    return " WHERE " + " AND ".join(parts)


def _group_expr_sql(raw: str, allowlist: set[str], schema_def: dict[str, Any] | None) -> str | None:
    s = raw.strip()
    m = _GROUP_FN.match(s)
    if m:
        fn, col = m.group(1).upper(), m.group(2)
        if fn not in _ALLOWED_GROUP_FN or col not in allowlist:
            return None
        ident = _sql_ident(col)
        cast_date = f"TRY_CAST({ident} AS DATE)"
        if fn == "MONTH":
            return f"CAST(EXTRACT(MONTH FROM {cast_date}) AS INTEGER)"
        if fn == "YEAR":
            return f"CAST(EXTRACT(YEAR FROM {cast_date}) AS INTEGER)"
        if fn == "QUARTER":
            return f"CAST(EXTRACT(QUARTER FROM {cast_date}) AS INTEGER)"
        return None
    if s in allowlist:
        return _sql_ident(s)
    return None


def _parse_atomic_agg(metric: MetricV4) -> tuple[str, str] | None:
    """解析 atomic formula，回傳 (agg_call_sql, col)。
    支援：SUM(col_x)、COUNT(DISTINCT col_x)。
    agg_call_sql 是完整的 SQL 片段（已含 DISTINCT 關鍵字）。
    """
    # COUNT(DISTINCT col_x)
    md = _COUNT_DISTINCT_AGG.match(metric.formula)
    if md:
        col = md.group(1)
        return f"COUNT(DISTINCT {_sql_ident(col)})", col
    # 一般 AGG(col_x)
    m = _ATOMIC_AGG.match(metric.formula)
    if not m:
        return None
    fn, col = m.group(1).upper(), m.group(2)
    if fn not in _ALLOWED_ATOMIC_AGG:
        return None
    return fn, col


def _formula_deps(formula: str) -> set[str]:
    return {x.lower() for x in _METRIC_REF.findall(formula)}


def _subst_formula_to_sql(
    formula: str,
    id_to_alias: dict[str, str],
    *,
    qualify_table: str | None = None,
) -> str:
    s = str(formula).strip()
    ids = sorted(_formula_deps(s), key=len, reverse=True)
    for mid in ids:
        al = id_to_alias.get(mid.lower())
        if not al:
            continue
        col = _sql_ident(al)
        if qualify_table:
            repl = f"CAST({_sql_ident(qualify_table)}.{col} AS DOUBLE)"
        else:
            repl = f"CAST({col} AS DOUBLE)"
        s = re.sub(rf"\b{re.escape(mid)}\b", repl, s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip()


def _divide_num_den(formula: str) -> tuple[str | None, str | None]:
    s = formula.strip()
    if "/" not in s:
        return None, None
    depth = 0
    split_at = -1
    for i, ch in enumerate(s):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "/" and depth == 0:
            split_at = i
            break
    if split_at < 0:
        return None, None
    return s[:split_at].strip(), s[split_at + 1:].strip()


def _derived_expr_for_formula(
    formula: str,
    id_to_alias: dict[str, str],
    *,
    qualify_table: str | None = None,
) -> str:
    num_d, den_d = _divide_num_den(formula)
    if num_d and den_d:
        num_sql = _subst_formula_to_sql(num_d, id_to_alias, qualify_table=qualify_table)
        den_sql = _subst_formula_to_sql(den_d, id_to_alias, qualify_table=qualify_table)
        return f"({num_sql} / NULLIF({den_sql}, 0))"
    return _subst_formula_to_sql(formula, id_to_alias, qualify_table=qualify_table)


def _topo_derived(derived_ids: list[str], deps_map: dict[str, set[str]]) -> list[str] | None:
    indeg: dict[str, int] = {i: 0 for i in derived_ids}
    adj: dict[str, list[str]] = defaultdict(list)
    for v in derived_ids:
        for u in deps_map[v]:
            if u in derived_ids:
                adj[u].append(v)
                indeg[v] += 1
    q = deque([x for x in derived_ids if indeg[x] == 0])
    out: list[str] = []
    while q:
        u = q.popleft()
        out.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(out) != len(derived_ids):
        return None
    return out


def _metric_kind(metric: MetricV4) -> str:
    """判斷 metric 類型：normal / scalar / subset。"""
    if metric.group_override is None:
        return _NORMAL
    if len(metric.group_override) == 0:
        return _SCALAR
    return _SUBSET


def _subset_dim_indices(metric: MetricV4, group_raw: list[str]) -> list[int]:
    """回傳 subset metric 在 dims.groups 中的對應索引。"""
    raw_stripped = [r.strip() for r in group_raw]
    indices: list[int] = []
    for g in metric.group_override or []:
        try:
            idx = raw_stripped.index(g.strip())
            indices.append(idx)
        except ValueError:
            pass
    return sorted(indices)


def _collect_col_refs(intent: IntentV4) -> set[str]:
    """收集 intent 中所有 col_* 欄位引用（不含 metric alias / id）。"""
    _COL_RE = re.compile(r"\bcol_[a-zA-Z0-9_]+\b")
    cols: set[str] = set()

    for g in intent.dims.groups:
        cols.update(_COL_RE.findall(g))

    for f in intent.filters:
        if f.col.startswith("col_"):
            cols.add(f.col)

    for m in intent.metrics:
        cols.update(_COL_RE.findall(m.formula))
        for f in m.filters:
            if f.col.startswith("col_"):
                cols.add(f.col)
        for g in (m.group_override or []):
            if g.startswith("col_"):
                cols.add(g)

    for c in (intent.select or []):
        if c.startswith("col_"):
            cols.add(c)

    pp = intent.post_process
    if pp:
        for s in (pp.sort or []):
            if s.col.startswith("col_"):
                cols.add(s.col)
        if pp.where and pp.where.col.startswith("col_"):
            cols.add(pp.where.col)

    return cols


def try_build_sql_v4(
    intent: IntentV4,
    schema_def: dict[str, Any],
) -> tuple[str, list[Any], dict[str, Any]] | None:
    allow = column_allowlist_from_schema(schema_def)
    if not allow:
        return None

    unknown = _collect_col_refs(intent) - allow
    if unknown:
        raise ValueError(
            f"intent 包含不存在於此資料集的欄位：{', '.join(sorted(unknown))}。"
            "請確認欄位代碼是否正確（如 col_1, col_3）；"
            "範例中的 col_91–col_97 為示範假欄位，不可直接使用。"
        )

    if intent.mode == "list":
        return _build_list_sql(intent, allow, schema_def)
    return _build_calculate_sql(intent, allow, schema_def)

# ─── list mode ────────────────────────────────────────────────────────────────

def _build_list_sql(
    intent: IntentV4,
    allow: set[str],
    schema_def: dict[str, Any],
) -> tuple[str, list[Any], dict[str, Any]] | None:
    for c in intent.select:
        if c not in allow:
            return None
    clauses: list[FilterClauseV4] = []
    clauses.extend(intent.filters)
    pp = intent.post_process
    if pp and pp.where is not None:
        clauses.append(pp.where)
    where_sql = _where_from_clauses(clauses, schema_def)
    if where_sql is None:
        return None
    cols_sql = ", ".join(_sql_ident(c) for c in intent.select)
    order = ""
    if pp and pp.sort:
        ob: list[str] = []
        for s in pp.sort:
            if s.col not in allow:
                return None
            ob.append(f"{_sql_ident(s.col)} {s.order.upper()}")
        order = " ORDER BY " + ", ".join(ob)
    lim = 100
    if pp and pp.limit is not None:
        lim = min(pp.limit, 100)
    sql = f"SELECT {cols_sql} FROM data{where_sql}{order} LIMIT {lim}"
    meta = {
        "mode": "list",
        "select_cols": list(intent.select),
        "group_cols": [],
        "agg_aliases": list(intent.select),
        "dataset_labels": [str(c) for c in intent.select],
        "is_list": True,
    }
    return sql, [], meta


# ─── calculate mode ───────────────────────────────────────────────────────────

def _build_calculate_sql(
    intent: IntentV4,
    allow: set[str],
    schema_def: dict[str, Any],
) -> tuple[str, list[Any], dict[str, Any]] | None:
    group_raw = list(intent.dims.groups)
    group_sql: list[str] = []
    for g in group_raw:
        ge = _group_expr_sql(g, allow, schema_def)
        if ge is None:
            return None
        group_sql.append(ge)

    id_to_metric = {m.id.strip().lower(): m for m in intent.metrics}
    id_to_alias = {m.id.strip().lower(): m.alias for m in intent.metrics}

    # ── 分類 metric ──────────────────────────────────────────────
    atomic_ids: list[str] = []
    derived_ids: list[str] = []
    atomic_col_by_id: dict[str, str] = {}
    agg_call_by_id: dict[str, str] = {}   # 完整 SQL 聚合呼叫，如 SUM("col_11") 或 COUNT(DISTINCT "col_3")
    kind_by_id: dict[str, str] = {}

    for m in intent.metrics:
        mid = m.id.strip().lower()
        parsed = _parse_atomic_agg(m)
        if parsed is None:
            derived_ids.append(mid)
        else:
            agg_call_or_fn, col = parsed
            if col not in allow:
                raise ValueError(
                    f"metric '{m.id}' 的 formula 使用了不存在於 schema 的欄位 '{col}'。"
                    f"請確認欄位名稱（如 col_1, col_11），範例中的 col_x/col_b 等為佔位符，必須替換為真實欄位。"
                )
            atomic_ids.append(mid)
            atomic_col_by_id[mid] = col
            # COUNT(DISTINCT ...) 已包含完整 SQL；一般 AGG 需補欄位識別字
            if "DISTINCT" in agg_call_or_fn.upper():
                agg_call_by_id[mid] = agg_call_or_fn
            else:
                agg_call_by_id[mid] = f"{agg_call_or_fn}({_sql_ident(col)})"
            kind_by_id[mid] = _metric_kind(m)

    deps_map: dict[str, set[str]] = {}
    for mid in derived_ids:
        m = id_to_metric[mid]
        deps = _formula_deps(m.formula)
        if deps - set(id_to_alias.keys()):
            return None
        deps_map[mid] = deps
    for mid in atomic_ids:
        deps_map[mid] = set()

    topo_d = _topo_derived(derived_ids, deps_map) if derived_ids else []
    if derived_ids and topo_d is None:
        return None
    if not atomic_ids:
        return None

    # ── 依類型分組 ───────────────────────────────────────────────
    normal_ids = [aid for aid in atomic_ids if kind_by_id[aid] == _NORMAL]
    scalar_ids = [aid for aid in atomic_ids if kind_by_id[aid] == _SCALAR]
    subset_ids = [aid for aid in atomic_ids if kind_by_id[aid] == _SUBSET]

    # ── 建立 CTE ─────────────────────────────────────────────────
    ctes: list[str] = []
    cte_safe_by_id: dict[str, str] = {}

    def _build_one_cte(aid: str, eff_group_sql: list[str]) -> None:
        m = id_to_metric[aid]
        wh = _where_from_clauses(list(m.filters), schema_def)
        if wh is None:
            raise ValueError(f"metric {aid} 過濾條件無法轉譯")
        agg_call = agg_call_by_id[aid]
        agg_alias = _sql_ident(m.alias)
        safe = re.sub(r"[^a-zA-Z0-9_]", "_", m.id) or "m"
        cte_safe_by_id[aid] = safe
        if eff_group_sql:
            gs = ", ".join(f"{ex} AS _g{i}" for i, ex in enumerate(eff_group_sql))
            gb = ", ".join(eff_group_sql)
            ctes.append(
                f"cte_{safe} AS (SELECT {gs}, {agg_call} AS {agg_alias} FROM data{wh} GROUP BY {gb})"
            )
        else:
            ctes.append(f"cte_{safe} AS (SELECT {agg_call} AS {agg_alias} FROM data{wh})")

    try:
        for aid in normal_ids:
            _build_one_cte(aid, group_sql)

        for aid in subset_ids:
            m = id_to_metric[aid]
            indices = _subset_dim_indices(m, group_raw)
            eff = [group_sql[i] for i in indices]
            _build_one_cte(aid, eff)

        for aid in scalar_ids:
            _build_one_cte(aid, [])
    except ValueError:
        return None

    # ── 建立 merge_sql ────────────────────────────────────────────
    # 優先以 normal metrics 為 anchor；若無，以第一個 subset metric 為 anchor。
    anchor_ids = normal_ids if normal_ids else (subset_ids[:1] if subset_ids else [])
    if not anchor_ids and scalar_ids:
        # 全是 scalar → 無維度，直接 CROSS JOIN 所有 scalar
        merge_sel = [
            f"w{k}.{_sql_ident(id_to_alias[aid])}"
            for k, aid in enumerate(scalar_ids)
        ]
        first = f"cte_{cte_safe_by_id[scalar_ids[0]]} w0"
        join_parts = [first]
        for k in range(1, len(scalar_ids)):
            join_parts.append(
                f"CROSS JOIN cte_{cte_safe_by_id[scalar_ids[k]]} w{k}"
            )
        merge_sql = f"SELECT {', '.join(merge_sel)} FROM " + " ".join(join_parts)
    else:
        # dim_ 欄從 anchor metrics 的 _g{i} COALESCE 而來
        n_dims = len(group_sql) if normal_ids else (
            len(_subset_dim_indices(id_to_metric[anchor_ids[0]], group_raw)) if anchor_ids else 0
        )
        sel_dims: list[str] = []
        for i in range(n_dims):
            parts = [f"t{j}._g{i}" for j in range(len(anchor_ids))]
            sel_dims.append(f"COALESCE({', '.join(parts)}) AS dim_{i}")

        merge_sel = list(sel_dims)

        for j, aid in enumerate(anchor_ids):
            al = _sql_ident(id_to_alias[aid])
            merge_sel.append(f"t{j}.{al} AS {al}")

        # subset metrics（s0, s1, …）
        for k, aid in enumerate(subset_ids):
            al = _sql_ident(id_to_alias[aid])
            merge_sel.append(f"s{k}.{al} AS {al}")

        # scalar metrics（w0, w1, …）
        for k, aid in enumerate(scalar_ids):
            al = _sql_ident(id_to_alias[aid])
            merge_sel.append(f"w{k}.{al} AS {al}")

        # FROM / JOIN
        join_parts: list[str] = []
        join_parts.append(f"cte_{cte_safe_by_id[anchor_ids[0]]} t0")
        for j in range(1, len(anchor_ids)):
            aid = anchor_ids[j]
            on_parts = [f"t0._g{i} = t{j}._g{i}" for i in range(n_dims)]
            jc = " AND ".join(on_parts) if on_parts else "TRUE"
            join_parts.append(f"FULL OUTER JOIN cte_{cte_safe_by_id[aid]} t{j} ON {jc}")

        for k, aid in enumerate(subset_ids):
            m = id_to_metric[aid]
            indices = _subset_dim_indices(m, group_raw)
            on_parts = [f"t0._g{i} = s{k}._g{ri}" for ri, i in enumerate(indices)]
            jc = " AND ".join(on_parts) if on_parts else "TRUE"
            join_parts.append(f"LEFT JOIN cte_{cte_safe_by_id[aid]} s{k} ON {jc}")

        for k, aid in enumerate(scalar_ids):
            join_parts.append(f"CROSS JOIN cte_{cte_safe_by_id[aid]} w{k}")

        merge_sql = f"SELECT {', '.join(merge_sel)} FROM " + " ".join(join_parts)

    # ── 衍生指標投影 ──────────────────────────────────────────────
    atomic_id_set = set(atomic_ids)
    derived_depends_only_atom = bool(topo_d) and all(
        deps_map[d] <= atomic_id_set for d in topo_d
    )
    v0, mrg = "v0", "mrg"
    row_alias = v0

    if not topo_d:
        inner = merge_sql
    elif derived_depends_only_atom:
        proj: list[str] = []
        if normal_ids or subset_ids:
            n_d = len(group_sql) if normal_ids else len(
                _subset_dim_indices(id_to_metric[anchor_ids[0]], group_raw) if anchor_ids else []
            )
            for i in range(n_d):
                proj.append(f"{_sql_ident(mrg)}.{_sql_ident(f'dim_{i}')}")
        for aid in anchor_ids:
            proj.append(f"{_sql_ident(mrg)}.{_sql_ident(id_to_alias[aid])}")
        for aid in subset_ids:
            proj.append(f"{_sql_ident(mrg)}.{_sql_ident(id_to_alias[aid])}")
        for aid in scalar_ids:
            proj.append(f"{_sql_ident(mrg)}.{_sql_ident(id_to_alias[aid])}")
        for mid in topo_d:
            m = id_to_metric[mid]
            expr_sql = _derived_expr_for_formula(m.formula, id_to_alias, qualify_table=mrg)
            proj.append(f"{expr_sql} AS {_sql_ident(m.alias)}")
        inner = f"SELECT {', '.join(proj)} FROM ({merge_sql}) AS {_sql_ident(mrg)}"
    else:
        m0 = id_to_metric[topo_d[0]]
        chain = (
            f"SELECT {_sql_ident(mrg)}.*, "
            f"{_derived_expr_for_formula(m0.formula, id_to_alias, qualify_table=mrg)} "
            f"AS {_sql_ident(m0.alias)} "
            f"FROM ({merge_sql}) AS {_sql_ident(mrg)}"
        )
        for idx in range(1, len(topo_d)):
            mid = topo_d[idx]
            m = id_to_metric[mid]
            nxt = f"x{idx}"
            expr_sql = _derived_expr_for_formula(m.formula, id_to_alias, qualify_table=nxt)
            chain = (
                f"SELECT {_sql_ident(nxt)}.*, {expr_sql} AS {_sql_ident(m.alias)} "
                f"FROM ({chain}) AS {_sql_ident(nxt)}"
            )
        inner = chain

    sel = f"SELECT * FROM ({inner}) AS {_sql_ident(v0)}"

    # ── post_process ──────────────────────────────────────────────
    # dim_names 統一由 anchor 決定
    if normal_ids:
        n_final_dims = len(group_sql)
    elif anchor_ids:
        n_final_dims = len(_subset_dim_indices(id_to_metric[anchor_ids[0]], group_raw))
    else:
        n_final_dims = 0
    dim_names = [f"dim_{i}" for i in range(n_final_dims)]

    all_atomic_ordered = anchor_ids + subset_ids + scalar_ids
    out_aliases = [id_to_alias[a] for a in all_atomic_ordered] + [
        id_to_metric[d].alias for d in (topo_d or [])
    ]

    pp = intent.post_process
    extras: list[str] = []
    if pp:
        if pp.where is not None:
            fw = _filter_clause_sql(pp.where, schema_def, table_alias=row_alias)
            if fw is None:
                return None
            extras.append(f"WHERE {fw}")
        if pp.sort:
            ob: list[str] = []
            for s in pp.sort:
                key = s.col.strip()
                sort_key: str | None = None
                for gi, gr in enumerate(group_raw):
                    if key == str(gr).strip():
                        sort_key = f"{_sql_ident(row_alias)}.dim_{gi}"
                        break
                if sort_key is None:
                    if key in dim_names or key in out_aliases:
                        sort_key = f"{_sql_ident(row_alias)}.{_sql_ident(key)}"
                    else:
                        ge = _group_expr_sql(key, allow, schema_def)
                        if ge is None:
                            return None
                        sort_key = ge
                ob.append(f"{sort_key} {s.order.upper()}")
            extras.append("ORDER BY " + ", ".join(ob))
        if pp.limit is not None:
            extras.append(f"LIMIT {int(pp.limit)}")

    # 若尚未指定 ORDER BY，自動補預設排序：
    #   有時間函數維度（MONTH/YEAR/QUARTER）→ 時間 ASC（趨勢圖時序正確）
    #   其餘情況 → 第一個 metric alias DESC（由大到小，圖表穩定）
    if not any(e.startswith("ORDER BY") for e in extras):
        time_fn_dims = [
            i for i, g in enumerate(group_raw)
            if _GROUP_FN.match(g.strip()) and _GROUP_FN.match(g.strip()).group(1).upper() in _ALLOWED_GROUP_FN
        ]
        if time_fn_dims:
            auto_ob = ", ".join(f"{_sql_ident(row_alias)}.dim_{i} ASC" for i in time_fn_dims)
            extras.append(f"ORDER BY {auto_ob}")
        elif out_aliases:
            first_alias = _sql_ident(out_aliases[0])
            extras.append(f"ORDER BY {_sql_ident(row_alias)}.{first_alias} DESC")
    tail = (" " + " ".join(extras)) if extras else ""
    out_sql = "WITH " + ", ".join(ctes) + " " + sel + tail

    # alias → display label：優先用 MetricV4.label（LLM 生成的中文名），
    # 找不到再 fallback 到 schema reverse lookup / alias 本身
    alias_to_display: dict[str, str] = {}
    for mid in all_atomic_ordered:
        m = id_to_metric.get(mid)
        if m and m.label:
            alias_to_display[m.alias] = m.label
    for did in (topo_d or []):
        m = id_to_metric.get(did)
        if m and m.label:
            alias_to_display[m.alias] = m.label

    labels = [
        alias_to_display.get(a) or _dataset_label_for_formula_alias(a, schema_def)
        for a in out_aliases
    ]

    # 偵測哪些 dim 是時間函數，供下游格式化標籤用
    # group_dim_types[i] = "MONTH" | "YEAR" | "QUARTER" | "col"
    group_dim_types: list[str] = []
    for g in group_raw:
        m_fn = _GROUP_FN.match(g.strip())
        if m_fn and m_fn.group(1).upper() in _ALLOWED_GROUP_FN:
            group_dim_types.append(m_fn.group(1).upper())
        else:
            group_dim_types.append("col")

    # 偵測哪些衍生指標是比率公式（num/den），供下游格式化百分比用
    percent_aliases: list[str] = []
    for mid in derived_ids:
        m_d = id_to_metric[mid]
        num_d, den_d = _divide_num_den(m_d.formula)
        if num_d is not None and den_d is not None:
            percent_aliases.append(m_d.alias)

    meta = {
        "mode": "calculate",
        "group_cols": dim_names,
        "group_raw": list(group_raw),
        "group_dim_types": group_dim_types,
        "agg_aliases": out_aliases,
        "dataset_labels": labels,
        "is_list": False,
        # 哪些 alias 是衍生指標（formula 引用其他 mN），供 LLM 摘要篩選用
        "derived_aliases": [id_to_alias[mid] for mid in derived_ids],
        # 哪些衍生指標是比率公式（0~1 小數），應顯示為百分比
        "chart_percent_aliases": percent_aliases,
    }
    return out_sql, [], meta
