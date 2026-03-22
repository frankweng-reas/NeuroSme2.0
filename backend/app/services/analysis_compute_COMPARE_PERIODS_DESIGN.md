# 設計：比較期間指標 (Compare Periods) — YoY / MoM

## 問題

使用者需求：「今年 vs 去年營收、YoY 成長率」。現有架構僅支援**單次彙總**，無法表達「兩個時間區間分別彙總再比較」。

---

## 核心理念

**不補洞**：不讓 `filters` 承載雙重語意（一般篩選 vs 期間比較）。  
**明確分離**：新增專用結構 `compare_periods`，僅負責「定義比較的兩個期間」。

---

## Intent 擴充

```json
{
  "group_by_column": ["channel"],
  "value_columns": [{"column": "sales_amount", "aggregation": "sum"}],
  "indicator": ["sales_yoy_growth"],
  "compare_periods": {
    "current": { "column": "timestamp", "value": "2026-01-01/2026-12-31" },
    "compare": { "column": "timestamp", "value": "2025-01-01/2025-12-31" }
  },
  "filters": [],
  "display_fields": ["channel", "sales_amount", "sales_amount_compare", "sales_yoy_growth"],
  "sort_order": [{"column": "sales_amount", "order": "desc"}],
  "top_n": 3
}
```

### 欄位說明

| 欄位 | 型別 | 說明 |
|------|------|------|
| `compare_periods` | `{ current, compare }` | 定義比較期間；`current`=本期、`compare`=對照期（如去年） |
| `current` / `compare` | `{ column, value }` | 日期欄與區間值，格式同 filter（單日或 `start/end`） |

### 與 filters 的關係

- `filters`：對**所有**期間通用的篩選（如 channel、region）
- `compare_periods`：**僅定義期間**，不與 filters 合併
- 若同時存在：先套用 `filters`，再在結果上分別套用 `current` 與 `compare` 的日期條件

---

## 計算流程

```
compute_aggregate(rows, ...)
│
├─ 有 compare_periods 且 indicator 含 *_yoy_growth
│   │
│   ├─ 1. base_rows = 套用 filters（排除 compare_periods 的 date column）
│   │
│   ├─ 2. current_rows = 套用 current 期間篩選
│   ├─ 3. compare_rows = 套用 compare 期間篩選
│   │
│   ├─ 4. agg_current  = aggregate(current_rows,  group_by, value_columns)
│   ├─ 5. agg_compare  = aggregate(compare_rows, group_by, value_columns)
│   │
│   ├─ 6. 以 group key full outer join
│   ├─ 7. 計算 YoY = (current - compare) / compare，compare=0 時為 null
│   │
│   └─ 8. 輸出 datasets: [本期欄位, 對照期欄位, yoy_growth]
│
└─ 無 compare_periods → 維持現有單次彙總流程
```

---

## 支援的指標

| indicator | 公式 | 所需 value_column |
|-----------|------|-------------------|
| `sales_yoy_growth` | (current - compare) / compare × 100% | sales_amount |
| `*_yoy_growth` | 泛用：`{value}_yoy_growth` 對應 `{value}` 欄位 | 依前綴對應 |

---

## 輸出格式

與既有多 dataset 格式一致：

```json
{
  "labels": ["momo", "pchome", "shopee"],
  "datasets": [
    { "label": "銷售金額", "data": [1000, 800, 600] },
    { "label": "去年同期銷售金額", "data": [900, 750, 500] },
    { "label": "YoY成長率", "data": [11.11, 6.67, 20.0] }
  ]
}
```

---

## 邊界情況

| 狀況 | 處理 |
|------|------|
| 本期有、對照期無 | compare=0，yoy=null 或 100%（可配置） |
| 對照期有、本期無 | current=0，yoy=-100% |
| 分母為 0 | yoy = null，不除零 |

---

## 與既有架構的整合

- **Layer 1–3 不變**：`_aggregate_*` 維持單次彙總語意
- **新增 Layer 2.5**：`_run_compare_periods_flow` 作為分支
- **入口**：`compute_aggregate` 開頭判斷 `compare_periods`，有則走新流程，無則走現有流程
