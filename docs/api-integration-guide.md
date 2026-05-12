# NeuroSme Public API 整合指南

本文說明如何透過 NeuroSme Public API 將 AI 客服 Bot 整合至外部系統，例如 Facebook Messenger、LINE、自訂 App 等。

---

## 前置準備

1. 登入 NeuroSme 管理後台
2. 進入「KB Bot 助理」→ 選擇目標 Bot → 「API 整合」tab
3. 建立一組 API Key（例如備註填「LINE」或「FB Messenger」）
4. 複製 API Key（`nsk_xxxx...`），**只顯示一次，請立即保存**

---

## API 規格

### 端點

```
POST https://{你的網域}/api/v1/public/bot/query
```
例如：POST https://ee.neurosme.ai:4443/api/v1/public/bot/query

### 認證

```
X-API-Key: nsk_your_key_here
```

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `question` | string | ✅ | 本輪使用者的問題 |
| `messages` | array | — | 之前幾輪的對話歷史（多輪對話記憶用） |

`messages` 格式：
```json
[
  { "role": "user",      "content": "上一輪使用者說的話" },
  { "role": "assistant", "content": "上一輪 Bot 的回答" }
]
```

### Response Body

| 欄位 | 類型 | 說明 |
|------|------|------|
| `answer` | string | AI 回答內容 |
| `sources` | array | 引用的知識庫段落（filename + excerpt） |

---

## 範例：curl

```bash
curl -X POST https://your-domain/api/v1/public/bot/query \
  -H "X-API-Key: nsk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "那運費怎麼算？",
    "messages": [
      {
        "role": "user",
        "content": "請問可以退貨嗎？"
      },
      {
        "role": "assistant",
        "content": "可以，商品到貨 7 天內可申請退貨，請保持商品原狀並附上發票。"
      }
    ]
  }'
```

---

## 範例：Facebook Messenger Webhook（Python）

以下為最精簡的 FB Messenger connector 範例，供參考。  
**Connector 由客戶自行部署，NeuroSme 不需要任何修改。**

```python
# requirements: fastapi uvicorn httpx
from fastapi import FastAPI, Request
import httpx, os

app = FastAPI()

VERIFY_TOKEN      = os.environ["VERIFY_TOKEN"]
PAGE_ACCESS_TOKEN = os.environ["PAGE_ACCESS_TOKEN"]
NEUROSME_URL      = os.environ["NEUROSME_URL"]   # https://your-domain/api/v1/public/bot/query
NEUROSME_API_KEY  = os.environ["NEUROSME_API_KEY"]  # nsk_xxxx

# 對話歷史暫存（生產環境請換成 Redis 或資料庫）
_history: dict[str, list] = {}


@app.get("/webhook")
def verify(hub_mode: str, hub_verify_token: str, hub_challenge: str):
    if hub_verify_token == VERIFY_TOKEN:
        return int(hub_challenge)
    return {"error": "invalid token"}, 403


@app.post("/webhook")
async def receive(req: Request):
    body = await req.json()
    for entry in body.get("entry", []):
        for event in entry.get("messaging", []):
            sender = event["sender"]["id"]
            text   = event.get("message", {}).get("text")
            if not text:
                continue

            # 取對話歷史
            history = _history.get(sender, [])

            # 呼叫 NeuroSme API
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    NEUROSME_URL,
                    headers={"X-API-Key": NEUROSME_API_KEY},
                    json={"question": text, "messages": history},
                )
                answer = r.json()["answer"]

            # 更新對話歷史（保留最近 10 輪）
            history += [{"role": "user", "content": text},
                        {"role": "assistant", "content": answer}]
            _history[sender] = history[-20:]  # 最多 20 則（10 輪）

            # 回傳給 FB Messenger
            async with httpx.AsyncClient() as client:
                await client.post(
                    "https://graph.facebook.com/v19.0/me/messages",
                    params={"access_token": PAGE_ACCESS_TOKEN},
                    json={"recipient": {"id": sender},
                          "message": {"text": answer}},
                )
    return {"status": "ok"}
```

啟動方式：

```bash
VERIFY_TOKEN=my_secret \
PAGE_ACCESS_TOKEN=EAAxxxxx \
NEUROSME_URL=https://your-domain/api/v1/public/bot/query \
NEUROSME_API_KEY=nsk_your_key_here \
uvicorn fb_connector:app --host 0.0.0.0 --port 8080
```

FB Developer Console Webhook URL 填：`https://你的connector網址/webhook`

---

## 注意事項

- **Rate Limit**：每個 API Key 每小時最多 **100 次**請求。流量大請建立多把 Key 或聯繫 REAS 調整。
- **對話記憶**：NeuroSme API 本身不儲存對話歷史，**由 Connector 負責維護並每次帶入 `messages`**。
- **CORS**：Connector 是後端呼叫後端，不受 CORS 限制，不需修改 NeuroSme 設定。
- **完整 API 規格**：`https://your-domain/api/v1/public/docs`（Swagger UI）

---

*最後更新：2026-05-12*
