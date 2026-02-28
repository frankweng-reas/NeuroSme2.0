"""Agents API：GET /agents/ 列表、GET /agents/{id} 單筆；支援 user_id 權限過濾"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.agent import Agent
from app.schemas.agent import AgentResponse
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


@router.get("/", response_model=list[AgentResponse])
def list_agents(
    db: Session = Depends(get_db),
    user_id: int | None = Query(None, description="若有則只回傳該 user 有權限的 agents"),
):
    agents = db.query(Agent).order_by(Agent.id).all()
    if user_id is not None:
        allowed_ids = get_agent_ids_for_user(db, user_id)
        agents = [a for a in agents if a.id in allowed_ids]
    return agents


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user_id: int | None = Query(None, description="若有則檢查權限，無權限回 403"),
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if user_id is not None:
        allowed_ids = get_agent_ids_for_user(db, user_id)
        if agent.id not in allowed_ids:
            raise HTTPException(status_code=403, detail="無權限存取此助理")
    return agent
