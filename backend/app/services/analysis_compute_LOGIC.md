# compute_aggregate 流程與 display_fields 邏輯

## 核心理念

**datasets = value_columns 彙總 + 所有 indicator；顯示時依 display_fields 過濾。**

- **計算層**：一律計算 value_columns 全彙總 + 所有 indicator
- **展示層**：display_fields 為空 → 顯示全部；有值 → 依序過濾
- **having_filters**：可引用任何已計算欄位

---

## 流程分支總覽

```
compute_aggregate
├── [0a] compare_periods + YoY 類 indicator（有分組）
│   └── _run_compare_periods_flow：兩期間分別彙總 → join → YoY
│
├── [0b] compare_periods + ratio 指標（有分組）
│   └── _run_compare_periods_ratio_flow：兩期間分別算 ratio → 輸出 本期＋前期
│
├── [1] series_by_column 有值
│   ├── 1a. has_indicator → _aggregate_multi_series_with_metrics：全算，_filter_datasets_by_display_fields
│   └── 1b. 無 indicator → _aggregate_multi_series → _filter_datasets_by_display_fields
│
├── [2] indicator(s) + 有 group（單一與多個已整合）
│   └── 全算 value_keys + 各 indicator（迴圈）→ _filter_datasets_by_display_fields
│
├── [3] indicator(s) + __total__（單一總計，pairs 格式）
│   ├── 多 indicator → raw_pairs + 各 indicator
│   └── 單一 indicator → raw_pairs + ind → _apply_display_fields
│
├── [4] 多 value、無 indicator
│   └── _aggregate_multi_value_by_group → _filter_datasets_by_display_fields
│
└── [5] 其他（pairs 格式）
       └── _apply_display_fields
```

---

## 共用函式

| 函式 | 用途 |
|------|------|
| `_filter_datasets_by_display_fields(datasets, display_fields)` | 依 display_fields 過濾 datasets；空則回傳全部 |
| `_apply_display_fields(pairs, display_fields)` | pairs 格式專用（總計多指標等） |

---

## 對照表：_DISPLAY_FIELD_ALIASES / _VALUE_DISPLAY_NAMES

- 維度（store_name 等）：不進 datasets
- value：銷售金額↔sales_amount、毛利↔gross_profit 等
- indicator：毛利率↔margin_rate、ROI↔roi 等
- 前期 indicator（compare_periods + ratio）：前期客單價↔previous_arpu、arpu_compare 等（由 schema 自動推導）
