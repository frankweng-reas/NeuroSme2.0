"""BiProjects API：建立、列表、更新、刪除商務分析專案"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.bi_project import BiProject
from app.models.user import User
from app.schemas.bi_project import BiProjectCreate, BiProjectResponse, BiProjectUpdate
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


def _check_agent_access(db: Session, user: User, agent_id: str) -> tuple[str, str]:
    """驗證使用者有權限存取該 agent"""
    tenant_id, aid = _parse_agent_id(agent_id, user.tenant_id)
    if tenant_id != user.tenant_id:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    catalog = db.query(AgentCatalog).filter(AgentCatalog.id == aid).first()
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed = get_agent_ids_for_user(db, user.id)
    if catalog.id not in allowed:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return tenant_id, aid


@router.post("/", response_model=BiProjectResponse)
def create_bi_project(
    body: BiProjectCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增商務分析專案"""
    tenant_id, agent_id = _check_agent_access(db, current, body.agent_id)

    name = (body.project_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="專案名稱不可為空")

    proj = BiProject(
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=agent_id,
        project_name=name,
        project_desc=(body.project_desc or "").strip() or None,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return BiProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        conversation_data=proj.conversation_data,
    )


@router.get("/", response_model=list[BiProjectResponse])
def list_bi_projects(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 agent 的商務分析專案列表"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    projects = (
        db.query(BiProject)
        .filter(
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .order_by(BiProject.created_at.desc())
        .all()
    )
    return [
        BiProjectResponse(
            project_id=p.project_id,
            project_name=p.project_name,
            project_desc=p.project_desc,
            created_at=p.created_at,
            conversation_data=p.conversation_data,
        )
        for p in projects
    ]


@router.patch("/{project_id}", response_model=BiProjectResponse)
def update_bi_project(
    project_id: str,
    body: BiProjectUpdate,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新商務分析專案（名稱、描述、對話紀錄）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.project_name is not None:
        name = (body.project_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="專案名稱不可為空")
        proj.project_name = name
    if body.project_desc is not None:
        proj.project_desc = (body.project_desc or "").strip() or None
    if body.conversation_data is not None:
        proj.conversation_data = body.conversation_data

    db.commit()
    db.refresh(proj)
    return BiProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        conversation_data=proj.conversation_data,
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bi_project(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> None:
    """刪除商務分析專案（bi_sources 會因 CASCADE 一併刪除）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    db.delete(proj)
    db.commit()
