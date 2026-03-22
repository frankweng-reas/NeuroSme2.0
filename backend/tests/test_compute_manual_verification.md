# 手動驗證測試：固定資料與預期答案

## 測試資料集

請將以下 CSV 存為 `test_data.csv` 或直接貼入測試程式：

```csv
store_name,channel,item_name,gross_profit,sales_amount,cost_amount,quantity
店A,momo,商品X,100,200,50,10
店A,momo,商品Y,50,100,25,5
店A,shopee,商品X,80,160,40,8
店B,momo,商品X,200,400,100,20
店B,shopee,商品Y,30,60,15,3
店C,momo,商品X,40,200,40,20
```

### 手算彙總（用於驗證）

| 分組 | gross_profit | sales_amount | cost_amount | margin_rate | roi |
|------|--------------|--------------|-------------|-------------|-----|
| **店A** | 100+50+80=**230** | 200+100+160=**460** | 50+25+40=**115** | 230/460=**50%** | 230/115=**2.0** |
| **店B** | 200+30=**230** | 400+60=**460** | 100+15=**115** | 230/460=**50%** | 230/115=**2.0** |
| **店C** | **40** | **200** | **40** | 40/200=**20%** | 40/40=**1.0** |
| **總計** | 230+230+40=**500** | 460+460+200=**1120** | 115+115+40=**270** | 500/1120≈**44.64%** | 500/270≈**1.85** |

| 分組 (store+channel) | gross_profit | sales_amount | margin_rate |
|---------------------|--------------|--------------|-------------|
| 店A-momo | 100+50=**150** | 200+100=**300** | 150/300=**50%** |
| 店A-shopee | **80** | **160** | 80/160=**50%** |
| 店B-momo | **200** | **400** | 200/400=**50%** |
| 店B-shopee | **30** | **60** | 30/60=**50%** |
| 店C-momo | **40** | **200** | 40/200=**20%** |

---

## 測試案例與預期答案

### 案例 1：各店銷售額、毛利率、ROI

**問題**：顯示通路名稱、銷售額、毛利率、ROI

**Intent**：
```json
{
  "group_by_column": ["store_name"],
  "indicator": ["margin_rate", "roi"],
  "value_columns": [
    {"column": "gross_profit", "aggregation": "sum"},
    {"column": "sales_amount", "aggregation": "sum"},
    {"column": "cost_amount", "aggregation": "sum"}
  ],
  "display_fields": ["store_name", "sales_amount", "margin_rate", "roi"]
}
```

**預期**：
- labels: `["店A", "店B", "店C"]`（或依 sort 排序）
- datasets 中有「銷售金額」：`[460, 460, 200]`
- datasets 中有「毛利率」：`[50.0, 50.0, 20.0]`
- datasets 中有「ROI」：`[2.0, 2.0, 1.0]`

---

### 案例 2：各店毛利率（單一 indicator）

**問題**：各店的毛利率

**Intent**：
```json
{
  "group_by_column": ["store_name"],
  "indicator": ["margin_rate"],
  "value_columns": [
    {"column": "gross_profit", "aggregation": "sum"},
    {"column": "sales_amount", "aggregation": "sum"}
  ],
  "display_fields": ["store_name", "margin_rate"]
}
```

**預期**：
- labels: `["店A", "店B", "店C"]`
- 毛利率 data: `[50.0, 50.0, 20.0]`（與案例 1 一致）

---

### 案例 3：總計毛利率與 ROI

**問題**：整體的毛利率和 ROI

**Intent**：
```json
{
  "group_by_column": [],
  "indicator": ["margin_rate", "roi"],
  "value_columns": [
    {"column": "gross_profit", "aggregation": "sum"},
    {"column": "sales_amount", "aggregation": "sum"},
    {"column": "cost_amount", "aggregation": "sum"}
  ]
}
```

**預期**（pairs 格式）：
- labels: `["銷售金額", "毛利", "成本", "毛利率", "ROI"]`（順序可能不同）
- data: `[1120, 500, 270, 44.64..., 1.85...]`
  - 銷售金額=1120, 毛利=500, 成本=270
  - 毛利率=500/1120≈44.64, ROI=500/270≈1.85

---

### 案例 4：各店各通路銷售額

**問題**：各店在各通路的銷售額

**Intent**：
```json
{
  "group_by_column": ["store_name"],
  "series_by_column": "channel",
  "value_columns": [{"column": "sales_amount", "aggregation": "sum"}],
  "display_fields": ["sales_amount"]
}
```

**預期**：
- labels: `["店A", "店B", "店C"]`
- datasets 含「銷售金額 - momo」：`[300, 400, 200]`
- datasets 含「銷售金額 - shopee」：`[160, 60, 0]`（店C 無 shopee 則為 0）

---

### 案例 5：各店銷售額與成本（無 indicator）

**問題**：各店的銷售額和成本

**Intent**：
```json
{
  "group_by_column": ["store_name"],
  "value_columns": [
    {"column": "sales_amount", "aggregation": "sum"},
    {"column": "cost_amount", "aggregation": "sum"}
  ],
  "display_fields": ["sales_amount", "cost_amount"]
}
```

**預期**：
- labels: `["店A", "店B", "店C"]`
- 銷售金額: `[460, 460, 200]`
- 成本: `[115, 115, 40]`

---

### 案例 6：總計多欄位（無 indicator）

**問題**：總銷售額、總成本、總毛利

**Intent**：
```json
{
  "group_by_column": [],
  "value_columns": [
    {"column": "sales_amount", "aggregation": "sum"},
    {"column": "cost_amount", "aggregation": "sum"},
    {"column": "gross_profit", "aggregation": "sum"}
  ]
}
```

**預期**：
- labels: `["銷售金額", "成本", "毛利"]`（或依 display/順序）
- data: `[1120, 270, 500]`

---

## 驗證方式

1. 執行測試（或呼叫 API）取得實際輸出
2. 對照上表手算結果，確認數值一致
3. 若有 sort_order，注意 labels 順序可能不同，但數值與 label 的對應需正確
