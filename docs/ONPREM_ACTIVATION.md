# NeuroSme On-Prem 首次啟用作業說明

本文件說明 NeuroSme on-prem 版本的完整啟用流程，分為「REAS 內部作業」與「客戶端作業」兩部分。

---

## 流程總覽

```
REAS 業務／工程師                    客戶
      │                               │
      ├─ 1. 確認採購清單              │
      ├─ 2. reas-portal 產生 Code ──→  收到 Code（email）
      ├─ 3. 交付安裝包           ──→  下載安裝包
      │                               ├─ 4. 安裝系統
      │                               ├─ 5. 首次登入
      │                               ├─ 6. 貼入 Code → 系統啟用
      │                               └─ 7. 建立使用者、設定權限
```

---

## Part 1：REAS 內部作業

### Step 1：確認採購清單

確認客戶購買的 agent 模組，對應 `agent_catalog` 的 `agent_id`：

**目前 reas-portal 已啟用（可授權）：**

| agent_id   | 名稱                    | 群組     |
|------------|-------------------------|----------|
| `chat`     | Chat Agent              | 生產管理 |
| `business` | Business Insight Agent  | 銷售管理 |

**其他已定義、尚未在 reas-portal 啟用的 agents（需修改 `reas-portal/backend/app/core/agent_defs.py` 解除註解後才可授權）：**

| agent_id     | 名稱                     | 群組     |
|--------------|--------------------------|----------|
| `order`      | Order Agent              | 生產管理 |
| `quotation`  | Quotation Agent          | 銷售管理 |
| `customer`   | Customer Insight Agent   | 銷售管理 |
| `interview`  | Interview Agent          | 人資管理 |
| `scheduling` | Scheduling Agent         | 人資管理 |
| `workorder`  | Work Order Agent         | 研發管理 |
| `invoice`    | Invoice Agent            | 財務管理 |

> 新增可授權 agent 時，需同步更新 `reas-portal/backend/app/core/agent_defs.py` 與 `NeuroSme2.0/backend/app/core/agent_catalog_defs.py`。

---

### Step 2：透過 reas-portal 產生 Activation Code

Activation Code 統一由 **reas-portal** 發放，不再透過 NeuroSme 管理後台操作。

#### reas-portal 說明

- **用途**：REAS 內部工具，管理所有客戶的 NeuroSme on-prem 授權發放歷史。
- **部署**：`docker compose up -d`（reas-portal repo 根目錄），對外埠 `5174`。
- **認證**：以 `X-API-Key`（`PORTAL_API_KEY`）存取；需設定與 NeuroSme `ACTIVATION_SECRET` **相同的密鑰**（詳見 reas-portal 的 `config.py`）。

#### 操作步驟

1. 進入 reas-portal（例：`http://內部伺服器IP:5174`）
2. 於「客戶列表」確認客戶是否已存在；若無，點擊「新增客戶」建立
3. 點擊客戶名稱，進入客戶詳情頁
4. 點擊「新增授權碼」：
   - **勾選 Agents**：依採購清單勾選對應模組
   - **到期日**：依合約填寫（年約填一年後；永久授權留空）
5. 點擊「產生」，系統顯示 Activation Code
6. 點擊「複製」，將 Code 傳送給客戶（email 或業務通訊）

> **注意**：reas-portal 會保存每次發碼歷史，可於客戶詳情頁查閱。若客戶 Code 遺失，可依歷史記錄確認原始參數，**重新產生新 Code**（舊 Code 仍有效，不會自動失效）。

---

### Step 3：交付安裝包

在 VM 上執行以下指令產生交付包：

```bash
bash ~/scripts/build-onprem.sh
```

產出：`~/release/neurosme-onprem-v1.0.5.tar.gz`

壓縮包內容：

- `images/neurosme-backend.tar.gz`（後端 image）
- `images/neurosme-frontend.tar.gz`（前端 image）
- `images/localauth.tar.gz`（認證服務 image）
- `docker-compose.onprem.yml`（啟動設定）
- `Caddyfile`（HTTPS / TLS 設定）
- `certs/`（SSL 憑證存放目錄，含 README.md）
- `start.sh`（首次安裝 / 升版啟動腳本）
- `restart.sh`（日常重啟腳本）
- `QUICKSTART.md`（客戶快速啟動說明）

將此壓縮檔透過 SCP、USB 或雲端硬碟傳送給客戶 IT。

---

## Part 2：客戶端作業

### Step 4：安裝系統（一次性）

**解壓縮：**
```bash
tar xzf neurosme-onprem-v1.0.5.tar.gz
cd neurosme-onprem-v1.0.5
```

**執行啟動腳本：**
```bash
bash start.sh
```

腳本會自動：
1. 檢查 Docker 環境
2. 詢問 domain 或伺服器 IP，並自動設定 HTTPS
3. 載入 Docker images
4. 啟動所有服務

> **自備憑證（內網環境）**：若您的伺服器無法對外連線，且不想使用自簽憑證，請先閱讀 [ONPREM_HTTPS.md](./ONPREM_HTTPS.md) 完成憑證設定，再執行 `bash start.sh`。

確認服務正常運行：
```bash
docker compose -f docker-compose.onprem.yml ps
```

所有服務應顯示 `running`。

> **資料儲存位置**：所有資料統一存放於 `~/neurosme-data/`，與安裝包目錄無關（Mac / Linux 皆適用）。安裝包目錄（`neurosme-onprem-v1.0.x/`）可在確認服務正常後安全刪除。

---

### Step 5：首次登入

開啟瀏覽器進入系統（`start.sh` 執行完成後會顯示完整網址，例如 `https://neurosme.company.com`）。

預設 admin 帳號：
- **Email**：`admin@local.dev`
- **密碼**：`Admin1234!`

> **重要**：登入後請立即至「帳號設定」修改預設密碼。

---

### Step 6：輸入 Activation Code（系統啟用）

登入後系統會自動彈出啟用對話框：

```
┌─────────────────────────────────────┐
│  🔑 系統啟用                         │
│                                     │
│  請輸入您的 Activation Code         │
│  以啟用已購買的功能模組。            │
│                                     │
│  [ 貼入 Code...                   ] │
│                                     │
│  [  啟用系統  ]                     │
└─────────────────────────────────────┘
```

1. 將 REAS 提供的 Activation Code 貼入欄位
2. 點擊「啟用系統」
3. 出現「系統已啟用」提示後，頁面自動重新整理
4. 已購買的助理模組即會出現在首頁

> 若啟用失敗，請確認 Code 是否完整複製（包含 `.` 分隔符號）。

---

### Step 7：建立使用者與設定 Agent 權限

**建立使用者：**

1. 進入「管理工具」→「會員管理」
2. 點擊「新增使用者」，填入 email、姓名、初始密碼
3. 系統會自動建立帳號

**設定 Agent 權限：**

1. 進入「管理工具」→「Agent 權限設定」
2. 左側選擇使用者
3. 右側勾選該使用者可存取的 agent 模組
4. 設定角色（`member` / `manager` / `admin`）
5. 點擊「儲存」

角色說明：
- `member`：一般使用者，只能使用被授權的 agents
- `manager`：進階使用者（依系統設定）
- `admin`：可管理使用者與權限設定

---

## Part 3：加購 Agent 模組

當客戶加購新模組時：

1. **REAS 端**：登入 reas-portal → 進入該客戶詳情頁 → 「新增授權碼」→ 勾選新增模組（含原有模組）→ 產生並傳送給客戶
2. **客戶端**：進入「管理工具」→「Agent 權限設定」，點擊頁面右上角的「重新啟用」輸入新 Code

> 重新啟用後，新模組會立即出現，原有設定不受影響。

---

## Part 4：常見問題排除

**登入後沒有出現啟用對話框**
確認登入帳號為 `admin` 角色（`super_admin` 不顯示此對話框）。

**輸入 Code 後顯示「Code 無效或已被竄改」**
Code 複製不完整，請重新完整複製後再試（包含 `.` 分隔符號）。

**輸入 Code 後顯示「Code 已到期」**
聯繫 REAS，於 reas-portal 重新產生新的 Activation Code。

**啟用後 Agent 沒有出現**
確認已在「Agent 權限設定」將 agent 授權給使用者。

**忘記預設密碼**
預設密碼為 `Admin1234!`；若已修改且遺忘，聯繫 REAS 協助重設。

**需授權尚未在 reas-portal 啟用的 agent**
修改 `reas-portal/backend/app/core/agent_defs.py`，解除目標 agent 的註解後重新部署 reas-portal；同時確認 NeuroSme 的 `agent_catalog_defs.py` 也已包含該 agent。

---

## 附錄：角色與權限說明

**member**
- 使用被授權的 agents

**manager**
- 使用被授權的 agents（進階功能依系統設定）

**admin**
- 使用被授權的 agents
- 管理使用者帳號
- 設定使用者的 Agent 權限
- 輸入 Activation Code 啟用系統

**super_admin**（REAS 內部使用）
- 所有 admin 功能
- 管理 Tenants 與 Agent Catalog
- 不顯示啟用對話框（bypass）

---

## 附錄：reas-portal 快速參考

| 項目 | 說明 |
|------|------|
| Repo | `reas-portal/` |
| 啟動 | `docker compose up -d`（reas-portal 根目錄） |
| 對外埠 | `5174` |
| 認證 | HTTP Header `X-API-Key: <PORTAL_API_KEY>` |
| 密鑰同步 | `ACTIVATION_SECRET` 必須與 NeuroSme `docker-compose.onprem.yml` 一致（見下方說明） |
| Agent 清單維護 | `reas-portal/backend/app/core/agent_defs.py` |
| 發碼歷史 | 儲存於 reas-portal 的 PostgreSQL（`issued_codes` 表） |

---

## 附錄：ACTIVATION_SECRET 設計說明

### 為什麼所有客戶共用同一個 secret？

NeuroSme on-prem 採用**統一交付**策略：所有客戶收到的 `docker-compose.onprem.yml` 完全相同，不針對個別客戶客製化。

`ACTIVATION_SECRET` 的用途是**防止 Activation Code 被偽造**（HMAC-SHA256 簽名驗證），而非用來區分客戶身份。客戶的授權內容（購買的 agents、到期日）已編碼在 Code 本身，共用 secret 不影響安全性。

### 各元件的設定方式

| 元件 | 設定方式 | 值 |
|---|---|---|
| `docker-compose.onprem.yml` | 寫死（統一交付） | `b00874c6...` |
| `reas-portal/backend/config.py` | 寫死（配合統一） | 同上 |
| `NeuroSme backend/.env`（開發伺服器） | `.env`（開發環境） | 同上 |

> **注意**：若未來需要更換 secret，三個地方必須同步修改，並重新打包交付新版安裝包給所有客戶。
