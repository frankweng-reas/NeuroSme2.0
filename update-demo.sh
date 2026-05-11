#!/usr/bin/env bash
# update-demo.sh — 更新 demo 環境（重新 build Docker image + 重啟容器）
# 使用方式：./update-demo.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== NeuroSme Demo 環境更新 ==="

echo "[1/2] 重新建置 demo images（frontend 靜態檔在 Docker build 時打包）..."
docker compose -f docker-compose.demo.yml build --no-cache

echo "[2/2] 重啟 demo 容器..."
docker compose -f docker-compose.demo.yml up -d --force-recreate

echo ""
echo "✅ Demo 已更新：https://ee.neurosme.ai:4443"
echo "   查看 log：docker compose -f docker-compose.demo.yml logs -f"
