# Intent Prompt 回歸測試題目

**用途**：每次修改 `config/system_prompt_analysis_intent_tool.md` 後，用這 21 題跑 baseline diff，確認沒有壞掉原有行為。

**原則**：每題只驗一個機制，失敗時能立即定位是哪個功能壞了。

**注意**：題目中的品牌、通路、大類名稱需對應測試用 schema 的實際值；`col_N` 由 schema 決定，不寫死在題目裡。

---

## A. 基礎輸出形式

### A1 單一分群
**題目**：2025 年 3 月各通路的銷售總額。
**預期**：`mode: calculate`、`dims.groups` 有通路欄位、`metrics` 1 筆 SUM、頂層 `filters: []`

### A2 多維度分群
**題目**：各通路下各品牌的銷售總額。（無時間條件）
**預期**：`dims.groups` 有 2 個欄位（通路 + 品牌）、`metrics.filters: []`

### A3 全時段無條件
**題目**：各品牌的總銷售額。（不指定時間）
**預期**：`metrics.filters: []`，輸出中不得出現任何時間 filter

---

## B. Filter 類型

### B1 eq 多條件
**題目**：「鮮乳坊」在「Momo」通路賣了多少錢？
**預期**：`metrics.filters` 含 2 條 `op: eq`（品牌 + 通路）

### B2 ne 排除
**題目**：除了「Momo」以外，各通路的銷售額。
**預期**：`metrics.filters` 含 `op: ne`

### B3 in 多值
**題目**：「鮮乳坊」與「牧場直送」這兩個品牌的銷售總額。
**預期**：`metrics.filters` 含 `op: in`，`val` 為陣列

### B4 contains 模糊
**題目**：產品名稱中包含「鮮乳」字樣的產品銷售額。
**預期**：`metrics.filters` 含 `op: contains`

### B5 is_not_null
**題目**：有填寫產品描述的品項，各自的銷售總額。
**預期**：`metrics.filters` 含 `op: is_not_null`

---

## C. Metrics 類型

### C1 多重聚合
**題目**：「穀物」大類的銷售總額、平均單價與訂單數量。
**預期**：`metrics` 含 3 筆（SUM + AVG + COUNT），各自獨立 atomic

### C2 衍生指標
**題目**：各品牌的毛利率：（銷售額 - 成本）/ 銷售額。
**預期**：`metrics` 含 m1(SUM)、m2(SUM)、m3(derived)；m3.formula 僅含 m1/m2，不含 SUM

### C3 COUNT DISTINCT
**題目**：每個通路有多少個不重複的品牌在販售？
**預期**：`metrics.formula` 含 `COUNT(DISTINCT col_N)`

---

## D. 時間維度

### D1 按日 grain
**題目**：2025 年 3 月每天的銷售額趨勢。
**預期**：`dims.groups` 直接放日期欄位（不加任何函數）、`metrics.filters` 含當月 between

### D2 相對時間
**題目**：過去 7 天的每日平均銷售額。
**預期**：`dims.groups` 含日期欄位、`metrics.filters` 含 between（依 user message 當前時間往回推算）

### D3 YoY 對比
**題目**：對比 2024 年 Q1，2025 年 Q1 各通路的銷售成長率。
**預期**：`metrics` 含 m1（2025 Q1 filter）、m2（2024 Q1 filter）、m3（derived 成長率）；`dims.groups` 含通路欄位

---

## E. post_process

### E1 Top N
**題目**：銷售金額最高的前 3 個產品。
**預期**：`post_process.sort` order: desc + `post_process.limit: 3`

### E2 HAVING
**題目**：銷售總額超過 500 元的品牌。
**預期**：`post_process.where.col` = metric alias、`op: gt`、`val: 500`

### E3 Top N + HAVING 組合
**題目**：2024 與 2025 年 Q1 各通路銷售對比，且 2025 銷售額 > 1000，取前 5。
**預期**：`metrics` 含兩期對比、`post_process.where` + `sort` + `limit` 同時存在

---

## F. group_override 佔比

### F1 篩選後全局佔比
**題目**：「乳品」大類中各品牌的銷售額佔比。
**預期**：m1 正常分組（filters 含乳品）、m2 `group_override: []`（filters 同為乳品）、m3 derived

### F2 真全局佔比
**題目**：各品牌的銷售額佔全通路全品牌總額的比例。
**預期**：m2 `group_override: []` 且 `filters: []`（分母無任何篩選）、m3 derived

### F3 父維度小計佔比
**題目**：各通路下，各品牌的銷售額佔「本通路」總額比例。
**預期**：`dims.groups` 含通路 + 品牌、m2 `group_override: ["通路欄位 col_N"]`（子集分組）、m3 derived

---

## G. list 模式

### G1 裸列表
**題目**：列出所有訂單編號與銷售金額。
**預期**：`mode: list`、`select` 含 2 個 col_N、`metrics: []`

### G2 list + filter + sort
**題目**：列出最近 5 筆乳品類別且金額大於 1000 的訂單編號、日期與金額，依金額由高到低。
**預期**：`mode: list`、`filters` 含 eq、`post_process.where` + `sort` + `limit: 5`

---

## 測試執行說明

第一次執行腳本時，對每題的 LLM 輸出存成 `tests/prompt/baseline/` 下的 JSON 檔作為基準。

之後每次改 prompt，重跑腳本比對結果：

- ✅ Pydantic 通過 + 輸出與 baseline 相同 → 跳過，不需人工看
- ⚠️ Pydantic 通過 + 輸出與 baseline 不同 → 人工審查，判斷是改善還是退步
- ❌ Pydantic 驗證失敗 → 直接標錯，必修

只需要看 ⚠️ 和 ❌，不需要全部 21 題重看。
