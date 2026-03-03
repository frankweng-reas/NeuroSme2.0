# SourceFileManager 元件

可重複使用的來源檔案管理元件，提供列表、上傳、選用、重新命名、刪除與編輯內容等功能。

## 用途

用於 Agent 頁面管理與該 Agent 關聯的來源檔案（目前僅支援 CSV 格式）。

## Props

- **agentId**（必填）：`string`，Agent ID，用於取得與上傳該 Agent 的來源檔案
- **onError**（選填）：`(message: string) => void`，錯誤回呼，發生錯誤時呼叫

## 功能

- **列表**：顯示該 Agent 的所有來源檔案
- **選用**：勾選 checkbox 設定 `is_selected`，控制檔案是否被 Agent 使用
- **上傳**：透過「新增來源」modal 上傳 CSV 檔案或輸入文字建立檔案
- **重新命名**：點擊鉛筆圖示，檔名須以 `.csv` 結尾
- **編輯內容**：點擊編輯圖示，在 modal 中修改檔案內容
- **刪除**：點擊 X 圖示，經確認後刪除

## 新增來源

- **選擇 CSV 檔案**：可多選，僅接受 `.csv` 副檔名
- **輸入文字**：輸入檔名與內容，建立新檔案（預設檔名如 `文字內容#1`）
- 重複檔名會自動略過
- 上傳時顯示進度（current/total）

## API Endpoints

路徑前綴：`/api/v1/source-files`（需認證）

**POST /** — 上傳來源檔案（CSV 內容）

- Body：`{ agent_id, file_name, content }`
- 回傳：`{ id, file_name, is_selected, created_at }`
- 400：檔名重複

**GET /** — 取得該 agent 的來源檔案列表

- Query：`agent_id`（必填）
- 回傳：`[{ id, file_name, is_selected, created_at }, ...]`

**GET /{file_id}** — 取得單一來源檔案（含 content，供編輯用）

- 回傳：`{ id, file_name, is_selected, created_at, content }`
- 404：檔案不存在

**PATCH /{file_id}** — 更新來源檔案

- Body：可部分更新 `{ is_selected?, file_name?, content? }`
- 檔名須為 `.csv` 結尾，不可與同 agent 下既有檔名重複
- 回傳：`{ id, file_name, is_selected, created_at }`
- 400：檔名格式錯誤或重複
- 404：檔案不存在

**DELETE /{file_id}** — 刪除來源檔案

- 回傳：204 No Content
- 404：檔案不存在

## 相依 API（前端）

使用 `@/api/sourceFiles` 的函式：`listSourceFiles`、`uploadSourceFile`、`createSourceFileFromText`、`updateSourceFileSelected`、`renameSourceFile`、`deleteSourceFile`、`getSourceFile`、`updateSourceFileContent`。

## 使用範例

```tsx
import SourceFileManager from '@/components/SourceFileManager'

<SourceFileManager
  agentId={agentId}
  onError={(msg) => toast.error(msg)}
/>
```
