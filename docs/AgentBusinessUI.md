# AgentBusinessUI

**路徑**：`frontend/src/pages/agents/AgentBusinessUI.tsx`

商務型 Agent 專用頁面，當 `agent_id` 含 `business` 時由 `AgentPage` 渲染此元件。

## Props

```ts
interface AgentBusinessUIProps {
  agent: Agent
}
```

## 架構

三欄式 layout，使用 `react-resizable-panels` 的 `Group` + `Panel`，可拖曳調整寬度。左、右欄 `collapsible`，可折疊。

- **左欄**：`SourceFileManager`，管理該 Agent 的來源檔案（CSV）
- **中欄**：對話區，訊息列表 + 輸入 form，呼叫 `chatCompletions`
- **右欄**：AI 設定，Model 下拉選單、User Prompt textarea

## 狀態

- `messages`：`Message[]`，user / assistant 對話紀錄
- `model`：選用的 LLM，預設 `gpt-4o-mini`
- `userPrompt`：傳給後端的額外 prompt（輸出語言、格式等）
- `input`：輸入框內容
- `isLoading`：是否正在請求 API

## localStorage

Key：`agent-business-ui-{agentId}`

儲存 `messages`、`userPrompt`、`model`，頁面載入時 `loadStored` 還原，變更時 `saveStored` 寫回。

## 前端 API

`chatCompletions`（`@/api/chat`）：POST `/api/v1/chat/completions`，傳入 `agent_id`、`model`、`user_prompt`、`content`。`system_prompt` 與 `data` 傳空字串，由後端組裝。

---

## 後端處理

**路徑**：`backend/app/api/endpoints/chat.py`

### Endpoint

`POST /api/v1/chat/completions`，需 JWT 認證。

### 流程

1. **權限檢查**：`_check_agent_access(db, current, agent_id)` 驗證 user 有權存取該 agent，回傳 `(tenant_id, agent_id)`。支援 `tenant_id:id` 或僅 `id`（用 user.tenant_id 補上）。

2. **來源檔組裝**：`_get_selected_source_files_content(db, user_id, tenant_id, agent_id)` 查詢 `SourceFile` 中 `is_selected=True` 的檔案，依 `file_name` 排序，將 `content` 以 `\n\n` 拼接成字串。若總字元數超過 `CHAT_DATA_MAX_CHARS`（預設 100,000），回傳 413。

3. **System Prompt**：`_load_system_prompt_from_file()` 讀取 `config/system_prompt_analysis.md`（專案根或 Docker `/app/config`），每次請求即時讀檔，改檔無需重啟。

4. **組裝 messages**：`_build_messages(req, data)` 依序：
   - system：`[file_prompt] + [req.system_prompt] + [參考資料: data]`，以 `\n\n` 串接
   - 若有 `req.messages` 則照序加入
   - user：`req.user_prompt + req.content`（若 user_prompt 非空則前置）

5. **Model 路由**：`_get_llm_params(model)` 依 prefix 決定 provider：
   - `gemini/*` → GEMINI_API_KEY
   - `twcc/*` → TWCC_API_KEY + TWCC_API_BASE（轉成 `openai/*` 給 LiteLLM）
   - 其他 → OPENAI_API_KEY

6. **呼叫 LiteLLM**：`litellm.acompletion`，timeout 60s，回傳 OpenAI 格式。

### 錯誤處理

- 400：`agent_id` 為空
- 403：無權限存取 agent
- 404：Agent 不存在
- 413：參考資料超過字元上限（預設 100,000 字元），請減少選用的來源檔案
- 503：API Key 或 TWCC_API_BASE 未設定

---

## 相依

- `SourceFileManager`、`ConfirmModal`、`AgentIcon`
- `chatCompletions`、`ApiError`
- `react-resizable-panels`、`lucide-react`
