"""QtnProjects API：建立、列表報價專案"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.qtn_project import QtnProject
from app.models.qtn_sequence import QtnSequence
from app.models.user import User
from app.schemas.qtn_project import (
    QtnProjectCreate,
    QtnProjectDraftUpdate,
    QtnProjectFinalUpdate,
    QtnProjectResponse,
    QtnProjectStatusUpdate,
    QtnProjectUpdate,
)
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


@router.get("/next-quotation-no")
def get_next_quotation_no(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict[str, str]:
    """取得下一個報價單號（格式：QN{year}-{seq:04d}，每年重設流水號）"""
    tenant_id, _ = _check_agent_access(db, current, agent_id)
    year = datetime.now().year

    result = db.execute(
        select(QtnSequence)
        .where(QtnSequence.year == year, QtnSequence.tenant_id == tenant_id)
        .with_for_update()
    )
    row = result.scalars().first()
    if row:
        row.last_seq += 1
        next_seq = row.last_seq
    else:
        seq = QtnSequence(year=year, tenant_id=tenant_id, last_seq=1)
        db.add(seq)
        next_seq = 1
    db.commit()

    quotation_no = f"QN{year}-{next_seq:04d}"
    return {"quotation_no": quotation_no}


@router.post("/", response_model=QtnProjectResponse)
def create_qtn_project(
    body: QtnProjectCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增報價專案"""
    tenant_id, agent_id = _check_agent_access(db, current, body.agent_id)

    name = (body.project_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="專案名稱不可為空")

    proj = QtnProject(
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=agent_id,
        project_name=name,
        project_desc=(body.project_desc or "").strip() or None,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return QtnProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        status=proj.status,
    )


@router.get("/", response_model=list[QtnProjectResponse])
def list_qtn_projects(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 agent 的報價專案列表"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    projects = (
        db.query(QtnProject)
        .filter(
            QtnProject.user_id == str(current.id),
            QtnProject.tenant_id == tenant_id,
            QtnProject.agent_id == aid,
        )
        .order_by(QtnProject.created_at.desc())
        .all()
    )
    return [
        QtnProjectResponse(
            project_id=p.project_id,
            project_name=p.project_name,
            project_desc=p.project_desc,
            created_at=p.created_at,
            qtn_draft=p.qtn_draft,
            qtn_final=p.qtn_final,
            status=p.status,
        )
        for p in projects
    ]


@router.patch("/{project_id}", response_model=QtnProjectResponse)
def update_qtn_project(
    project_id: str,
    body: QtnProjectUpdate,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新報價專案名稱與描述"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(QtnProject)
        .filter(
            QtnProject.project_id == project_id,
            QtnProject.user_id == str(current.id),
            QtnProject.tenant_id == tenant_id,
            QtnProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    name = (body.project_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="專案名稱不可為空")

    proj.project_name = name
    proj.project_desc = (body.project_desc or "").strip() or None
    db.commit()
    db.refresh(proj)
    return QtnProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        qtn_draft=proj.qtn_draft,
        qtn_final=proj.qtn_final,
        status=proj.status,
    )


@router.patch("/{project_id}/qtn-draft", response_model=QtnProjectResponse)
def update_qtn_draft(
    project_id: str,
    body: QtnProjectDraftUpdate,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新報價專案的 qtn_draft（報價預覽草稿）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(QtnProject)
        .filter(
            QtnProject.project_id == project_id,
            QtnProject.user_id == str(current.id),
            QtnProject.tenant_id == tenant_id,
            QtnProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    proj.qtn_draft = body.qtn_draft
    if body.qtn_draft:
        proj.status = "DRAFT"
    db.commit()
    db.refresh(proj)
    return QtnProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        qtn_draft=proj.qtn_draft,
        qtn_final=proj.qtn_final,
        status=proj.status,
    )


@router.patch("/{project_id}/qtn-final", response_model=QtnProjectResponse)
def update_qtn_final(
    project_id: str,
    body: QtnProjectFinalUpdate,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新報價專案的 qtn_final（正式報價單：賣方、買方、條款、品項等）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(QtnProject)
        .filter(
            QtnProject.project_id == project_id,
            QtnProject.user_id == str(current.id),
            QtnProject.tenant_id == tenant_id,
            QtnProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    proj.qtn_final = body.qtn_final
    db.commit()
    db.refresh(proj)
    return QtnProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        qtn_draft=proj.qtn_draft,
        qtn_final=proj.qtn_final,
        status=proj.status,
    )


@router.patch("/{project_id}/status", response_model=QtnProjectResponse)
def update_qtn_status(
    project_id: str,
    body: QtnProjectStatusUpdate,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新報價專案的 status"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(QtnProject)
        .filter(
            QtnProject.project_id == project_id,
            QtnProject.user_id == str(current.id),
            QtnProject.tenant_id == tenant_id,
            QtnProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    proj.status = body.status
    db.commit()
    db.refresh(proj)
    return QtnProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        qtn_draft=proj.qtn_draft,
        qtn_final=proj.qtn_final,
        status=proj.status,
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_qtn_project(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> None:
    """刪除報價專案（qtn_sources 會因 CASCADE 一併刪除）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(QtnProject)
        .filter(
            QtnProject.project_id == project_id,
            QtnProject.user_id == str(current.id),
            QtnProject.tenant_id == tenant_id,
            QtnProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    db.delete(proj)
    db.commit()
