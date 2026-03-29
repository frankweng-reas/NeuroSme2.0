"""Source Files API：上傳、列表、刪除"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.source_file import SourceFile
from app.models.user import User
from app.schemas.source_file import (
    SourceFileCreate,
    SourceFileDetailResponse,
    SourceFileResponse,
    SourceFileUpdate,
)
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id（用 fallback_tenant_id）"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


def _check_agent_access(db: Session, user: User, agent_id: str) -> tuple[str, str]:
    """驗證使用者有權限存取該 agent，回傳 (tenant_id, agent_id)"""
    tenant_id, aid = _parse_agent_id(agent_id, user.tenant_id)
    if tenant_id != user.tenant_id:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    catalog = db.query(AgentCatalog).filter(AgentCatalog.agent_id == aid).first()
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed = get_agent_ids_for_user(db, user.id)
    if catalog.agent_id not in allowed:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return tenant_id, aid


@router.post("/", response_model=SourceFileResponse)
def create_source_file(
    body: SourceFileCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """上傳來源檔案（CSV 內容）"""
    tenant_id, agent_id = _check_agent_access(db, current, body.agent_id)

    existing = db.query(SourceFile).filter(
        SourceFile.user_id == current.id,
        SourceFile.tenant_id == tenant_id,
        SourceFile.agent_id == agent_id,
        SourceFile.file_name == body.file_name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="已經上傳，檔案重複")

    sf = SourceFile(
        user_id=current.id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        file_name=body.file_name,
        content=body.content,
    )
    db.add(sf)
    db.commit()
    db.refresh(sf)
    return SourceFileResponse(
        id=sf.id,
        file_name=sf.file_name,
        is_selected=sf.is_selected,
        created_at=sf.created_at,
    )


@router.get("/", response_model=list[SourceFileResponse])
def list_source_files(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 agent 的來源檔案列表"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    files = db.query(SourceFile).filter(
        SourceFile.user_id == current.id,
        SourceFile.tenant_id == tenant_id,
        SourceFile.agent_id == aid,
    ).order_by(SourceFile.created_at).all()
    return [
        SourceFileResponse(
            id=f.id,
            file_name=f.file_name,
            is_selected=f.is_selected,
            created_at=f.created_at,
        )
        for f in files
    ]


@router.get("/{file_id}", response_model=SourceFileDetailResponse)
def get_source_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一來源檔案（含 content，供編輯用）"""
    sf = db.query(SourceFile).filter(
        SourceFile.id == file_id,
        SourceFile.user_id == current.id,
    ).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Source file not found")
    return SourceFileDetailResponse(
        id=sf.id,
        file_name=sf.file_name,
        is_selected=sf.is_selected,
        created_at=sf.created_at,
        content=sf.content,
    )


@router.patch("/{file_id}", response_model=SourceFileResponse)
def update_source_file(
    file_id: int,
    body: SourceFileUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新來源檔案（選用狀態、檔名）"""
    sf = db.query(SourceFile).filter(
        SourceFile.id == file_id,
        SourceFile.user_id == current.id,
    ).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Source file not found")

    if body.is_selected is not None:
        sf.is_selected = body.is_selected

    if body.file_name is not None:
        name = body.file_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="檔名不可為空")
        if name != sf.file_name:
            existing = db.query(SourceFile).filter(
                SourceFile.user_id == current.id,
                SourceFile.tenant_id == sf.tenant_id,
                SourceFile.agent_id == sf.agent_id,
                SourceFile.file_name == name,
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="已經上傳，檔案重複")
            sf.file_name = name

    if body.content is not None:
        sf.content = body.content

    db.commit()
    db.refresh(sf)
    return SourceFileResponse(
        id=sf.id,
        file_name=sf.file_name,
        is_selected=sf.is_selected,
        created_at=sf.created_at,
    )


@router.delete("/{file_id}", status_code=204)
def delete_source_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除來源檔案（僅能刪除自己的）"""
    sf = db.query(SourceFile).filter(
        SourceFile.id == file_id,
        SourceFile.user_id == current.id,
    ).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Source file not found")
    db.delete(sf)
    db.commit()
    return None
