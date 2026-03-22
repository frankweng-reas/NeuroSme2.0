# compute_aggregate 支援分析一覽

## 一、分組與數值

**group_by_column** 為分組維度（X 軸），可為單一欄位或陣列。若需階層顯示（例如「大類 > 中類 > 品名」），請設為依層級排序的欄位陣列，如 `["category_l1", "category_l2", "item_name"]`。彙總以最後一層為準，輸出會帶 `groupDetails` 供前端呈現階層。

**value_columns** 為 `[{ "column": "string", "aggregation": "sum|avg|count" }, ...]`，每欄位必帶 aggregation。例如：`[{"column": "sales_amount", "aggregation": "sum"}, {"column": "patient_id", "aggregation": "count"}]`，可支援不同欄位使用不同彙總方式。

---

## 二、支援情境與範例

### 1. 單一數值彙總

範例：「各平台的銷售金額？」、「各產品的銷售數量？」

單一 value 欄位，依 group 分組。輸出為 `labels` 搭配 `data`。

### 2. 多數值分別彙總（可每欄位不同 aggregation）

範例：「精華液和乳霜的銷售數量與銷售金額？」、「內科醫師的平均候診時間與總看診人次」

多個 value_columns，每欄位可指定不同 aggregation（sum、avg、count）。輸出為 `labels` 搭配 `datasets`，每個欄位一組 data。

### 3. 複合指標

範例：「各通路的毛利率？」、「momo 的 ROI？」、「各產品的客單價？」

複合指標需 value_columns 兩欄（分子、分母）。支援項目：margin_rate（gross_profit / net_amount，%）、roi（gross_profit / cost_amount）、arpu（net_amount / quantity，元）、discount_rate（discount_amount / net_amount，%）。輸出為 `labels`、`data`，並附 `valueLabel`、`valueSuffix`。

若要同時輸出複合指標與其他數值（例如 ROI 加 net_amount），value_columns 須包含所有欄位，前兩欄供指標計算，其餘為額外彙總。例如：`[{"column": "gross_profit", "aggregation": "sum"}, {"column": "cost_amount", "aggregation": "sum"}, {"column": "net_amount", "aggregation": "sum"}]`。

### 4. 時間趨勢（多系列）

範例：「各產品每月銷售金額趨勢？」、「精華液、乳霜的銷售額與毛利率逐月變化？」

將 series_by_column 設為時間維度（如 event_date），可搭配 indicator、display_fields。輸出為 `labels` 搭配 `datasets`，每系列一組 data。

### 5. 單一總計（無分組）

範例：「momo 的毛利率？」、「總毛利、總成本、ROI？」

group_by_column 為空時，輸出為單一總計或複合指標組成欄位。

---

## 三、篩選 (filters)

格式為 `{ "column": "string", "op": "==|!=|>|<|>=|<=|like", "value": "string" }`，op 預設為 `"=="`。

**日期區間**：value 為 `YYYY-MM-DD/YYYY-MM-DD` 時維持 BETWEEN 邏輯，op 不影響。

**多區間 OR**：同欄位多筆 filter，例如 event_date 為 `["2026-02-01/2026-02-28", "2026-03-01/2026-03-31"]`。

**op ==**：等於或 IN（多值時）。

**op !=**：不等於或 NOT IN（多值時），支援字串與數值。

**op >, <, >=, <=**：數值比較，value 須為數字。

**op like**：模糊匹配（包含）。

---

## 四、結果篩選 (having_filters)

針對彙總後的數值或指標篩選，等同 SQL HAVING。格式與 filters 相同：`{ "column": "string", "op": "==|!=|>|<|>=|<=|like", "value": "string" }`。column 為彙總後的欄位，如 net_amount、roi、銷售金額、ROI。

範例：營收 > 100 萬、ROI < 1.5、數量 > 500。

---

## 五、其他參數

**display_fields**：指定要輸出的指標，用於過濾 datasets。

**top_n**：取前 N 名。可為 `number` 或 `{ "count": number, "based_on": "string" }`（based_on 可選，排序由 sort_order 決定）。

**sort_order**：`"desc"` | `"asc"`（舊格式）或 `[{ "column": "string", "order": "desc|asc" }, ...]`（新格式，可指定依哪一欄排序，支援複合排序）。

**time_order**：時間維度依時間排序。

---

## 六、輸出格式

**單一系列**：`labels`、`data`、`valueLabel`、`valueSuffix`。多層 group 時另含 `groupDetails`（每筆對應 `labels` 順序，含各層欄位值）。

**多系列**：`labels`、`datasets`（每項含 `label`、`data`、`valueLabel`、`valueSuffix`，單位在 dataset 內）。多層 group 時另含 `groupDetails`。

---

## 七、比較期間指標 (compare_periods)

當需 YoY 年增率等**雙期間比較**時，使用 `compare_periods` 而非 filters：

```json
{
  "compare_periods": {
    "current": { "column": "timestamp", "value": "2026-01-01/2026-12-31" },
    "compare": { "column": "timestamp", "value": "2025-01-01/2025-12-31" }
  },
  "indicator": ["sales_yoy_growth"],
  "value_columns": [{"column": "sales_amount", "aggregation": "sum"}],
  "group_by_column": ["channel"]
}
```

- **current**：本期期間
- **compare**：對照期（如去年同期）
- **indicator**：`sales_yoy_growth` 或 `{value}_yoy_growth`（如 net_amount_yoy_growth）
- 輸出：本期數值、去年同期數值、YoY 成長率（%）
- `filters` 中的其他欄位仍會套用，僅 date column 由 compare_periods 獨立處理

---

## 八、限制

- **同欄位多 filter 為 OR**：同欄位多筆 filter 會合併為 OR。若要雙期間比較，請使用 `compare_periods`。
