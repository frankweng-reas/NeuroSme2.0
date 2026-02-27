# NeuroSme 2.0

全端專案架構：前端 React + TypeScript + Tailwind CSS，後端 FastAPI + SQLAlchemy。

## 專案結構

```
NeuroSme2.0/
├── frontend/                 # 前端 (React + TypeScript + Tailwind)
│   ├── src/
│   │   ├── api/             # API 客戶端
│   │   ├── components/      # 共用元件
│   │   ├── pages/           # 頁面元件
│   │   ├── types/           # TypeScript 型別
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── backend/                  # 後端 (FastAPI + SQLAlchemy)
│   ├── app/
│   │   ├── api/             # API 路由
│   │   │   └── endpoints/
│   │   ├── core/            # 核心設定 (config, database)
│   │   ├── models/          # SQLAlchemy 模型
│   │   ├── schemas/         # Pydantic 結構
│   │   └── main.py
│   ├── alembic/             # 資料庫遷移
│   ├── requirements.txt
│   └── .env.example
│
└── README.md
```

## 快速開始

### PostgreSQL (Docker)

NeuroSme2.0 專用容器，與 local auth 的 PostgreSQL 分開：

```bash
docker compose up -d
```

- 容器名稱：`neurosme2.0`
- Port：`5434`（避免與其他產品衝突）
- 資料庫：`neurosme2`

### 後端

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # 已預設 Docker 連線
uvicorn app.main:app --reload --port 8000
# 若 8000 被佔用：port 8001，並在 frontend/.env 設 VITE_API_PORT=8001
```

API 文件：http://localhost:8000/docs

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端：http://localhost:3000

### 資料庫遷移

```bash
cd backend
# 確保 Docker PostgreSQL 已啟動
alembic revision --autogenerate -m "Initial migration"
alembic upgrade head
```

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | React 18, TypeScript, Vite, Tailwind CSS, React Router |
| 後端 | Python, FastAPI, SQLAlchemy, Pydantic |
| 資料庫 | PostgreSQL (可替換) |
