# NeuroSme On-Prem Online 安裝說明

適用於伺服器**可連外網**的客戶。客戶無需下載大型安裝包，一行指令完成安裝。

---

## 前置條件

| 項目 | 要求 |
|---|---|
| Docker | 已安裝（`curl -fsSL https://get.docker.com | sh`）|
| Docker Compose Plugin | 已安裝（Docker 26+ 內建）|
| Port 80 / 443 | 防火牆已開放 inbound |
| 網路 | 可連到 `ghcr.io`（GHCR）與 `portal.reas.ai`（REAS Portal）|
| Activation Code | 由 REAS 業務提供 |

---

## 客戶安裝指令

```bash
curl -fsSL https://ee.neurosme.ai:3000/install.sh | ACTIVATION_CODE="<你的授權碼>" bash
```

腳本會自動完成：
1. 驗證授權碼
2. 取得 Docker images 存取憑證
3. 詢問伺服器 domain 或 IP，自動設定 HTTPS
4. 從 GHCR 下載 Docker images
5. 啟動所有服務

安裝完成後，依提示開啟瀏覽器，用預設帳號 `admin@local.dev` / `Admin1234!` 登入，並輸入 Activation Code 啟用模組。

> **IP 選擇提示**：腳本會列出本機所有 IP，請輸入**使用者實際連線用的 IP 或 domain**。

---

## REAS 內部：發行 Online 版前的準備

### 1. 設定 GHCR Pull Token

在 GitHub 建立一個 **read-only PAT**（`read:packages` scope，No expiration）：
https://github.com/settings/tokens/new

填入 reas-portal 的 `.env`：
```env
GHCR_PULL_TOKEN=ghp_xxxxxxxxxxxx
GHCR_ORG=frankweng-reas
PORTAL_BASE_URL=https://ee.neurosme.ai:3000
```

重啟 reas-portal backend 生效。

### 2. Build + Push Images 到 GHCR

```bash
bash ~/scripts/build-onprem.sh --push
```

這會 build 4 個自建 images 並 push 到 GHCR（`:VERSION` + `:latest`）：

| Image | GHCR 路徑 |
|---|---|
| neurosme2-postgres | `ghcr.io/frankweng-reas/neurosme2-postgres` |
| neurosme-backend | `ghcr.io/frankweng-reas/neurosme-backend` |
| neurosme-frontend | `ghcr.io/frankweng-reas/neurosme-frontend` |
| localauth | `ghcr.io/frankweng-reas/localauth` |

> `caddy:2-alpine` 與 `postgres:16` 為 Docker Hub 公開 image，客戶端直接 pull，不需 push。

---

## 升版

重新執行相同指令即可。腳本會自動沿用已設定的 domain/IP，拉取最新 image 並重啟。資料目錄 `~/neurosme-data/` 不受影響。

---

## 與 Offline 安裝包的比較

| | Online 安裝 | Offline 安裝包 |
|---|---|---|
| 客戶需要網路 | ✅ 是 | ❌ 否 |
| 安裝包大小 | ~5 KB（腳本）| ~750 MB |
| 安裝指令 | `curl \| bash` | `bash start.sh` |
| 升版方式 | 重跑指令 | 解壓新包執行 `bash start.sh` |

---

## 相關文件

- [ONPREM_ACTIVATION.md](./ONPREM_ACTIVATION.md) — Activation Code 發放與啟用流程
- [ONPREM_HTTPS.md](./ONPREM_HTTPS.md) — HTTPS / 自備憑證設定
