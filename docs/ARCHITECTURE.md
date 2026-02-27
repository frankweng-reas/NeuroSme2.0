# NeuroSme 2.0 架構說明

以 HomePage 顯示 agents 為例，說明前後端與資料庫的資料流。

---

## 整體架構

```
┌─────────────┐     HTTP      ┌─────────────┐     SQL      ┌─────────────┐
│   Frontend  │ ────────────► │   Backend   │ ────────────► │  PostgreSQL │
│  React +    │   /api/v1/    │     FastAPI │   SQLAlchemy │   Database  │
│  React +    │   agents/     │             │              │             │
│  Tailwind   │ ◄──────────── │  SQLAlchemy │ ◄──────────── │  agents     │
└─────────────┘    JSON       └─────────────┘    ORM        └─────────────┘
```

---

## 資料庫 (PostgreSQL)

**表：** `agents`

- **id** (integer) — 主鍵
- **group_id** (varchar) — 群組 ID
- **group_name** (varchar) — 群組名稱
- **agent_id** (varchar) — 助理 ID
- **agent_name** (varchar) — 助理名稱
- **icon_name** (varchar, 可選) — 圖示名稱

---

## 後端 (FastAPI + SQLAlchemy)

**資料流：** 資料庫 → Model → Schema → API Response

- **Model** — `backend/app/models/agent.py`：定義 SQLAlchemy ORM，對應 `agents` 表
- **Schema** — `backend/app/schemas/agent.py`：定義 API 回應格式（Pydantic）
- **API** — `backend/app/api/endpoints/agents.py`：定義 `GET /api/v1/agents/`，查詢並回傳 JSON

**請求流程：**
1. 收到 `GET /api/v1/agents/`
2. 依 `Agent` model 查詢
3. 結果依 `AgentResponse` schema 轉成 JSON
4. 回傳給前端

---

## 前端 (React + TypeScript + Tailwind)

**資料流：** API → fetch → 型別 → 元件渲染

- **API** — `frontend/src/api/agents.ts`：呼叫 `getAgents()`，fetch `/api/v1/agents/`
- **型別** — `frontend/src/types/index.ts`：定義 `Agent` 介面
- **頁面** — `frontend/src/pages/HomePage.tsx`：載入 agents、以卡片顯示
- **元件** — `frontend/src/components/AgentIcon.tsx`：依 `icon_name` 顯示圖示

**請求流程：**
1. `HomePage` 掛載時呼叫 `getAgents()`
2. 透過 Vite proxy 轉發到 `http://localhost:8000/api/v1/agents/`
3. 後端回傳 JSON，前端解析為 `Agent[]`
4. 渲染卡片列表，每張卡片顯示 `group_name`、`agent_name`、`AgentIcon`

---

## 完整資料流（以 HomePage 為例）

```
1. 使用者開啟 / 
   → HomePage 載入

2. useEffect 執行 getAgents()
   → fetch('/api/v1/agents/')

3. Vite proxy 轉發到 localhost:8000
   → FastAPI 收到請求

4. agents.py: db.query(Agent).order_by(Agent.agent_id).all()
   → SQLAlchemy 查詢 agents 表

5. PostgreSQL 回傳 rows
   → 轉成 AgentResponse 列表

6. 回傳 JSON 給前端
   → setAgents(data)

7. HomePage 重新渲染
   → agents.map() 渲染每張卡片
   → AgentIcon 依 icon_name 顯示圖示
```

---

## 目錄結構

```
NeuroSme2.0/
├── frontend/           # 前端
│   └── src/
│       ├── api/        # API 呼叫
│       ├── components/ # 共用元件
│       ├── pages/      # 頁面
│       └── types/      # TypeScript 型別
│
├── backend/            # 後端
│   └── app/
│       ├── api/        # API 路由
│       ├── core/       # 設定、DB 連線
│       ├── models/     # SQLAlchemy 模型
│       └── schemas/    # Pydantic 結構
│
└── docker-compose.yml  # PostgreSQL 容器
```
