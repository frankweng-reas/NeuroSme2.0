"""AgentCatalog API：CRUD，僅 super_admin 可存取"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.user import User
from app.schemas.agent_catalog import AgentCatalogCreate, AgentCatalogResponse, AgentCatalogUpdate

router = APIRouter()


def _require_super_admin(current: User) -> None:
    if current.role != "super_admin":
        raise HTTPException(status_code=403, detail="需 super_admin 權限")


@router.get("/", response_model=list[AgentCatalogResponse])
def list_agent_catalog(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出所有 agent_catalog（僅 super_admin）"""
    _require_super_admin(current)
    return db.query(AgentCatalog).order_by(
        AgentCatalog.sort_id.asc().nulls_last(),
        AgentCatalog.id.asc(),
    ).all()


@router.post("/", response_model=AgentCatalogResponse)
def create_agent_catalog(
    body: AgentCatalogCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增 agent（僅 super_admin）"""
    _require_super_admin(current)
    existing = db.query(AgentCatalog).filter(AgentCatalog.id == body.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent ID 已存在")
    catalog = AgentCatalog(
        id=body.id,
        sort_id=body.sort_id,
        group_id=body.group_id,
        group_name=body.group_name,
        agent_id=body.agent_id,
        agent_name=body.agent_name,
        icon_name=body.icon_name,
    )
    db.add(catalog)
    db.commit()
    db.refresh(catalog)
    return catalog


@router.patch("/{agent_id}", response_model=AgentCatalogResponse)
def update_agent_catalog(
    agent_id: str,
    body: AgentCatalogUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新 agent（僅 super_admin）"""
    _require_super_admin(current)
    catalog = db.query(AgentCatalog).filter(AgentCatalog.id == agent_id).first()
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    catalog.sort_id = body.sort_id
    catalog.group_id = body.group_id
    catalog.group_name = body.group_name
    catalog.agent_id = body.agent_id
    catalog.agent_name = body.agent_name
    catalog.icon_name = body.icon_name
    db.commit()
    db.refresh(catalog)
    return catalog


@router.delete("/{agent_id}", status_code=204)
def delete_agent_catalog(
    agent_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除 agent（僅 super_admin）"""
    _require_super_admin(current)
    catalog = db.query(AgentCatalog).filter(AgentCatalog.id == agent_id).first()
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    try:
        db.delete(catalog)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="無法刪除：此 agent 有關聯資料，請先移除關聯",
        )
    return None
