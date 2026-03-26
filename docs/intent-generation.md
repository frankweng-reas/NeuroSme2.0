# Intent JSON v2 如何產生（簡述）

## 做什麼用

使用者用自然語言問分析問題 → 後端請 **LLM** 輸出結構化 **Intent JSON v2**（`version: 2`，以 `metrics` 為中心）→ 再交由 **DuckDB SQL（compute-engine）** 或 **列資料 Python 聚合** 執行。本文只說明 **意圖（intent）怎麼來**。

## 流程（概要）

1. **載入 system prompt**  
   檔案：`config/system_prompt_analysis_intent_tool.md`  
   由 `backend/app/api/endpoints/chat_compute_tool.py` 的 `_load_intent_prompt` 讀取。

2. **注入當次語境**  
   將佔位符替換為實際內容，讓模型只使用合法欄位代碼與指標定義：
   - `{{SYSTEM_DATE}}`：伺服器當天日期（相對「今年／去年」等）
   - `{{SCHEMA_NAME}}`、`{{SCHEMA_DEFINITION}}`、`{{DIMENSION_HIERARCHY}}`、`{{INDICATOR_DEFINITION}}`：來自該次請求的 **bi_schemas**（或專案關聯 schema）

3. **呼叫 LLM**  
   - System：上述組合後的 intent prompt  
   - User：使用者問題（必要時加上「當前時間」等前綴，與現有 API 一致）

4. **取出 JSON**  
   從模型回覆中 **解析出單一 JSON 物件**（`_extract_json_from_llm`）；不接受多段說明、Markdown 圍欄內以外的內容作為契約輸出。

5. **驗證與容錯**  
   - 以 **Pydantic `IntentV2`** 驗證（`backend/app/schemas/intent_v2.py`）  
   - **before 驗證**會修正常見錯型：例如 `post_aggregate.sort` 誤為單一物件、誤用 `where` 的 `left` 形狀、別名誤寫在 `target` 等。

6. **下遊使用**  
   - **僅 aggregate / 結構簡單**：可走 intent-to-compute 類 API 的 Python 聚合（**不支援** `kind: expression`）  
   - **expression、複雜後聚合**：走 **`POST /chat/compute-engine`**，Intent v2 → **一條 SQL** → DuckDB

## 設計重點（給產品／審閱用）

- **唯一契約**：分析意圖以 **v2** 為準；舊版 v1 鍵應避免出現在模型輸出（prompt 與驗證皆對齊）。  
- **欄位白名單**：意圖中的 `col_…` 必須來自該次載入的 schema，否則驗證或 SQL 階段會擋。  
- **穩定來源**：意圖品質依賴 **prompt + schema 注入 + 模型**；後端驗證／少量容錯負責攔截格式漂移，無法替代語意錯誤（例如漏了「今年」的 `time_filter`）。
- **Few-shot 最有效**：實務上模型對「完整、可複製的 JSON 範例」最穩；僅靠條列規則容易漏巢狀鍵或誤用 `filters`／`post_aggregate`。**擴充新題型時，優先在 `system_prompt_analysis_intent_tool.md` 增補一則對應 few-shot**，再補短規則說明。

## 相關檔案

| 項目 | 路徑 |
|------|------|
| Intent prompt 正文 | `config/system_prompt_analysis_intent_tool.md` |
| Prompt 載入與 LLM 呼叫 | `backend/app/api/endpoints/chat_compute_tool.py` |
| v2 資料模型與欄位校驗 | `backend/app/schemas/intent_v2.py` |
| SQL 組裝（DuckDB） | `backend/app/services/compute_engine_sql_v2.py` |
