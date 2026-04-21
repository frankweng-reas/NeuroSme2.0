# CS Agent API 使用說明

NeuroSme CS Agent API 讓你的 App、LINE Bot、CRM 等外部系統能夠直接呼叫知識庫問答（RAG），無需嵌入 Widget。

---

## 快速開始

### 1. 取得 API Key

1. 開啟 CS Agent 頁面
2. 點擊右欄「**API 整合**」Tab
3. 點擊「**建立 Key**」，輸入名稱（例：`LINE Bot 整合`）
4. **立即複製**顯示的完整 API Key（格式：`nsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`）
   > ⚠️ API Key 只會顯示一次，關閉後無法再查看

### 2. 呼叫 API

**端點**：`POST /api/v1/public/cs/query`

**認證方式**：在 HTTP Header 加入 `X-API-Key`

---

## 請求格式

```http
POST /api/v1/public/cs/query
X-API-Key: nsk_your_key_here
Content-Type: application/json

{
  "knowledge_base_id": 1,
  "question": "退貨政策是什麼？",
  "messages": [],
  "model": ""
}
```

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `knowledge_base_id` | integer | ✅ | 知識庫 ID（需屬於此 API Key 的 tenant）|
| `question` | string | ✅ | 使用者問題 |
| `messages` | array | ❌ | 對話歷史（最多保留 10 輪）|
| `model` | string | ❌ | 覆寫模型名稱；留空使用知識庫設定的模型 |

### 帶對話歷史

```json
{
  "knowledge_base_id": 1,
  "question": "那換貨流程呢？",
  "messages": [
    { "role": "user", "content": "退貨政策是什麼？" },
    { "role": "assistant", "content": "根據政策，商品可於購買後 7 天內申請退貨…" }
  ]
}
```

---

## 回應格式

```json
{
  "answer": "根據知識庫，退貨政策如下：購買後 7 天內可申請退貨…",
  "sources": [
    {
      "filename": "退貨政策.pdf",
      "excerpt": "商品購買後 7 天內，未拆封且無人為損壞可申請退貨…"
    }
  ],
  "usage": {
    "prompt_tokens": 1024,
    "completion_tokens": 128,
    "total_tokens": 1152
  },
  "model": "gpt-4o"
}
```

---

## 程式碼範例

### cURL

```bash
curl -X POST https://your-domain/api/v1/public/cs/query \
  -H "X-API-Key: nsk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "knowledge_base_id": 1,
    "question": "退貨政策是什麼？"
  }'
```

### Python

```python
import requests

response = requests.post(
    "https://your-domain/api/v1/public/cs/query",
    headers={"X-API-Key": "nsk_your_key_here"},
    json={
        "knowledge_base_id": 1,
        "question": "退貨政策是什麼？",
    }
)
data = response.json()
print(data["answer"])
```

### Node.js / TypeScript

```typescript
const res = await fetch('https://your-domain/api/v1/public/cs/query', {
  method: 'POST',
  headers: {
    'X-API-Key': 'nsk_your_key_here',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    knowledge_base_id: 1,
    question: '退貨政策是什麼？',
  }),
})
const data = await res.json()
console.log(data.answer)
```

---

## 錯誤碼

| HTTP 狀態碼 | 說明 | 解決方式 |
|------------|------|----------|
| 401 | 未提供或無效的 API Key | 確認 `X-API-Key` header 正確 |
| 404 | 知識庫不存在或無權限 | 確認 `knowledge_base_id` 屬於此 tenant |
| 400 | 未指定模型 | 在知識庫設定中選擇 LLM 模型 |
| 429 | 超過 Rate Limit（100 次/小時） | 降低請求頻率，或聯繫管理員 |
| 503 | LLM API Key 未設定 | 在 NeuroSme 管理介面設定對應 provider 的 key |

---

## 注意事項

- API Key 格式為 `nsk_` 開頭的 36 碼字串
- Rate Limit：每個 API Key **每小時 100 次**請求
- 每次請求的 token 用量可在「API 整合」Tab 查看圖表
- 撤銷 API Key 後立即失效，無法還原；請建立新 Key 替換
- 詳細 API 文件（Swagger UI）：`/api/v1/docs`
