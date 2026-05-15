#!/usr/bin/env bash
# update-demo.sh — 更新 demo 環境（重新 build Docker image + 重啟容器）
# 使用方式：
#   ./update-demo.sh                  # 全部更新（backend + frontend）
#   ./update-demo.sh --backend-only   # 只更新 backend
#   ./update-demo.sh --frontend-only  # 只更新 frontend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export VITE_APP_VERSION="$(cat VERSION | tr -d '[:space:]')"

MODE="all"
case "${1:-}" in
  --backend-only)  MODE="backend" ;;
  --frontend-only) MODE="frontend" ;;
  "")              MODE="all" ;;
  *)
    echo "用法：$0 [--backend-only | --frontend-only]"
    exit 1
    ;;
esac

echo "=== NeuroSme Demo 環境更新 （版本：${VITE_APP_VERSION}，模式：${MODE}）==="

case "$MODE" in
  backend)
    echo "[1/2] 重新建置 demo-backend image..."
    docker compose -f docker-compose.demo.yml build --no-cache demo-backend

    echo "[2/2] 重啟 demo-backend 容器..."
    docker compose -f docker-compose.demo.yml up -d --force-recreate demo-backend
    ;;

  frontend)
    echo "[1/2] 重新建置 demo-frontend image..."
    docker compose -f docker-compose.demo.yml build --no-cache demo-frontend

    echo "[2/2] 重啟 demo-frontend 容器..."
    docker compose -f docker-compose.demo.yml up -d --force-recreate demo-frontend
    ;;

  all)
    echo "[1/2] 重新建置 demo images（frontend 靜態檔在 Docker build 時打包）..."
    docker compose -f docker-compose.demo.yml build --no-cache

    echo "[2/2] 重啟 demo 容器..."
    docker compose -f docker-compose.demo.yml up -d --force-recreate
    ;;
esac

echo ""
echo "✅ Demo 已更新：https://demo.ee.neurosme.ai"
echo "   查看 log：docker compose -f docker-compose.demo.yml logs -f"
