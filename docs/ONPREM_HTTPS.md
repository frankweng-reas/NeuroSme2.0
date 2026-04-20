# NeuroSme On-Prem HTTPS 說明

NeuroSme on-prem 安裝包內建 **Caddy** 作為反向代理，原生支援 HTTPS，**不需要另外架設反向代理**。

執行 `bash start.sh` 後，腳本會詢問 domain 或 IP，**自動設定 HTTPS**，無需手動編輯任何設定檔。進階需求（自備憑證、自建反向代理等）請參考下方說明。

---

## 架構

```
瀏覽器 ──HTTPS:443──→ [Caddy] → frontend / backend / localauth
        ──HTTP:80──→  [Caddy] → 301 redirect → HTTPS
```

---

## TLS 模式選擇

執行 `bash start.sh` 時，腳本會詢問 domain 或 IP，並**自動**選擇合適的模式：

| 輸入類型 | 自動選擇 | 效果 |
|---------|---------|------|
| domain（如 `neurosme.acme.com`） | Let's Encrypt 自動申請 | 瀏覽器完全信任（綠色鎖頭） |
| IP 位址（如 `192.168.1.100`） | 自簽憑證（`tls internal`） | HTTPS 加密，瀏覽器顯示安全警告 |

### 模式 A：自備憑證（內網環境 / 公司 CA）

若公司有自己的 PKI / CA，或向 SSL 廠商購買憑證，可手動設定：

1. 將憑證放入 `certs/` 資料夾（詳見 `certs/README.md`）：
   ```
   certs/
   ├── cert.pem   ← SSL 憑證（含完整憑證鏈）
   └── key.pem    ← 私鑰
   ```

2. 編輯 `Caddyfile`，加入 `tls` 指令：
   ```
   neurosme.company.com {
       tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem

       reverse_proxy /api/*  backend:8000
       reverse_proxy /auth/* localauth:4000
       reverse_proxy *       frontend:80
   }
   ```

3. 啟動服務：
   ```bash
   bash start.sh
   ```
   > 腳本偵測到 Caddyfile 已設定，不會再詢問 domain。

### 模式 B：自動 HTTPS（公開 domain，可連外網）

適用於伺服器有公開 domain 且可連外網的環境。執行 `bash start.sh` 輸入 domain 後，Caddy 自動向 Let's Encrypt 申請並續約憑證，無需手動操作。

前提：
- domain 的 DNS 已指向此伺服器
- port 80 / 443 可從外網連入（Let's Encrypt 驗證需要）

### 模式 C：IP 自簽憑證（無 domain 的小型環境）

執行 `bash start.sh` 輸入 IP 位址時自動套用。Caddy 產生自簽憑證，HTTPS 連線正常建立，但瀏覽器會顯示「不安全」警告，需手動點擊「繼續前往」。

> 此模式已內建 `default_sni` 設定，確保 TLS 握手正常完成。

---

## CS Agent Widget 注意事項

CS Agent 的 Widget 以 `<iframe>` 嵌入客戶網站。若嵌入的目標網站是 HTTPS，NeuroSme 也**必須是 HTTPS**，否則瀏覽器的 Mixed Content 機制會靜默封鎖 iframe，Widget 完全無法顯示。

使用 Caddy 的預設設定即可滿足此需求。

另外，若客戶 IT 在 NeuroSme 前還有一層自建的反向代理，請確認該代理**不會**對回應加上 `X-Frame-Options: SAMEORIGIN`，否則會阻斷 Widget 的跨域 iframe 嵌入。

---

## 若客戶已有自建的反向代理

若客戶 IT 偏好在自己的反向代理（Nginx、F5 等）上終止 TLS，可將其 proxy 指向 NeuroSme 的 port 80（Caddy 僅做路由），或參考 `nginx.conf`（repo 內保留，非預設交付）的路由設定。

此情況下 `Caddyfile` 可改為純 HTTP 模式：

```
:80 {
    reverse_proxy /api/*  backend:8000
    reverse_proxy /auth/* localauth:4000
    reverse_proxy *       frontend:80
}
```

---

## 常見問題

**Widget 嵌入後沒有出現，也沒有報錯？**
開啟瀏覽器 DevTools → Console，若看到 `Mixed Content` 字樣，代表嵌入頁面是 HTTPS 但 NeuroSme 仍是 HTTP，請確認 Caddy TLS 設定正確。

**憑證是 self-signed，瀏覽器顯示警告？**
需將 CA 憑證匯入客戶端電腦的受信任根憑證庫，或向 IT 申請公司內部 CA 簽發的憑證。

**憑證到期後如何更新（模式 A）？**
替換 `certs/cert.pem` 與 `certs/key.pem` 後執行：
```bash
docker compose -f docker-compose.onprem.yml restart caddy
```
模式 B 由 Caddy 自動續約，無需手動操作。

**有其他系統需要直接呼叫 NeuroSme API？**
若外部系統透過 HTTPS 網域呼叫 `/api/*`，需在 `docker-compose.onprem.yml` 的 `CORS_ORIGINS` 加入對應網域：
```yaml
CORS_ORIGINS: '["https://neurosme.company.com"]'
```
一般使用者從瀏覽器透過 Caddy 存取則不需修改。
