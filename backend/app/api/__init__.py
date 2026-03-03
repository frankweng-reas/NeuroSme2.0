"""API 路由彙總：掛載 users、agents、source_files 等 endpoint"""
from fastapi import APIRouter
from app.api.endpoints import users, agents, chat, chat_dev, source_files

router = APIRouter()
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(agents.router, prefix="/agents", tags=["agents"])
router.include_router(chat.router, prefix="/chat", tags=["chat"])
router.include_router(chat_dev.router, prefix="/chat/dev", tags=["chat-dev"])
router.include_router(source_files.router, prefix="/source-files", tags=["source-files"])
