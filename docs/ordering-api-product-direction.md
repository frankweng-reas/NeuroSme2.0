# 點餐 API 產品方向

## 背景

2026-04 PoC 驗證：透過 CS Agent + 菜單知識庫 + 自訂 prompt，可實現自然語言點餐 → 結構化 JSON 訂單的完整流程。

目標客群：飯店、餐廳等餐飲業者，提供自有 app 語音/文字點餐功能。

---

## PoC 驗證結果

**測試環境**：CS Agent + gpt-4o-mini + 菜單 FAQ 上傳為知識庫

**測試流程**：

```
用戶：「我要一份炒飯一碗湯」
→ {"status": "clarifying", "reply": "請問您想要哪種湯？",
   "items": [{"name":"炒飯","qty":1,"price":110}],
   "choices": ["酸辣湯","玉米濃湯","蛤蜊湯"]}

用戶：「我要一份炒飯一碗湯，玉米濃湯」
→ {"status": "confirming", "reply": "您點了炒飯1碗、玉米濃湯1碗，共NT$165，確認送出嗎？",
   "items": [...], "choices": ["確認","修改"]}

用戶：「確認」
→ {"status": "done", "reply": "您的訂單已送出，請稍候！",
   "items": [...], "choices": null}
```

**驗證項目**：
- ✅ 模糊品項偵測（「湯」→ 列出選項）
- ✅ 多輪對話品項累積（炒飯不遺漏）
- ✅ 價格自動從菜單計算（110+55=165）
- ✅ 狀態機流程正確（clarifying → confirming → done）
- ✅ JSON 格式穩定輸出

---

## 架構設計

### 現況（CS Agent 模擬）

```
App → POST /api/chat/completions-stream
      帶 messages 完整歷史 + message + knowledge_base_id
    ← JSON 回傳
```

**問題**：App 需自己維護完整對話歷史，整合複雜度高。

---

### 目標（點餐專用高階 API）

```
App → POST /api/ordering/chat
      { "session_id": "table-5-abc123", "message": "我要一份炒飯" }
    ← { "status": "...", "reply": "...", "items": [...], "choices": [...] }
```

**後端負責**：
- Session 管理（Redis / DB，key = session_id）
- 對話歷史維護
- RAG（菜單知識庫查詢）
- LLM 推理
- JSON 格式驗證

**App 只負責**：
- 顯示 `reply` 給用戶
- 有 `choices` → 顯示選項按鈕
- `status=done` → 用 `items` 打廚房系統 API

---

## API 規格（草案）

### Request

```
POST /api/ordering/chat

{
  "session_id": "string",     // 桌號或唯一識別，由 app 自訂
  "message":    "string",     // 用戶輸入（文字或語音轉文字後的結果）
  "kb_id":      "integer"     // 菜單知識庫 ID（可於初始化時帶入，之後省略）
}
```

### Response

```json
{
  "status":  "clarifying | confirming | done | inquiry | error",
  "reply":   "顯示給用戶的自然語言文字",
  "items": [
    { "name": "炒飯", "qty": 1, "price": 110, "notes": "" }
  ],
  "choices": ["選項1", "選項2"] // null 代表不需要用戶選擇
}
```

### Status 說明

| status | 意義 | App 行動 |
|--------|------|---------|
| `clarifying` | 品項不明確，需補充 | 顯示 choices 按鈕 |
| `confirming` | 訂單完整，等待確認 | 顯示確認/修改按鈕 |
| `done` | 訂單確認送出 | 用 items 打廚房 API |
| `inquiry` | 用戶在問問題（非點餐）| 顯示 reply |
| `error` | 發生錯誤 | 顯示錯誤訊息 |

---

## 知識庫建議格式

菜單以 **FAQ 格式**上傳效果最佳，每道菜一條，chunk 精準：

```
炒飯（蛋炒飯）｜NT$110｜備注可選：加培根+NT$30、不要蔥
牛肉麵｜NT$180｜湯頭：紅燒或清燉｜備注可選：不要蔥、加辣、少油
珍珠奶茶｜NT$60｜尺寸：中杯/大杯+NT$10｜甜度：全糖/七分/半糖/無糖
```

---

## 開發優先順序

1. **Session 管理層**：Redis 存對話歷史，TTL 建議 2 小時（一餐的時間）
2. **點餐 API endpoint**：包裝現有 CS agent 邏輯
3. **Prompt 固化**：點餐 prompt 存入 config，不依賴 KB 自訂 prompt
4. **JSON 驗證層**：確保 LLM 輸出格式正確，parse 失敗時 fallback
5. **API 文件**：給接入方的說明文件

---

## 商業模式建議

- 以 **API 呼叫次數** 計費（每次 /ordering/chat）
- 菜單知識庫管理介面直接用現有 CS Agent KB 管理頁
- 客戶自備廚房系統，我們只負責「語言理解 → 結構化訂單」這一段
- 可擴展至其他垂直場景：飯店客房服務、預約系統、諮詢問答

---

## 相關檔案

- PoC 使用的 KB 自訂 prompt：見對話記錄（2026-04）
- 現有 CS Agent 後端：`backend/app/api/endpoints/chat.py`
- 知識庫服務：`backend/app/services/km_service.py`
- Chat service：`backend/app/services/chat_service.py`
