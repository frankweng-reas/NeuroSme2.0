# Chat Agent 功能概覽

通用對話代理（`agent` 為 **chat** 時使用的 **ChatAgent**）：與 LLM 多輪對話，串流顯示回覆，對話與附件存資料庫。

## 對話與模型

- **系統提示**：`prompt_type: chat_agent` 時載入專用系統提示檔（如 `system_prompt_chat_agent.md`），塑造助理行為。
- **附檔參考與 LLM cache**：可擷取為文字之附檔（含 PDF）經 `data` 併入 **同一則 system**（順序為：系統提示檔 → 請求可選之 `system_prompt` →「以下為參考資料」區塊）。**不**將該段全文併入歷史 user 訊息，讓 prompt **前段固定、變動在後**，以配合供應商 **prompt cache** 對前綴快取；**圖檔**走多模態，見「附件」一節。
- **多對話串（threads）**：側欄列出歷史對話，可切換；新對話自動建立 thread。
- **重新命名對話**：變更 thread 標題。
- **刪除對話**：刪除整個 thread。
- **模型選擇**：可選不同 LLM（與租戶設定的 OpenAI / Gemini / 台智雲等整合）；選擇會記在瀏覽器 `localStorage`（依 agent）。
- **串流回覆**：呼叫後端 SSE，畫面逐字累加助理內容；完成後與 DB 同步。
- **上下文**：送出時帶入近期數輪歷史（程式內約 8 輪），維持連貫對話。**檔案參考文字**的沿用規則另見下節「附件窗口」，與此歷史輪數無關。

## 訊息與互動

- **Markdown 顯示**：助理與使用者內容以 Markdown 渲染（含表格、程式碼區塊等）。
- **複製**：助理訊息可一鍵複製（串流結束後才顯示按鈕）。
- **再試一次**：刪除該則助理訊息後，可重新用同一則使用者問題發送（需對話順序正常）。

## 附件

> **開發中**：程式常數 `ATTACHMENT_CONTEXT_USER_ROUNDS` 暫為 **2** 輪以利測試；上線請與下述產品目標一致改回 **5**。

產品上可把附檔規則想成兩句話（細節與實作見同節後段）：

1. **有勾選（及／或本則迴紋針上傳）**：該批檔會餵給模型——**可擷取為文字者**（含 PDF）併入 **system** 附檔參考；**圖片**另以**多模態**併入該輪最後一則 **user**（須視覺模型，見「圖片與視覺模型」）。自寫入錨點的那一則 user 起算，**連續 5 次 user 發言**內都帶**同一批**（一問一答算 1 次 user）。
2. **資料夾裡全部未勾選、且本則也沒有迴紋針新檔**：**不**帶入對話檔當附檔參考送給模型（該段視為無附檔錨點；若接在舊錨點後送出，則以「空集合」建立新錨點，不再沿用上一段有檔的附檔）。

- **本機上傳（迴紋針）**：可於送出前附加多個檔案。**純文字類**（如 `.txt`、`.md`、`.csv`、`.json` 等）、**PDF**，以及常見**圖片**（如 `.png`、`.jpg`、`.webp`、`.gif` 等，依後端允許清單與單檔大小上限）；上傳後實體存 **`stored_files`** 並綁在該則 **user** 訊息，檔案 id **併入該則的錨點**、同樣受上述 5 次窗口約束。
- **參考字元上限**：**文字／PDF 擷取**合併後注入 **system**「參考資料」的長度受後端上限約束（避免一次塞入過長內容）。**圖片不寫入該段參考全文**；像素改以多模態送交模型，見下節「圖片與視覺模型」。

### 圖片與視覺模型（多模態）

- **儲存**：與其他附件相同，圖檔存 **`stored_files`**，並經 **`chat_message_attachments`** 綁在該則 **user** 訊息。
- **送 LLM**：Chat UI 在呼叫 **`/chat/completions-stream`**（或 **`/chat/completions`**）時帶 **`chat_thread_id`** 與 **`user_message_id`**（本輪該則 user 訊息 id）。後端會驗證訊息屬該 thread，將該則之**圖片附件**自 blob 讀出，並把 **Prompt 裡最後一則 user** 的 `content` 組成 OpenAI 式多模態（**文字** + 一或多張 **`image_url`**，多為 data URL）。
- **模型**：須使用**支援視覺**的供應商／模型（例如租戶設定之 **OpenAI**、**Gemini** 等，經 LiteLLM）。**台智雲**路徑目前**不支援**對話中附圖；若該則 user 實際含圖片附件，請求會回 **400**，請改選視覺模型。
- **上限**：單次送進 completion 的圖片張數、單檔大小等與 **`CHAT_INLINE_IMAGE_MAX_COUNT`**、**`CHAT_INLINE_IMAGE_MAX_BYTES`**（後端設定）對齊。
- **`GET .../llm-attachment-reference-text`**：回傳之參考全文**僅含**可擷取之文字／PDF 等；**不含**圖檔內容區塊（與上項分工一致）。

### 本對話已出現的檔（資料夾按鈕）

- 輸入列 **迴紋針旁**另有 **資料夾圖示**：點擊開啟**彈窗**（不佔用對話主畫面），列出**此 thread 曾出現過的檔**（來自歷史訊息附加檔）。
- **勾選**＝將該檔納入「本段要餵給模型的附檔集合」。**僅開啟／關閉彈窗而未變更勾選**不會改變後端狀態。

### 附件窗口（實作與邊界）

- 錨點存在 **`chat_messages.context_file_ids`**（user 訊息）；**變更勾選**或**本機新檔並送出**會寫入新錨點，**整批取代**上一段附檔集合，並**重新起算** 5 次。
- **沿用**：連續追問時，若勾選集合與上一錨點相同且未改選、亦無本機新檔，請求可**省略**再次傳同一組 id，後端仍以上一錨點為準（避免每則重送導致窗口被誤判重算）。**空勾選**與「有勾選」之切換則一定會送出新集合（含空陣列 `[]`）。
- **滿 5 次 user 發言後**：後端不再注入該錨點之檔案參考；介面會**自動取消**對話檔勾選，若要再帶檔須重新勾選並送出。
- **次數**：由後端 `ATTACHMENT_CONTEXT_USER_ROUNDS`（`chat_attachment_service`）與前端常數對齊；目標 **5**，開發中程式見上註。

### API 要點（實作者）

- `GET .../threads/{id}/files`：thread 內曾出現之檔案列表。
- `POST .../messages`：`user` 可選帶 `context_file_ids`（皆須已屬本 thread）；省略則沿用上一錨點。
- `PATCH .../messages/{id}`：更新該則 user 訊息之錨點（例如上傳完成後合併新 `file_id`）。
- `GET .../messages/{id}/llm-attachment-reference-text`：依窗口規則回傳應注入 **system 參考資料**之全文（**不含**圖檔段落）；串流前由前端取用以組 `data`。
- **`POST .../chat/completions`**、**`POST .../chat/completions-stream`**：可選 **`user_message_id`**。與 **`chat_thread_id`** 並用且該則含圖附件時，後端注入多模態 user 內容；逾時等行為對含圖請求較長，以實作為準。

## 後端與資料

- **持久化**：`chat_threads` / `chat_messages`（含可選欄位 **`context_file_ids`**（JSONB）表示 user 訊息之附檔錨點）、**`chat_message_attachments`** 與 **`stored_files`**（附件含圖）；與可選 **`chat_llm_requests`** 觀測。
- **權限**：透過現有 agent 存取檢查，僅有權限者可讀寫該 agent 的對話與附件。

## 管理後台：Chat 用量洞察（第一階）

租戶 **admin / super_admin** 可從 **`/admin/chat-insights`**（側欄「Chat 用量洞察」）檢視 Chat LLM 用量；資料來源以 **`chat_llm_requests`** 為主（必要時 join `users`、`chat_threads`）。**洞察第一階僅先做下列兩塊**，其餘見 `docs/chat-admin-insights-stories.md`（C／D／E 等）。

### 1）用量（Epic A：A-1～A-3）

- **日曆**：查詢區間以 **台北日曆（Asia/Taipei）** 解讀；DB 仍存 UTC。
- **A-1**：區間內請求數、成功／失敗／pending、token 加總與平均每請求 token 等 KPI。
- **A-2**：依模型／provider 之用量表；圖表側另有 **模型 total tokens（Top 10）** 等視覺化。
- **A-3**：依狀態分布（含圓餅）與失敗 **error_code** 排行；每日趨勢圖依**台北日**彙總。
- **介面**：Tab「用量」內結合 **recharts 圖表** 與明細表。

### 2）使用者（Epic B：B-1～B-3）

- **B-1**：活躍使用者數、有歸屬 user 之請求／token、無 user 請求數、人均請求／人均 token。
- **B-2**：依 token 或請求數 **排行**；點列可**下鑽**該使用者在區間內各 **thread** 之請求數與 token（仍為台北日區間）。
- **B-3**：**匿名顯示**開關（隱去帳號／email 於排行與下鑽標題），狀態可記在瀏覽器 `sessionStorage`。

**API（前綴 `/api/v1/chat/insights`）**：`overview`、`users-summary`、`users-leaderboard`、`users/{id}/threads` 等；完整 user story 與表結構對照仍以 `docs/chat-admin-insights-stories.md` 為準。

---

*僅描述產品能力與實作要點；細節以程式與 API 為準。*
