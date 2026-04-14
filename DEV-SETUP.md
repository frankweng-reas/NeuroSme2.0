# 開發環境服務架構（ee.neurosme.ai / 34.85.97.228）

更新：2026-04-14

---

## 對外入口

`https://ee.neurosme.ai` → NeuroSme 前端
`https://ee.neurosme.ai:3000` → reas-portal 前端

HTTP 會自動 301 跳轉到 HTTPS。
SSL 憑證由 Let's Encrypt 提供，到期日 2026-07-13，systemd timer 自動續期。

---

## nginx（反向代理）

Docker 容器：`neurosme20-nginx-dev-1`
設定檔：`~/NeuroSme2.0/nginx.dev.conf`
docker-compose：`~/NeuroSme2.0/docker-compose.dev.yml`

監聽 port 80（redirect）、443（NeuroSme）、3000（reas-portal），
憑證路徑掛載自 host `/etc/letsencrypt`。

啟動指令：
```
cd ~/NeuroSme2.0
docker compose -f docker-compose.dev.yml up -d
```

---

## NeuroSme2.0

**前端**：Vite dev server，host 程序，port 5173
nginx port 443 → proxy → port 5173

啟動指令：
```
cd ~/NeuroSme2.0/frontend
nohup npm run dev -- --host 0.0.0.0 > /tmp/vite-neurosme.log 2>&1 &
```

**後端**：uvicorn，host 程序，port 8000

啟動指令：
```
cd ~/NeuroSme2.0/backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**資料庫**：Docker 容器 `neurosme2.0`，postgres:16，host port 5434
docker-compose：`~/NeuroSme2.0/docker-compose.yml`（dev 用，僅跑 DB）

---

## reas-portal

**前端**：Vite dev server，host 程序，port 3001
nginx port 3000 → proxy → port 3001

啟動指令：
```
cd ~/reas-portal/frontend
nohup npm run dev > /tmp/vite-reas-portal.log 2>&1 &
```

**後端**：uvicorn，host 程序，port 8080

啟動指令：
```
cd ~/reas-portal/backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

**資料庫**：Docker 容器 `reas-portal-db`，postgres:16-alpine，host port 5435

---

## LocalAuth

**服務**：Docker 容器 `localauth-app-1`，NestJS，port 4000
**資料庫**：Docker 容器 `localauth-db-1`，postgres:16，host port 5433

docker-compose 位於 `~/LocalAuth/docker-compose.yml`（或同目錄下的 onprem 版）。

NeuroSme 後端和 reas-portal 後端都透過 `http://localhost:4000` 使用 LocalAuth。

---

## 重開機後的自動恢復

Docker 容器設定了 `restart: unless-stopped`，機器重開後自動恢復。

前後端由 systemd user service 管理，也會自動啟動：

```
systemctl --user status neurosme-backend
systemctl --user status neurosme-frontend
systemctl --user status reas-portal-backend
systemctl --user status reas-portal-frontend
```

手動重啟單一服務：
```
systemctl --user restart neurosme-frontend
```

Log 位置：
- NeuroSme 前端：/tmp/neurosme-frontend.log
- NeuroSme 後端：/tmp/neurosme-backend.log
- reas-portal 前端：/tmp/reas-frontend.log
- reas-portal 後端：/tmp/reas-backend.log

---

## Port 一覽

80    nginx（HTTP，redirect 到 HTTPS）
443   nginx → NeuroSme 前端（Vite 5173）
3000  nginx → reas-portal 前端（Vite 3001）
4000  LocalAuth（Docker）
5173  NeuroSme2.0 Vite dev server（host / systemd）
3001  reas-portal Vite dev server（host / systemd）
8000  NeuroSme2.0 後端 uvicorn（host / systemd）
8080  reas-portal 後端 uvicorn（host / systemd）
5433  localauth-db（Docker）
5434  neurosme2.0 db（Docker）
5435  reas-portal-db（Docker）
