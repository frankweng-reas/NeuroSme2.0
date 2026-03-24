# 設計：Schema 與 Indicator 可配置化

## 資料來源（正式）

- **唯一正式儲存**：PostgreSQL **`bi_schemas`** 表，欄位 **`schema_json`**（JSON 物件，含 `id`、`columns`、`indicators` 等）。
- 後端以 **`load_schema_from_db(schema_id, db)`** 載入；chat / intent-to-compute / 產品路徑皆然。
- 倉庫內 **`config/schemas/*.yaml`** 僅作歷史範本／開發對照，**規劃刪除**；新功能與文件請以 DB 為準。

---

## 目標

將 **Schema**（欄位、別名）與 **Indicator**（指標、公式）改為透過設定儲存，不再寫死在程式。

**流程**：`bi_schemas.schema_json` → 注入 system prompt → LLM 輸出 intent → `compute_aggregate(schema_def)` 計算

---

## 一、資料結構設計

### 1.1 Schema 設定（結構與下列範例相同；實際存於 bi_schemas）

**舊檔路徑（僅作格式參考，非執行來源）**：`config/schemas/{schema_id}.yaml`

```yaml
id: fact_business_operations

# 既有
group_aliases:
  平台: [平台, 通路, store_name, channel_id, channel]
  產品名稱: [產品, 品名, item_name, item]

value_aliases:
  銷售金額: [銷售金額, sales_amount, net_amount, 營收]
  毛利: [毛利, gross_profit]
  成本: [成本, cost_amount]

# 擴充：欄位定義（供 schema_summary 與 LLM）
columns:
  store_name: { type: str, purposes: [dim], aliases: [通路, 平台, 店] }
  timestamp: { type: timestamp, purposes: [dim_time], aliases: [日期, 時間] }
  sales_amount: { type: num, purposes: [val], aliases: [銷售金額, 營收] }
  gross_profit: { type: num, purposes: [val], aliases: [毛利] }
  cost_amount: { type: num, purposes: [val], aliases: [成本] }
  guest_count: { type: num, purposes: [val], aliases: [來客數] }
  # ...
```

- `group_aliases` / `value_aliases`：維持現有用途（欄位解析）
- `columns`：給 schema_summary 與 system prompt 用，描述每個欄位型別、用途、別名

---

### 1.2 Indicator 設定（新增）

**儲存位置**：與 `columns` 同層，寫入 **`bi_schemas.schema_json.indicators`**（勿依賴 YAML 檔）。

```yaml
indicators:
  margin_rate:
    code: margin_rate
    display_label: 毛利率
    formula: numerator / denominator
    numerator: gross_profit
    denominator: sales_amount
    as_percent: true
    decimal_places: 2
    default_value_columns: [gross_profit, sales_amount]

  roi:
    code: roi
    display_label: ROI
    formula: numerator / denominator
    numerator: gross_profit
    denominator: cost_amount
    as_percent: false
    default_value_columns: [gross_profit, cost_amount]

  arpu:
    code: arpu
    display_label: 客單價
    formula: numerator / denominator
    numerator: sales_amount
    denominator: guest_count
    as_percent: false
    decimal_places: 0
    default_value_columns: [sales_amount, guest_count]

  sales_yoy_growth:
    code: sales_yoy_growth
    display_label: YoY成長率
    type: compare_period
    value_column: sales_amount
    formula: (current - compare) / compare * 100
```

- **一般指標**：`numerator`、`denominator`、`as_percent`
- **比較期間**：`type: compare_period`、`value_column`
- **運算式**：可支援 `indicator: "A/B"`，由 intent 動態帶入，不一定全在 config

---

## 二、流程設計

### 2.1 整體流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 載入設定                                                      │
│    schema_def = load_schema_from_db(schema_id, db)                │
│    - group_aliases, value_aliases, columns, indicators           │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. 組裝 System Prompt                                            │
│    intent_prompt = base_prompt + inject(schema_def, indicators)   │
│    - Schema Definition：從 columns 產生                         │
│    - Indicator & Value Logic：從 indicators 產生                 │
│    - 保留固定的 Business Logic、Filter Rule、Output Structure    │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. LLM 意圖萃取                                                  │
│    user_content = schema_summary + 問題                          │
│    intent = call_llm(system=intent_prompt, user=user_content)     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. 計算                                                          │
│    compute_aggregate(rows, intent, ...,                          │
│                      group_aliases=schema.group_aliases,          │
│                      value_aliases=schema.value_aliases,          │
│                      indicator_defs=schema.indicators)           │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2.2 System Prompt 注入

**base_prompt**（固定）：Role、Business Logic、Filter Rule、Output JSON Structure 等。

**動態注入區塊**：

```markdown
# Schema Definition (from config)
{{SCHEMA_DEFINITION}}

# Indicator & Value Logic (from config)
{{INDICATOR_DEFINITION}}
```

- `{{SCHEMA_DEFINITION}}`：由 `columns` 產生，例如  
  `- store_name: str|dim|通路,平台,店`
- `{{INDICATOR_DEFINITION}}`：由 `indicators` 產生，例如  
  `- 毛利率 (margin_rate): gross_profit / sales_amount`

**實作**：`_build_intent_prompt(schema_def) -> str` 負責組裝。

---

### 2.3 compute_aggregate 擴充

**新增參數**：

```python
def compute_aggregate(
    ...,
    indicator_defs: list[dict] | dict[str, dict] | None = None,
) -> dict[str, Any] | None:
```

- `indicator_defs` 為 `None`：沿用既有寫死的 `_COMPOUND_INDICATORS`、`_INDICATOR_COLUMN_NAMES`（向後相容）
- `indicator_defs` 有值：優先使用，動態建立 `num_col`、`denom_col`、`as_pct` 等對應

**內部邏輯**：

1. 將 `indicator_defs` 正規化成 `{ code: { numerator, denominator, as_percent, ... } }`
2. `_get_indicator_keys(ind, value_keys, indicator_defs)`：若有 config 則用 config，否則 fallback 到既有常數
3. `_INDICATOR_LABELS`、`_VALUE_DISPLAY_NAMES` 等：改為從 config 建立，或維持 fallback

---

## 三、實作分階段建議

| 階段 | 內容 | 說明 |
|------|------|------|
| **Phase 1** | Schema 擴充 `columns` | 讓 schema_summary 與 prompt 的 schema 區塊由 config 產生 |
| **Phase 2** | Indicator 存入 schema | 新增 `indicators` 區塊於 `schema_json`，格式如上 |
| **Phase 3** | Prompt 動態注入 | `_build_intent_prompt(schema_def)` 產生完整 prompt |
| **Phase 4** | compute_aggregate 支援 indicator_defs | 接收 config，取代或補充既有常數 |
| **Phase 5** | 移除寫死常數 | 全改為 config-driven，僅保留最小 fallback |

---

## 四、與專案 / 多 Schema 的關係

- 每個 **BI 專案** 可對應不同 `schema_id`
- `schema_id` 可來自專案設定或 API 參數
- 不同專案可掛不同 `schema_id`，於 **`bi_schemas`** 各自定義 `columns`、`indicators`

---

## 五、運算式指標 (A/B)

- `indicator: "medicine_cost/total_bill"` 這類**運算式**可不寫在 config
- 只要有對應的 value columns，`compute_aggregate` 即可依 `"/"` 拆成分子分母計算
- config 的 `indicators` 主要放**預設指標**（毛利率、ROI、YoY 等），LLM 優先使用這些 code，其餘才用運算式
