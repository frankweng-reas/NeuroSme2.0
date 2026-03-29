"""Tenants API：CRUD，僅 super_admin 可存取"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.tenant import Tenant
from app.models.tenant_agent import TenantAgent
from app.models.user import User
from app.schemas.tenant import TenantCreate, TenantResponse, TenantUpdate


class TenantAgentsUpdate(BaseModel):
    agent_ids: list[str]

router = APIRouter()


def _require_super_admin(current: User) -> None:
    if str(getattr(current, "role", "")) != "super_admin":
        raise HTTPException(status_code=403, detail="需 super_admin 權限")


@router.get("/", response_model=list[TenantResponse])
def list_tenants(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """列出所有 tenants（僅 super_admin）"""
    _require_super_admin(current)
    return db.query(Tenant).order_by(Tenant.id).all()


@router.post("/", response_model=TenantResponse)
def create_tenant(
    body: TenantCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """新增 tenant（僅 super_admin）"""
    _require_super_admin(current)
    existing = db.query(Tenant).filter(Tenant.id == body.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tenant ID 已存在")
    tenant = Tenant(id=body.id, name=body.name)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


@router.patch("/{tenant_id}", response_model=TenantResponse)
def update_tenant(
    tenant_id: str,
    body: TenantUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """更新 tenant（僅 super_admin）"""
    _require_super_admin(current)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    setattr(tenant, "name", body.name)
    db.commit()
    db.refresh(tenant)
    return tenant


@router.delete("/{tenant_id}", status_code=204)
def delete_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """刪除 tenant（僅 super_admin）。若有關聯 users 等會失敗"""
    _require_super_admin(current)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    try:
        db.delete(tenant)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="無法刪除：此 tenant 有關聯的使用者或資料，請先移除關聯",
        )
    return None


@router.get("/{tenant_id}/agents")
def get_tenant_agents(
    tenant_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """取得該 tenant 可使用的 agent_id 清單（僅 super_admin）"""
    _require_super_admin(current)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    rows = db.query(TenantAgent.agent_id).filter(TenantAgent.tenant_id == tenant_id).all()
    return {"agent_ids": [r.agent_id for r in rows]}


@router.put("/{tenant_id}/agents")
def update_tenant_agents(
    tenant_id: str,
    body: TenantAgentsUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """更新該 tenant 可使用的 agent 清單（僅 super_admin）"""
    _require_super_admin(current)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    # 驗證 agent_ids 皆存在於 agent_catalog（以 agent_catalog.agent_id 比對）
    catalog_ids = {r.agent_id for r in db.query(AgentCatalog.agent_id).filter(AgentCatalog.agent_id.in_(body.agent_ids)).all()}
    invalid = set(body.agent_ids) - catalog_ids
    if invalid:
        raise HTTPException(status_code=400, detail=f"無效的 agent_id: {sorted(invalid)}")
    db.query(TenantAgent).filter(TenantAgent.tenant_id == tenant_id).delete()
    for aid in body.agent_ids:
        db.add(TenantAgent(tenant_id=tenant_id, agent_id=aid))
    db.commit()
    return {"agent_ids": body.agent_ids}
