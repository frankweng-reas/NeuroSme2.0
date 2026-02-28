"""API 路由彙總：掛載 users、agents 等 endpoint"""
from fastapi import APIRouter
from app.api.endpoints import users, agents, chat

router = APIRouter()
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(agents.router, prefix="/agents", tags=["agents"])
router.include_router(chat.router, prefix="/chat", tags=["chat"])
