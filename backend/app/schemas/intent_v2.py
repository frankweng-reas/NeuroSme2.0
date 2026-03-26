"""
Intent JSON v2（metrics 中心）：唯一支援之分析意圖契約。
動態 schema：欄位白名單於請求時依 bi_schemas 載入之 schema_def 校驗。
"""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Self

_FILTER_COL_NAMES = re.compile(r"\b(col_[a-zA-Z0-9_]+)\b")

# 回給前端／使用者時請用此句，勿直接附加 Pydantic ValidationError 字串。
USER_FACING_INTENT_NO_JSON_MESSAGE = (
    "暫時無法從回覆中取得有效的分析結構。請用較具體的方式描述，例如：**時間範圍**、**想看的數字**"
    "（如銷售額、筆數），或稍後再試一次。"
)
USER_FACING_INTENT_VALIDATION_MESSAGE = (
    "這則問題無法對應到目前支援的分析格式（常見原因：缺**明確時間**、指標與條件組合過複雜，或與資料欄位對不起來）。"
    "建議：**寫清楚起訖日期或期間**、**先問單一指標**（如總銷售額），需要篩選或對照期時再拆成下一步提問。"
)


class DateRange(BaseModel):
    start: str = Field(min_length=1)
    end: str = Field(min_length=1)


class TimeFilter(BaseModel):
    column: str = Field(min_length=1)
    op: Literal["between"] = "between"
    value: list[str] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def two_strings(self) -> Self:
        a, b = self.value[0].strip(), self.value[1].strip()
        if not a or not b:
            raise ValueError("time_filter.value 須為兩個非空日期字串")
        self.value = [a, b]
        return self


class ComparePeriodsV2(BaseModel):
    column: str = Field(min_length=1)
    current: DateRange
    previous: DateRange


class DimensionsV2(BaseModel):
    group_by: list[str] = Field(default_factory=list)
    time_filter: TimeFilter | None = None
    compare_periods: ComparePeriodsV2 | None = None

    @model_validator(mode="after")
    def time_xor_compare(self) -> Self:
        if self.time_filter is not None and self.compare_periods is not None:
            raise ValueError("dimensions 不可同時設定 time_filter 與 compare_periods")
        return self


class FilterCondition(BaseModel):
    """列級 WHERE；value 依 op 而定（between 為長度 2 的 list）。"""

    column: str = Field(min_length=1)
    op: Literal[
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "between",
        "in",
        "contains",
        "is_null",
        "is_not_null",
    ]
    value: Any | None = None

    @model_validator(mode="after")
    def filter_value_by_op(self) -> Self:
        if self.op == "contains":
            if not isinstance(self.value, str) or not self.value.strip():
                raise ValueError("op=contains 時 value 須為非空字串")
        return self


class MetricCompareV2(BaseModel):
    emit_previous: bool = False
    previous_as: str | None = None
    emit_yoy_ratio: bool = False
    yoy_as: str | None = None

    @model_validator(mode="after")
    def require_aliases(self) -> Self:
        if self.emit_previous and not (self.previous_as or "").strip():
            raise ValueError("compare.emit_previous 為 true 時須設定 previous_as")
        if self.emit_yoy_ratio and not (self.yoy_as or "").strip():
            raise ValueError("compare.emit_yoy_ratio 為 true 時須設定 yoy_as")
        return self


class MetricAggregateV2(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1)
    kind: Literal["aggregate"] = "aggregate"
    column: str = Field(min_length=1)
    aggregation: Literal["sum", "avg", "count"]
    as_name: str = Field(alias="as", min_length=1)
    compare: MetricCompareV2 | None = None


class MetricExpressionV2(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1)
    kind: Literal["expression"] = "expression"
    expression: str = Field(min_length=1)
    as_name: str = Field(alias="as", min_length=1)
    refs: dict[str, list[str]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def refs_columns(self) -> Self:
        cols = self.refs.get("columns")
        if not cols or not isinstance(cols, list):
            raise ValueError("expression 須提供 refs.columns（非空陣列）")
        cleaned = [str(c).strip() for c in cols if str(c).strip()]
        if not cleaned:
            raise ValueError("refs.columns 不可為空")
        self.refs = {"columns": cleaned}
        return self


class MetricGrandShareV2(BaseModel):
    """
    全域佔比：分子為「同一資料範圍內」符合 numerator_filters 之列加總，
    分母為該範圍內全部列的 SUM(column)（全體總額）。頂層 filters／time_filter 界定與分子共用之範圍；
    切片條件（品牌、子類等）必須放在 numerator_filters，不可放進頂層 filters。
    dimensions.group_by 為空時為單列總體佔比；非空時每組一列，分母仍為全體總額。
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1)
    kind: Literal["grand_share"] = "grand_share"
    column: str = Field(min_length=1)
    as_name: str = Field(alias="as", min_length=1)
    numerator_filters: list[FilterCondition] = Field(min_length=1)


MetricSpecV2 = Annotated[
    MetricAggregateV2 | MetricExpressionV2 | MetricGrandShareV2,
    Field(discriminator="kind"),
]


class PostSortV2(BaseModel):
    target: Literal["as", "dimension"]
    name: str = Field(min_length=1)
    order: Literal["asc", "desc"] = "desc"


class PostWhereLiteral(BaseModel):
    type: Literal["literal"] = "literal"
    value: Any


class PostWhereRef(BaseModel):
    type: Literal["ref"] = "ref"
    target: Literal["as", "dimension"]
    name: str = Field(min_length=1)


class PostWhereClause(BaseModel):
    left: PostWhereRef
    op: Literal["eq", "ne", "gt", "gte", "lt", "lte", "is_null", "is_not_null"]
    right: PostWhereLiteral | PostWhereRef | None = None

    @model_validator(mode="after")
    def nullary_ops(self) -> Self:
        if self.op in ("is_null", "is_not_null"):
            if self.right is not None:
                raise ValueError(f"op={self.op} 不應有 right")
        else:
            if self.right is None:
                raise ValueError(f"op={self.op} 須提供 right")
        return self


class PostAggregateV2(BaseModel):
    where: list[PostWhereClause] = Field(default_factory=list)
    sort: list[PostSortV2] = Field(default_factory=list)
    limit: int | None = Field(default=None, ge=1)


class DisplayV2(BaseModel):
    column_order: list[str] = Field(default_factory=list)
    labels: dict[str, str] = Field(default_factory=dict)


class IntentV2(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    version: Literal[2] = 2
    dimensions: DimensionsV2
    filters: list[FilterCondition] = Field(default_factory=list)
    metrics: list[MetricSpecV2] = Field(min_length=1)
    post_aggregate: PostAggregateV2 | None = None
    display: DisplayV2 | None = None

    @model_validator(mode="before")
    @classmethod
    def _coerce_llm_post_aggregate_target_slip(cls, data: Any) -> Any:
        """
        LLM 常誤把指標／欄位名寫在 post_aggregate.where.*.left.target 或 post_aggregate.sort.*.target，
        但 target 只能是 'as' 或 'dimension'，名稱必須放在 name。在此修正為合法形狀。
        """
        if not isinstance(data, dict):
            return data

        gb_set: set[str] = set()
        dims = data.get("dimensions")
        if isinstance(dims, dict):
            gb = dims.get("group_by") or []
            if isinstance(gb, list):
                gb_set = {str(x).strip() for x in gb if x is not None and str(x).strip()}

        def as_or_dimension(for_name: str) -> Literal["as", "dimension"]:
            return "dimension" if for_name in gb_set else "as"

        pa = data.get("post_aggregate")
        if not isinstance(pa, dict):
            return data

        sort_raw = pa.get("sort")
        if isinstance(sort_raw, dict):
            pa["sort"] = [sort_raw]

        for clause in pa.get("where") or []:
            if not isinstance(clause, dict):
                continue
            for side in ("left", "right"):
                ref = clause.get(side)
                if not isinstance(ref, dict):
                    continue
                if (ref.get("type") or "") == "literal":
                    continue
                if ref.get("type") not in (None, "ref"):
                    continue
                ref["type"] = "ref"
                t_raw = ref.get("target")
                n_raw = ref.get("name")
                if t_raw in ("as", "dimension"):
                    continue
                if n_raw is not None and str(n_raw).strip():
                    ref["target"] = as_or_dimension(str(n_raw).strip())
                    continue
                if t_raw is None:
                    continue
                slip = str(t_raw).strip()
                if not slip:
                    continue
                ref["name"] = slip
                ref["target"] = as_or_dimension(slip)

        def _normalize_ref_dict(ref: dict[str, Any]) -> None:
            if not isinstance(ref, dict):
                return
            if (ref.get("type") or "") == "literal":
                return
            if ref.get("type") not in (None, "ref"):
                return
            ref["type"] = "ref"
            t_raw = ref.get("target")
            n_raw = ref.get("name")
            if t_raw in ("as", "dimension"):
                return
            if n_raw is not None and str(n_raw).strip():
                ref["target"] = as_or_dimension(str(n_raw).strip())
                return
            if t_raw is None:
                return
            slip = str(t_raw).strip()
            if slip:
                ref["name"] = slip
                ref["target"] = as_or_dimension(slip)

        for s in pa.get("sort") or []:
            if not isinstance(s, dict):
                continue
            # LLM 常把 where 的 left 誤塞进 sort（不得有 left；應為 target+name+order）
            if s.get("left") is not None and s.get("target") is None:
                left = s.get("left")
                if isinstance(left, dict):
                    _normalize_ref_dict(left)
                    t_fix = left.get("target")
                    n_fix = left.get("name")
                    if t_fix in ("as", "dimension") and n_fix and str(n_fix).strip():
                        s["target"] = t_fix
                        s["name"] = str(n_fix).strip()
                for junk in ("left", "right", "op"):
                    s.pop(junk, None)

            t_raw = s.get("target")
            n_raw = s.get("name")
            if t_raw in ("as", "dimension"):
                continue
            if n_raw is not None and str(n_raw).strip():
                s["target"] = as_or_dimension(str(n_raw).strip())
                continue
            if t_raw is None:
                continue
            slip = str(t_raw).strip()
            if not slip:
                continue
            s["name"] = slip
            s["target"] = as_or_dimension(slip)

        return data

    @model_validator(mode="after")
    def metrics_rules(self) -> Self:
        grand = [m for m in self.metrics if isinstance(m, MetricGrandShareV2)]
        non_grand = [m for m in self.metrics if not isinstance(m, MetricGrandShareV2)]
        if grand:
            if non_grand:
                raise ValueError("grand_share 指標不可與 aggregate / expression 併用於同一 Intent")
            if self.dimensions.compare_periods is not None:
                raise ValueError("grand_share 不支援 compare_periods")

        has_compare_metric = any(
            isinstance(m, MetricAggregateV2)
            and m.compare
            and (m.compare.emit_previous or m.compare.emit_yoy_ratio)
            for m in self.metrics
        )
        if has_compare_metric and self.dimensions.compare_periods is None:
            raise ValueError("metrics 含 compare（對照期／YoY）時 dimensions.compare_periods 必填")
        if self.dimensions.compare_periods is not None:
            if not any(isinstance(m, MetricAggregateV2) for m in self.metrics):
                raise ValueError("compare_periods 僅支援與 kind=aggregate 指標併用")
        seen: set[str] = set()
        for m in self.metrics:
            if isinstance(m, MetricExpressionV2):
                if self.dimensions.compare_periods is not None:
                    raise ValueError("compare_periods 與 kind=expression 指標不可併用")
                if m.as_name in seen:
                    raise ValueError(f"metrics 輸出別名重複：{m.as_name}")
                seen.add(m.as_name)
            elif isinstance(m, MetricGrandShareV2):
                if m.as_name in seen:
                    raise ValueError(f"metrics 輸出別名重複：{m.as_name}")
                seen.add(m.as_name)
            elif isinstance(m, MetricAggregateV2):
                if m.as_name in seen:
                    raise ValueError(f"metrics 輸出別名重複：{m.as_name}")
                seen.add(m.as_name)
                if m.compare and m.compare.previous_as:
                    if m.compare.previous_as in seen:
                        raise ValueError(f"metrics 輸出別名重複：{m.compare.previous_as}")
                    seen.add(m.compare.previous_as)
                if m.compare and m.compare.yoy_as:
                    if m.compare.yoy_as in seen:
                        raise ValueError(f"metrics 輸出別名重複：{m.compare.yoy_as}")
                    seen.add(m.compare.yoy_as)
        return self


def column_allowlist_from_schema_def(schema_def: dict[str, Any]) -> set[str]:
    cols = schema_def.get("columns") if isinstance(schema_def, dict) else None
    if isinstance(cols, dict) and cols:
        return {str(k) for k in cols.keys()}
    return set()


def validate_intent_v2_columns(intent: IntentV2, schema_def: dict[str, Any]) -> list[str]:
    """
    回傳錯誤訊息列表；空則通過。
    """
    err: list[str] = []
    allow = column_allowlist_from_schema_def(schema_def)
    if not allow:
        err.append("schema 無 columns，無法校驗欄位")
        return err

    def check_col(c: str, ctx: str) -> None:
        if c not in allow:
            err.append(f"{ctx}：欄位 {c!r} 不在 schema.columns")

    for g in intent.dimensions.group_by:
        check_col(g, "group_by")

    if intent.dimensions.time_filter:
        check_col(intent.dimensions.time_filter.column, "time_filter")
    if intent.dimensions.compare_periods:
        check_col(intent.dimensions.compare_periods.column, "compare_periods")

    for f in intent.filters:
        check_col(f.column, "filters")

    for m in intent.metrics:
        if isinstance(m, MetricAggregateV2):
            check_col(m.column, f"metric[{m.id}]")
        elif isinstance(m, MetricGrandShareV2):
            check_col(m.column, f"metric[{m.id}]")
            for i, nf in enumerate(m.numerator_filters):
                check_col(nf.column, f"metric[{m.id}].numerator_filters[{i}]")
        elif isinstance(m, MetricExpressionV2):
            for c in m.refs["columns"]:
                check_col(c, f"metric[{m.id}].refs")
            for c in set(_FILTER_COL_NAMES.findall(m.expression)):
                if c not in m.refs["columns"]:
                    err.append(f"metric[{m.id}]：式子中的 {c!r} 應列入 refs.columns")
                check_col(c, f"metric[{m.id}].expression")

    pa = intent.post_aggregate
    if pa:
        for i, w in enumerate(pa.where):
            if w.left.target == "dimension":
                check_col(w.left.name, f"post_aggregate.where[{i}].left")
            if isinstance(w.right, PostWhereRef) and w.right.target == "dimension":
                check_col(w.right.name, f"post_aggregate.where[{i}].right")
        for i, s in enumerate(pa.sort):
            if s.target == "dimension":
                check_col(s.name, f"post_aggregate.sort[{i}]")

    return err


def intent_sql_blockers_v2(intent: IntentV2, schema_def: dict[str, Any]) -> list[str]:
    block: list[str] = []
    block.extend(validate_intent_v2_columns(intent, schema_def))
    return [b for b in block if b]


def parse_intent_v2(data: dict[str, Any]) -> IntentV2:
    """僅接受 version=2；非法則拋 ValidationError。"""
    return IntentV2.model_validate(data)
