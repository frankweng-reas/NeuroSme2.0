"""Agents API：GET /agents/ 列表、GET /agents/{id} 單筆；需登入，依 agent_catalog + tenant_agents + user_agents 過濾"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.tenant_agent import TenantAgent
from app.models.user import User
from app.schemas.agent import AgentResponse
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id（用 fallback_tenant_id）"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


def _get_tenant_purchased_agent_ids(db: Session, tenant_id: str) -> set[str]:
    """回傳該 tenant 已購買的 agent_id 集合"""
    rows = db.query(TenantAgent.agent_id).filter(TenantAgent.tenant_id == tenant_id).all()
    return {r.agent_id for r in rows}


@router.get("/", response_model=list[AgentResponse])
def list_agents(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
    is_purchased: str | None = Query(None, description="傳 'true' 則只回傳 tenant 已購買的 agents（供 admin 權限設定用）"),
):
    """取得 agents 列表。admin 且 is_purchased 時回傳 tenant 內所有已購買的 agents；否則依 user_agents ∩ tenant_agents 過濾"""
    user = current
    if is_purchased and str(is_purchased).lower() == "true" and user.role in ("admin", "super_admin"):
        # admin 權限設定：回傳 tenant 已購買的 agents
        purchased_ids = _get_tenant_purchased_agent_ids(db, user.tenant_id)
        catalogs = db.query(AgentCatalog).filter(AgentCatalog.id.in_(purchased_ids)).order_by(
            AgentCatalog.sort_id.asc().nulls_last(),
            AgentCatalog.id.asc(),
        ).all()
        return [AgentResponse.from_catalog(c, user.tenant_id) for c in catalogs]
    # 一般：回傳 user 有權限的 agents（user_agents ∩ tenant_agents）
    allowed_ids = get_agent_ids_for_user(db, user.id)
    catalogs = db.query(AgentCatalog).filter(AgentCatalog.id.in_(allowed_ids)).order_by(
            AgentCatalog.sort_id.asc().nulls_last(),
            AgentCatalog.id.asc(),
        ).all()
    return [AgentResponse.from_catalog(c, user.tenant_id) for c in catalogs]


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一 agent（需有權限）"""
    tenant_id, aid = _parse_agent_id(agent_id, current.tenant_id)
    if tenant_id != current.tenant_id:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    catalog = db.query(AgentCatalog).filter(AgentCatalog.id == aid).first()
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed_ids = get_agent_ids_for_user(db, current.id)
    if catalog.id not in allowed_ids:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return AgentResponse.from_catalog(catalog, current.tenant_id)
