# AI 模型選型指南

本文件整理本系統已驗證的 AI 模型資訊，供管理員設定 Provider 與 Model 時參考。

> **備註欄位（note）**：在新增 Model 時，可填入備註供使用者辨識，例如「速度快・適合日常問答」、「長文摘要✓」。備註會顯示在使用者的模型下拉選單中。

---

## Provider 概覽

| Provider | 代碼 | 適用場景 | 需要 API Key |
|----------|------|---------|-------------|
| OpenAI | `openai` | 通用、高品質、多語言 | ✅ |
| Google Gemini | `gemini` | 長上下文、多模態、中文 | ✅ |
| 台智雲 TWCC | `twcc` | 台灣在地、資料不出境 | ✅ |
| 本機模型 | `local` | 私有部署、離線、免費 | 通常不需要 |

---

## LLM 模型清單

### OpenAI

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `gpt-4.1` | 1M | 最新旗艦，推理能力強，支援超長文 | 高品質・長文✓ |
| `gpt-4.1-mini` | 1M | 4.1 輕量版，速度快、費用低 | 速度快・日常問答 |
| `gpt-4o` | 128K | 多模態旗艦，視覺+文字，多語言強 | 多模態・高品質 |
| `gpt-4o-mini` | 128K | 4o 輕量版，CP 值極高 | 速度快・費用低 |
| `o3-mini` | 200K | 推理模型，適合邏輯分析 | 推理強・較慢 |
| `o4-mini` | 200K | 新一代推理模型，速度優於 o3-mini | 推理快✓ |

> **Model ID 格式**：直接填寫上表的 ID，例如 `gpt-4o-mini`。

---

### Google Gemini

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `gemini/gemini-2.5-flash` | 1M | 速度快、費用低、長文處理佳 | 速度快・長文✓ |
| `gemini/gemini-2.5-pro` | 1M | Gemini 旗艦，推理與中文均優秀 | 高品質・中文✓ |
| `gemini/gemini-2.0-flash` | 1M | 穩定版 Flash，適合生產環境 | 穩定・速度快 |

> **Model ID 格式**：Gemini 模型 ID 必須加上 `gemini/` 前綴，例如 `gemini/gemini-2.5-flash`。

---

### 台智雲 TWCC

| Model ID | 特色 | 備註 |
|----------|------|------|
| `llama3-taiwan-70b-instruct` | 台灣在地、繁體中文優化 | 中文✓・資料不出境 |
| `llama3-taiwan-8b-instruct` | 輕量版，速度較快 | 速度快・在地模型 |

> **API Base URL**：台智雲必須填寫 Base URL，請至 TWCC 平台取得，格式例：`https://api-ams.twcc.ai/api/models/conversation`。

---

### 本機模型（Local / Ollama / LM Studio）

#### Ollama 常用模型

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `ollama/llama3.3` | 128K | Meta 旗艦，多語言佳 | 多語言・免費 |
| `ollama/llama3.1:8b` | 128K | 輕量版，適合低資源環境 | 輕量・速度快 |
| `ollama/qwen2.5:72b` | 128K | 阿里雲大模型，繁體中文優秀 | 中文✓・免費 |
| `ollama/qwen2.5:7b` | 128K | Qwen 輕量版，中文表現仍佳 | 中文✓・輕量 |
| `ollama/mistral` | 32K | 歐洲開源，英文強 | 英文✓・免費 |
| `ollama/phi4` | 16K | Microsoft 小模型，推理能力強 | 推理✓・輕量 |
| `ollama/deepseek-r1:7b` | 128K | 推理模型，數學/邏輯分析 | 推理強・免費 |

> **Model ID 格式**：Ollama 模型需加上 `ollama/` 前綴。在填入前，請先確認已在 Ollama 執行 `ollama pull <模型名稱>`。

> **API Base URL**：Ollama 預設為 `http://localhost:11434`，遠端部署請改為伺服器 IP，例：`http://192.168.1.10:11434`。

#### LM Studio

- API Base URL：`http://localhost:1234`（LM Studio 預設）
- Model ID：依 LM Studio 所載入的模型名稱填寫（可在 LM Studio 介面中查看）

---

## Embedding 模型

Embedding 模型用於知識庫文件的向量化，**一旦鎖定後更換需重新上傳所有文件**，請謹慎選擇。

| 模型 | Provider | 維度 | 備註 |
|------|----------|------|------|
| `text-embedding-3-small` | OpenAI | 1536 | 預設推薦，品質與費用均衡 |
| `text-embedding-3-large` | OpenAI | 3072 | 高精度，費用較高 |
| `nomic-embed-text` | Local (Ollama) | 768 | 本機 Embedding 首選，與系統 schema 一致 |

> 本機 Embedding 請先執行：`ollama pull nomic-embed-text`

---

## 常見問題

### Q：Model ID 填錯會怎樣？
系統在測試時會直接打 API，若 ID 不正確會出現連線錯誤。請使用「測試」按鈕驗證。

### Q：可以同時啟用多個 Provider 嗎？
可以。每個 Provider 獨立設定，使用者在 AI 設定面板選擇的 Model 決定使用哪個 Provider。

### Q：備註（note）應該寫什麼？
建議寫能讓使用者快速理解的短句，例如：
- `速度快・適合日常問答`
- `高品質・長文摘要✓`
- `中文優化・資料不出境`
