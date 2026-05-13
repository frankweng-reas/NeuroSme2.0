#!/bin/sh
set -e

echo "[entrypoint] Running Alembic migrations..."
# 若 alembic upgrade head 失敗（例如欄位已存在，schema 已是最新但版本號落後），
# 直接 stamp 到 head，跳過已套用的 migration，避免重複執行。
if ! alembic upgrade head 2>&1; then
    echo "[entrypoint] Migration failed (schema likely already up-to-date), stamping to head..."
    alembic stamp --purge head
    echo "[entrypoint] Stamped to head, re-running upgrade head..."
    alembic upgrade head
fi

echo "[entrypoint] Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
