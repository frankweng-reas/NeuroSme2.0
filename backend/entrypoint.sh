#!/bin/sh
set -e

echo "[entrypoint] Running Alembic migrations..."
# 若 DB 存有舊 revision ID（bi0001 / chat0001 / base0001），alembic upgrade 會因找不到
# 對應檔案而失敗。這時先用 stamp --purge 將版本指標更新為現行的 initial001，
# 再跑 upgrade head（因為 schema 已經完整，upgrade 不會有任何新操作）。
if ! alembic upgrade head 2>&1; then
    echo "[entrypoint] Legacy revision detected, re-stamping to initial001..."
    alembic stamp --purge initial001
    alembic upgrade head
fi

echo "[entrypoint] Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
