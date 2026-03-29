"""
Intent JSON v4.0 — 重新設計的嚴格 Pydantic schema。

主要設計原則（相較 v3.2）：
- 移除 dims.time_filter：時間過濾統一在 metrics.filters，無繼承、無雙層鏡像。
- 移除 metrics.window，改為 metrics.group_override：
    None  → 使用 dims.groups 所有維度（正常分組聚合）
    []    → 全局 scalar，不分組，CROSS JOIN 合併（佔比分母）
    [col] → 按指定子集維度分組（父維度小計），LEFT JOIN 合併
- calculate 模式下頂層 filters 強制為空 []；
  filters 僅在 list 模式（明細查詢）使用。
- 每個 atomic metric 完全自持（self-contained）：過濾條件只在 metrics.filters。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

USER_FACING_INTENT_V4_VALIDATION_MESSAGE = (
    "這個問題目前無法自動解析，可能原因：條件描述較複雜、缺少明確的時間範圍，或同時指定多個篩選條件。"
    "建議：**寫清楚時間段**（如 2025 年 3 月）、**指定想看的指標**（如銷售額、訂單數），或將複合條件拆成分步提問。"
)

_USER_FACING_INTENT_V4_VALIDATION_MESSAGE_INTERNAL = (
    "Intent v4.0 結構無法解析，請對照 docs/intent_v4_protocol.md："
    "calculate 模式 metrics 至少一筆且頂層 filters 必須為 []；"
    "list 模式須含 select[]；"
    "group_override 若有值，必須為 dims.groups 的子集。"
)

_ALLOWED_OPS = frozenset(
    {
        "eq", "ne", "gt", "gte", "lt", "lte",
        "between", "in", "contains", "is_null", "is_not_null",
    }
)


def _norm_op(op: str) -> str:
    s = (op or "").strip().lower().replace(" ", "")
    aliases = {
        "=": "eq", "==": "eq", "!=": "ne", "<>": "ne",
        ">": "gt", ">=": "gte", "<": "lt", "<=": "lte",
    }
    return aliases.get(s, s)


class FilterClauseV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    col: str = Field(min_length=1)
    op: str
    val: Any | None = None

    @field_validator("col")
    @classmethod
    def _strip_col(cls, v: str) -> str:
        return str(v).strip()

    @field_validator("op")
    @classmethod
    def _norm_op_v(cls, v: str) -> str:
        n = _norm_op(str(v))
        if n not in _ALLOWED_OPS:
            raise ValueError(f"不支援的 op: {v!r}")
        return n

    @model_validator(mode="after")
    def _val_presence(self) -> FilterClauseV4:
        if self.op in ("is_null", "is_not_null"):
            return self
        if self.op == "between":
            if not isinstance(self.val, (list, tuple)) or len(self.val) != 2:
                raise ValueError("between 須有 val: [lo, hi]")
            return self
        if self.op == "in":
            if not isinstance(self.val, (list, tuple)) or not self.val:
                raise ValueError("in 須有非空 val 陣列")
            return self
        if self.op == "contains":
            if not isinstance(self.val, str) or not str(self.val).strip():
                raise ValueError("contains 須有非空字串 val")
            return self
        if self.val is None:
            raise ValueError(f"op={self.op} 必須有 val")
        return self


class DimsV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    groups: list[str] = Field(default_factory=list)

    @field_validator("groups", mode="before")
    @classmethod
    def _groups(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("dims.groups 須為陣列")
        return [str(x).strip() for x in v if str(x).strip()]


import re as _re

_ATOMIC_FORMULA_RE = _re.compile(
    r"^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*col_[a-zA-Z0-9_]+\s*\)\s*$"
)
# COUNT(DISTINCT col_x) 額外支援
_COUNT_DISTINCT_FORMULA_RE = _re.compile(
    r"^\s*COUNT\s*\(\s*DISTINCT\s+(col_[a-zA-Z0-9_]+)\s*\)\s*$",
    _re.IGNORECASE,
)
_RAW_AGG_IN_FORMULA_RE = _re.compile(
    r"\b(SUM|COUNT|AVG|MIN|MAX)\s*\(", _re.IGNORECASE
)
_METRIC_REF_RE = _re.compile(r"\bm\d+\b", _re.IGNORECASE)

# 用於 auto_repair_intent()：在運算式中找出所有 AGG(col_x) / COUNT(DISTINCT col_x) 呼叫
_AGG_CALL_IN_EXPR_RE = _re.compile(
    r"COUNT\s*\(\s*DISTINCT\s+col_[a-zA-Z0-9_]+\s*\)"
    r"|[A-Za-z_][A-Za-z0-9_]*\s*\(\s*col_[a-zA-Z0-9_]+\s*\)",
    _re.IGNORECASE,
)


def auto_repair_intent(intent_dict: dict[str, Any]) -> dict[str, Any]:
    """
    Pydantic 驗證**前**的前處理：偵測 metric formula 中包含多個聚合呼叫的複合公式
    （如 SUM(col_9) / SUM(col_8)），自動拆解成 atomic metrics + derived metric。

    適用場景：LLM 把「毛利率」「達成率」等比率直接寫成複合 formula，
    後端自動修正，避免 ValidationError 返回給使用者。

    拆解規則：
    - 找出 formula 中所有唯一的 AGG(col_x) 呼叫，各建立新 atomic metric
    - 原 metric 改為 derived，formula 以新 metric id 取代各 AGG 呼叫
    - atomic metrics 繼承原 metric 的 filters；derived metric filters 設為 []
    - 若 formula 已是 atomic / 已含 mN 引用 → 不處理
    """
    metrics = intent_dict.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        return intent_dict

    # 找出現有 metric id 中最大的數字，避免 id 衝突
    max_n = 0
    for m in metrics:
        mid = _re.match(r"^m(\d+)$", str(m.get("id", "")).strip().lower())
        if mid:
            max_n = max(max_n, int(mid.group(1)))

    counter = [max_n]
    new_metrics: list[dict] = []
    changed = False

    for m in metrics:
        if not isinstance(m, dict):
            new_metrics.append(m)
            continue

        formula = str(m.get("formula", "")).strip()

        # 已是合法 atomic → 不處理
        if _ATOMIC_FORMULA_RE.match(formula) or _COUNT_DISTINCT_FORMULA_RE.match(formula):
            new_metrics.append(m)
            continue

        # 已是 derived（含 mN 引用）→ 不處理
        if _METRIC_REF_RE.search(formula):
            new_metrics.append(m)
            continue

        # 找出所有 AGG 呼叫
        agg_calls = _AGG_CALL_IN_EXPR_RE.findall(formula)
        if len(agg_calls) < 2:
            new_metrics.append(m)
            continue

        # 去重（保留順序）；以 normalize（去空白、大寫）作為去重 key
        seen: dict[str, str] = {}
        unique_aggs: list[str] = []
        for agg in agg_calls:
            norm = _re.sub(r"\s+", "", agg).upper()
            if norm not in seen:
                seen[norm] = agg
                unique_aggs.append(agg)

        changed = True
        original_filters = m.get("filters", [])
        derived_formula = formula

        for agg in unique_aggs:
            counter[0] += 1
            new_id = f"m{counter[0]}"
            new_alias = f"_auto_{counter[0]}"
            norm = _re.sub(r"\s+", "", agg).upper()

            # 在 derived formula 中，將此 AGG 呼叫（所有出現處）替換為 new_id
            # 用 re.sub + re.escape 支援空白變化
            pat = _re.compile(_re.escape(agg), _re.IGNORECASE)
            derived_formula = pat.sub(new_id, derived_formula)

            new_metrics.append({
                "id": new_id,
                "alias": new_alias,
                "label": None,
                "formula": agg,
                "filters": list(original_filters),
            })

        # 原 metric 改為 derived（保留 id / alias / label / group_override）
        derived_metric = {k: v for k, v in m.items()}
        derived_metric["formula"] = derived_formula
        derived_metric["filters"] = []
        new_metrics.append(derived_metric)

    if not changed:
        return intent_dict

    result = dict(intent_dict)
    result["metrics"] = new_metrics
    return result


class MetricV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    alias: str = Field(min_length=1, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    # label：給使用者看的顯示名稱（中文），不影響 SQL；省略時 fallback 到 alias
    label: str | None = None
    formula: str = Field(min_length=1)
    filters: list[FilterClauseV4] = Field(default_factory=list)
    # group_override 語義：
    #   None（省略）→ 使用 dims.groups 所有維度（正常分組）
    #   []           → 全局 scalar，不分組（用於佔比分母等）
    #   ["col_x"]    → 僅按指定子集分組（父維度小計）；需為 dims.groups 的子集
    group_override: list[str] | None = None

    @field_validator("id", "formula")
    @classmethod
    def _strip_ids(cls, v: str) -> str:
        return str(v).strip()

    @field_validator("formula")
    @classmethod
    def _validate_formula(cls, v: str) -> str:
        s = v.strip()
        # Atomic：SUM(col_x) 格式 → 合法
        if _ATOMIC_FORMULA_RE.match(s):
            return s
        # COUNT(DISTINCT col_x) → 合法
        if _COUNT_DISTINCT_FORMULA_RE.match(s):
            return s
        # Derived：含 m1/m2 引用 → 合法；但不能同時含原始聚合函數
        has_metric_ref = bool(_METRIC_REF_RE.search(s))
        has_raw_agg = bool(_RAW_AGG_IN_FORMULA_RE.search(s))
        if has_metric_ref and has_raw_agg:
            raise ValueError(
                f"formula 不合法：衍生指標 formula 只能引用 metric ID（m1, m2…），"
                f"不能同時包含聚合函數（SUM/COUNT 等）。"
                f"請將複雜公式拆解：先各自定義 atomic metric，再用衍生 metric 做四則運算。"
                f"例：m1=SUM(col_11), m2=SUM(col_12), m3=(m1-m2)/m1。原始 formula: {s!r}"
            )
        if not has_metric_ref and has_raw_agg and not _ATOMIC_FORMULA_RE.match(s):
            raise ValueError(
                f"formula 不合法：atomic metric 只能是單一聚合單一欄位（如 SUM(col_11)）"
                f"或 COUNT(DISTINCT col_x)。"
                f"若需複合計算，請拆成多個 atomic metric 再用衍生 metric 組合。原始 formula: {s!r}"
            )
        return s

    @field_validator("group_override", mode="before")
    @classmethod
    def _norm_go(cls, v: Any) -> list[str] | None:
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("group_override 須為陣列或 null")
        return [str(x).strip() for x in v if str(x).strip()]


class PostSortV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    col: str = Field(min_length=1)
    order: Literal["asc", "desc"] = "desc"

    @field_validator("col")
    @classmethod
    def _strip_c(cls, v: str) -> str:
        return str(v).strip()

    @field_validator("order", mode="before")
    @classmethod
    def _ord(cls, v: Any) -> str:
        s = str(v or "desc").strip().lower()
        return "desc" if s == "desc" else "asc"


class PostProcessV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    where: FilterClauseV4 | None = None
    sort: list[PostSortV4] = Field(default_factory=list)
    limit: int | None = Field(default=None, ge=1)


class IntentV4(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    version: str | int | float
    mode: Literal["calculate", "list"] = "calculate"
    dims: DimsV4
    filters: list[FilterClauseV4] = Field(default_factory=list)
    metrics: list[MetricV4] = Field(default_factory=list)
    select: list[str] = Field(default_factory=list)
    post_process: PostProcessV4 | None = None

    @field_validator("version", mode="before")
    @classmethod
    def _ver(cls, v: Any) -> str:
        if isinstance(v, bool):
            raise ValueError("version 不可為布林")
        if isinstance(v, float):
            return format(v, "g") if v != int(v) else str(int(v))
        if isinstance(v, int):
            return str(v)
        s = str(v).strip()
        if s.lower().startswith("v"):
            s = s[1:].strip()
        return s

    @field_validator("select", mode="before")
    @classmethod
    def _sel(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("select 須為陣列")
        return [str(x).strip() for x in v if str(x).strip()]

    @model_validator(mode="after")
    def _validate_rules(self) -> IntentV4:
        try:
            major = float(str(self.version).split(".", 1)[0])
        except ValueError as e:
            raise ValueError("version 無法解析") from e
        if major != 4:
            raise ValueError("IntentV4 僅支援 version 4.x")

        if self.mode == "list":
            if not self.select:
                raise ValueError("mode=list 時 select 須為至少一個 col_*")
            if self.metrics:
                raise ValueError("mode=list 時 metrics 須為空陣列")
        else:
            if self.filters:
                raise ValueError(
                    "mode=calculate 時頂層 filters 必須為空 []；"
                    "過濾條件統一在各 metrics.filters 中定義。"
                )
            if not self.metrics:
                raise ValueError("mode=calculate 時 metrics 須至少一筆")
            dims_set = set(self.dims.groups)
            for m in self.metrics:
                if m.group_override is not None and len(m.group_override) > 0:
                    bad = [g for g in m.group_override if g not in dims_set]
                    if bad:
                        raise ValueError(
                            f"metric {m.id!r} 的 group_override 含有不在 dims.groups 中的維度: {bad}"
                        )
        return self


def is_intent_v4_payload(data: dict[str, Any]) -> bool:
    """是否為 v4.x intent（version 主版本 = 4）。"""
    if not isinstance(data, dict):
        return False
    ver = data.get("version")
    if ver is None:
        return False
    try:
        major = float(str(ver).lstrip("vV").split(".")[0])
        return major == 4
    except (ValueError, TypeError):
        return False


def parse_intent_v4(data: dict[str, Any]) -> IntentV4:
    if not isinstance(data, dict):
        raise ValueError("intent 須為物件")
    return IntentV4.model_validate(data)
