# Ollama AMD gfx1151 (Radeon 8060S) GPU 加速修復記錄

**日期**：2026-04-16  
**機器**：`test@100.127.247.43`（AMD Ryzen AI MAX+ 395 w/ Radeon 8060S，Strix Halo APU）  
**Ollama 版本**：0.20.7

---

## 問題一：GPU 無法使用，100% CPU 執行

### 症狀

`ollama ps` 顯示 `100% CPU`，GPU VRAM 幾乎空著。

### 根本原因

Ollama v0.18+ 的已知 regression bug（[Issue #15420](https://github.com/ollama/ollama/issues/15420)）：新的 `--ollama-engine` runner 不支援 `GGML_CUDA_INIT=1`，導致 gfx1151 的 GPU 驗證永遠 timeout（30 秒），最終 fallback 到 CPU。

### 解法：改用 Vulkan Backend

ROCm 有 bug，改用 **Vulkan（Mesa RADV 25.2.8）** 作為 GPU 後端。

編輯 `/etc/systemd/system/ollama.service.d/override.conf`：

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_VULKAN=1"
Environment="VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

### 修復結果

| 項目 | 修復前 | 修復後 |
|------|--------|--------|
| 處理器 | 100% CPU | **100% GPU** |
| 推理後端 | CPU fallback | **Vulkan (RADV gfx1151)** |
| `gemma4:31b` 速度 | ~1–2 tok/s | **~10 tok/s** |

---

## 問題二：Chat Agent 回應需等待 60+ 秒

### 症狀

透過 NeuroSme Chat Agent 問問題，超過 60 秒才看到第一個字。

### 根本原因

`gemma4:31b` 預設開啟 **thinking mode**（模型在回答前先做大量內部推理），thinking token 寫入 `reasoning_content` 欄位。前端及 LiteLLM 只處理 `content` 欄位，思考期間 content 為空，造成 20–30 秒空白等待。

### 失敗的嘗試：`extra_body: {think: false}`

最初嘗試透過 LiteLLM 的 `extra_body` 傳入 `think: false`，無效。

**根本原因**：Ollama 的 OpenAI-compatible `/v1/chat/completions` endpoint **不支援 `think` 參數**（[Ollama Issue #15288](https://github.com/ollama/ollama/issues/15288)）。`think` 參數只有原生 `/api/chat` endpoint 才支援。

### 正確解法：改用 `ollama_chat/` prefix

LiteLLM 的 `ollama_chat/model` 走 Ollama 原生 `/api/chat`，正確支援 `think` 參數。

#### `backend/app/services/llm_utils.py`（新建）

```python
def resolve_litellm_model(model: str) -> str:
    # local/xxx → ollama_chat/xxx（走原生 /api/chat）
    if model.startswith("local/"):
        return f"ollama_chat/{model[6:]}"
    ...

def apply_api_base(kwargs: dict, api_base: str | None) -> None:
    # ollama_chat/ 不加 /v1，其他 provider 加 /v1
    if model.startswith("ollama_chat/"):
        kwargs["api_base"] = base  # 不加 /v1
    else:
        kwargs["api_base"] = f"{base}/v1"
```

#### `chat.py`、`chat_compute_tool.py`、`chat_dev.py`、`scheduling.py`

```python
# local/ 模型加入 think=False
if model.startswith("local/"):
    completion_kwargs["think"] = False
```

### 修復結果

| 情境 | 修復前 | 修復後 |
|------|--------|--------|
| 首個 token 等待 | 20–30 秒 | **< 2 秒** |
| 總回應時間 | 60+ 秒 | **依生成長度** |

---

## 問題三：小模型 gemma4:e4b 無法使用

### 症狀

`ollama ps` 顯示 `gemma4:e4b` 以 `55%/45% CPU/GPU` 混跑，速度極慢且輸出可能亂碼。

### 根本原因

`gemma4:e4b`（E4B）使用異構 head dimension（256/512）的 MoE 架構，Vulkan backend 目前不支援（[Ollama Issue #15261](https://github.com/ollama/ollama/issues/15261) 及 [#15285](https://github.com/ollama/ollama/issues/15285)）。

**結論**：在 gfx1151 + Vulkan 環境下，`gemma4:e4b` 不可用，等待 Ollama 官方修復。

---

## 最終採用模型：`gemma4:26b`

### 評估結果（從 VM 直接測試）

| 模型 | 架構 | Vulkan 相容 | 速度 | 備註 |
|------|------|------------|------|------|
| `gemma4:e4b` | MoE 4B active | ❌ | N/A | 輸出錯誤 |
| `gemma4:31b` | Dense 31B | ✅ | ~10 tok/s | 可用 |
| **`gemma4:26b`** | **MoE 4B active** | **✅** | **~30 tok/s** | **推薦** |

`gemma4:26b` 為 MoE 架構，每個 token 只激活 ~4B 參數，速度是 31b 的 **3 倍**，品質差距僅約 2%。

### 下載方式

```bash
ollama pull gemma4:26b
```

### NeuroSme 設定

在 `/admin/llm-settings` 新增：

| 欄位 | 值 |
|------|----|
| Provider | `local` |
| API Base URL | `http://<ollama-host>:11434` |
| Default Model | `local/gemma4:26b` |
| API Key | 留空 |

---

## 注意事項

- Ollama 啟動時仍會先嘗試 ROCm discovery，約需 **30 秒** 才 timeout 切換到 Vulkan（正常現象）
- `KEEP_ALIVE=-1`：模型載入後永遠留在 VRAM，重開機後第一個請求才重新載入
- 兩個模型（26b + 31b）同時常駐共用 72 GB VRAM，GPU 111 GB 放得下
- `gemma4:e4b` 等待 Ollama 修復 Vulkan MoE 支援後才可用

---

## 相關 Issue

- [Ollama #15420 - ROCm bootstrap bug on gfx1151](https://github.com/ollama/ollama/issues/15420)
- [Ollama #15288 - /v1/chat/completions 不支援 think 參數](https://github.com/ollama/ollama/issues/15288)
- [Ollama #15261 - Vulkan + gemma4:e4b 在 AMD iGPU 輸出亂碼](https://github.com/ollama/ollama/issues/15261)
- [Ollama #15285 - AMD APU bad allocation for gemma4:eXb](https://github.com/ollama/ollama/issues/15285)
