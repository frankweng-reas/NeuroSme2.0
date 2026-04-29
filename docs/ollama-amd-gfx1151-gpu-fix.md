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

> **注意**：後來改為雙實例架構，OLLAMA_HOST 改為 `127.0.0.1:11435`，詳見「問題五」。

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

## 問題四：OLLAMA_NUM_PARALLEL 設定優化與 Vision 並發問題

### 背景

初始設定 `OLLAMA_NUM_PARALLEL=2`，後來評估 VRAM 仍有大量空間，於 2026-04-27 進行壓測調整。

### VRAM 分析

| 項目 | 數值 |
|------|------|
| GPU VRAM 總量 | 96 GB（APU unified memory，`mem_info_vram_total`） |
| gemma4:26b at NUM_PARALLEL=2 | 32 GB |
| 每個 KV cache（262144 ctx） | ~7.5 GB |
| 估算公式 | 模型權重 ~17 GB + KV cache × N |

| NUM_PARALLEL | 估計 VRAM | 剩餘 VRAM |
|------|------|------|
| 2 | 32 GB | 63 GB |
| 4 | 47 GB | 48 GB |
| 6 | 62 GB | 33 GB |
| 8 | 77 GB | 18 GB |

### 文字壓測結果（4 並發請求 × 2 輪，模型 gemma4:26b，context 262144）

| 指標 | NUM_PARALLEL=2 | NUM_PARALLEL=4 | 改善幅度 |
|------|----------------|----------------|----------|
| VRAM 使用 | 32 GB | 46 GB | +14 GB |
| 整批吞吐量 | ~35 tok/s | ~57 tok/s | **+63%** |
| TTFT 平均 | 4.48s | 0.74s | **快 6×** |
| TTFT 最慢 | 8.95s | 0.95s | **快 9×** |
| 平均回應時間 | 11.61s | 9.15s | 快 21% |
| 每請求 tok/s 均 | 13.6 | 15.5 | 快 14% |

**根本原因**：設 2 時，4 個並發請求有 2 個需排隊等待空閒 slot，造成 TTFT 飆升（最慢 8.95s）。設 4 後每個請求立即取得 slot，不排隊。

### Vision（OCR）並發問題

**症狀**：`NUM_PARALLEL > 1` 時，只要有任何 vision 請求並發（含 1 vision + 1 text），Ollama 服務端 LLM 推論階段就會 hang，最終回傳 500（1m30s timeout）。

**根本原因**：Ollama v0.21.2 的 scheduler 在 `NUM_PARALLEL > 1` 時嘗試真正平行執行；Vulkan backend（Flash Attention 開啟）處理多模態並發 batch 時存在死鎖問題，視覺 token 整合進 LLM 的路徑會卡死。`NUM_PARALLEL=1` 時循序執行可避免此問題。

**失敗的嘗試**：
- 降低 `num_ctx` 到 8192 → 無效
- 關閉 `OLLAMA_FLASH_ATTENTION` → 無法，關掉後 compute graph 超出 Vulkan 單 buffer 限制（38.8 GB），模型無法載入
- 升級 Ollama v0.20.7 → v0.21.2 → 單次 vision 成功，但並發仍失敗

---

## 問題五：三實例 + Nginx 負載均衡（最終架構）

### 方案說明

為同時滿足「文字高吞吐」、「vision 穩定性」、「3 使用者並發不排隊」，採用 **三 Ollama 實例 + Nginx least_conn** 架構：

```
外部請求 → nginx :11434 (least_conn)
                ├── ollama  :11435  (NUM_PARALLEL=1, ~24 GB VRAM)
                ├── ollama2 :11436  (NUM_PARALLEL=1, ~24 GB VRAM)
                └── ollama3 :11437  (NUM_PARALLEL=1, ~24 GB VRAM)
```

- 每個實例 `NUM_PARALLEL=1`，確保 vision 穩定循序處理（無 Vulkan 並發死鎖問題）
- 三個實例合計可同時處理 **3 個平行請求**，不排隊
- 總 VRAM：~71 GB / 96 GB（剩餘 ~25 GB 緩衝）
- embedding model（nomic-embed-text）由 nginx 自動分流到最閒的實例，VRAM 佔用可忽略

### VRAM 規劃

| 實例數 | VRAM 用量 | 剩餘 |
|--------|-----------|------|
| 2 個 | ~48 GB | 48 GB |
| **3 個（目前）** | **~71 GB** | **~25 GB** |
| 4 個 | ~96 GB | ~0 GB ⚠️ 不建議 |

### Nginx Host Header 注意事項（重要）

Ollama v0.21.x 加入 **Host header 安全驗證**，只接受 `localhost`、`127.0.0.1` 或 `OLLAMA_HOST` 設定值。若 nginx 直接轉發外部 IP 的 Host header（如 `100.127.247.43:11434`），ollama 會回傳 `403 Forbidden`。

**解法**：nginx 固定送 `Host: localhost` 給後端：
```nginx
proxy_set_header   Host   "localhost";
```

### 安裝步驟

#### 1. 修改 ollama (11435) override.conf

```ini
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11435"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_VULKAN=1"
Environment="VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=1"
```

#### 2. 建立 ollama2 / ollama3 service（相同結構，port 不同）

`/etc/systemd/system/ollama2.service`（ollama3 同結構，改 Description 即可）：

```ini
[Unit]
Description=Ollama Service (Instance 2)
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

[Install]
WantedBy=default.target
```

各自的 override.conf（port 分別為 11436、11437）：

```ini
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11436"   # ollama3 改為 11437
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_VULKAN=1"
Environment="VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=1"
```

#### 3. 安裝 nginx + 設定 /etc/nginx/conf.d/ollama-lb.conf

```nginx
upstream ollama_pool {
    least_conn;
    server 127.0.0.1:11435;
    server 127.0.0.1:11436;
    server 127.0.0.1:11437;
}

server {
    listen 11434 default_server;
    listen [::]:11434 default_server;

    client_max_body_size 50M;
    proxy_read_timeout    300s;
    proxy_connect_timeout  10s;
    proxy_send_timeout    300s;

    location / {
        proxy_pass         http://ollama_pool;
        proxy_http_version 1.1;
        proxy_set_header   Host              "localhost";
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   Connection        "";
        proxy_buffering    off;
    }
}
```

#### 4. 啟動

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
sudo systemctl enable ollama2 --now
sudo systemctl enable ollama3 --now
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### 開機自動暖機（ollama-warmup.service）

`/etc/systemd/system/ollama-warmup.service`：

```ini
[Unit]
Description=Ollama Vision Warmup (preload model on boot)
After=ollama.service ollama2.service ollama3.service network-online.target
Requires=ollama.service ollama2.service ollama3.service

[Service]
Type=oneshot
User=test
ExecStartPre=/bin/sleep 10
ExecStart=/usr/bin/python3 /usr/local/bin/ollama_vision_warmup.py 127.0.0.1
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

暖機腳本 `scripts/ollama_vision_warmup.py` 會對三個實例各發一次文字請求，觸發模型載入 VRAM，讓第一個真實 request 直接推論不需等待。

```bash
sudo systemctl enable ollama-warmup
```

### 驗證結果（2026-04-27）

| 測試 | 結果 |
|------|------|
| Instance-1 (11435) 暖機 | ✅ 0.5s（已預載） |
| Instance-2 (11436) 暖機 | ✅ 0.5s（已預載） |
| Instance-3 (11437) 暖機 | ✅ 首次載入 ~8s |
| 透過 nginx 同時 1 vision + 1 text | ✅ Vision 2.9s / Text 5.3s |
| 三個頁面同時送 request | ✅ 分流到 3 個實例，各自獨立處理 |
| VRAM 穩定使用 | ✅ ~71 GB / 96 GB |

壓測腳本位於 `scripts/benchmark_ollama_parallel.py`，可隨時重新評估。

---

## 注意事項

- Ollama 啟動時仍會先嘗試 ROCm discovery，約需 **30 秒** 才 timeout 切換到 Vulkan（正常現象）
- `KEEP_ALIVE=-1`：模型載入後永遠留在 VRAM，重開機後 `ollama-warmup.service` 自動預熱三個實例
- 三實例架構總 VRAM：~71 GB / 96 GB，剩餘 ~25 GB 緩衝
- `gemma4:e4b` 等待 Ollama 修復 Vulkan MoE 支援後才可用
- Ollama v0.21.x Host header 安全驗證：nginx 必須送 `Host: localhost`，否則 403
- Embedding model（nomic-embed-text）自動分流，不需特別設定，VRAM 佔用可忽略

---

## 相關 Issue

- [Ollama #15420 - ROCm bootstrap bug on gfx1151](https://github.com/ollama/ollama/issues/15420)
- [Ollama #15288 - /v1/chat/completions 不支援 think 參數](https://github.com/ollama/ollama/issues/15288)
- [Ollama #15261 - Vulkan + gemma4:e4b 在 AMD iGPU 輸出亂碼](https://github.com/ollama/ollama/issues/15261)
- [Ollama #15285 - AMD APU bad allocation for gemma4:eXb](https://github.com/ollama/ollama/issues/15285)
