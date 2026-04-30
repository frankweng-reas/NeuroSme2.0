"""KM 知識庫 API：建立、列表、更新、刪除知識庫（kb）"""
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.km_document import KmDocument
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.user import User
from app.models.widget_session import WidgetSession
from app.models.km_chunk import KmChunk

router = APIRouter()
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class KbCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    model_name: str | None = None
    system_prompt: str | None = None


class KbUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    model_name: str | None = None
    system_prompt: str | None = None
    widget_title: str | None = None
    widget_logo_url: str | None = None
    widget_color: str | None = None
    widget_lang: str | None = None
    widget_voice_enabled: bool | None = None
    widget_voice_prompt: str | None = None


class KbResponse(BaseModel):
    id: int
    name: str
    description: str | None
    model_name: str | None
    system_prompt: str | None
    doc_count: int
    ready_count: int
    created_at: str
    public_token: str | None
    widget_title: str | None
    widget_logo_url: str | None
    widget_color: str | None
    widget_lang: str | None
    widget_voice_enabled: bool
    widget_voice_prompt: str | None

    model_config = {"from_attributes": True}


def _to_response(kb: KmKnowledgeBase, db: Session) -> KbResponse:
    all_docs = db.query(KmDocument).filter(KmDocument.knowledge_base_id == kb.id).all()
    return KbResponse(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        model_name=kb.model_name,
        system_prompt=kb.system_prompt,
        doc_count=len(all_docs),
        ready_count=sum(1 for d in all_docs if d.status == "ready"),
        created_at=kb.created_at.isoformat() if kb.created_at else "",
        public_token=kb.public_token,
        widget_title=kb.widget_title,
        widget_logo_url=kb.widget_logo_url,
        widget_color=kb.widget_color,
        widget_lang=kb.widget_lang,
        widget_voice_enabled=kb.widget_voice_enabled or False,
        widget_voice_prompt=kb.widget_voice_prompt,
    )


def _can_manage(role: str) -> bool:
    return role in ("admin", "super_admin", "manager")


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post("/knowledge-bases", response_model=KbResponse, status_code=201)
def create_knowledge_base(
    body: KbCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以建立知識庫")

    existing = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.tenant_id == current.tenant_id,
        KmKnowledgeBase.name == body.name.strip(),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"知識庫「{body.name}」已存在")

    kb = KmKnowledgeBase(
        tenant_id=current.tenant_id,
        name=body.name.strip(),
        description=body.description,
        model_name=body.model_name or None,
        system_prompt=body.system_prompt or None,
        created_by=current.id,
    )
    db.add(kb)
    db.commit()
    db.refresh(kb)
    return _to_response(kb, db)


@router.get("/knowledge-bases", response_model=list[KbResponse])
def list_knowledge_bases(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    kbs = (
        db.query(KmKnowledgeBase)
        .filter(KmKnowledgeBase.tenant_id == current.tenant_id)
        .order_by(KmKnowledgeBase.created_at.asc())
        .all()
    )
    return [_to_response(kb, db) for kb in kbs]


@router.patch("/knowledge-bases/{kb_id}", response_model=KbResponse)
def update_knowledge_base(
    kb_id: int,
    body: KbUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以修改知識庫")

    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == kb_id,
        KmKnowledgeBase.tenant_id == current.tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")

    if body.name is not None:
        kb.name = body.name.strip()
    if body.description is not None:
        kb.description = body.description
    kb.model_name = body.model_name or None
    kb.system_prompt = body.system_prompt or None
    if body.widget_title is not None:
        kb.widget_title = body.widget_title or None
    if body.widget_logo_url is not None:
        kb.widget_logo_url = body.widget_logo_url or None
    if body.widget_color is not None:
        kb.widget_color = body.widget_color or None
    if body.widget_lang is not None:
        kb.widget_lang = body.widget_lang or None
    if body.widget_voice_enabled is not None:
        kb.widget_voice_enabled = body.widget_voice_enabled
    if body.widget_voice_prompt is not None:
        kb.widget_voice_prompt = body.widget_voice_prompt or None
    db.commit()
    db.refresh(kb)
    return _to_response(kb, db)


@router.delete("/knowledge-bases/{kb_id}", status_code=204)
def delete_knowledge_base(
    kb_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除知識庫（不刪除文件，文件的 knowledge_base_id 設為 NULL）"""
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以刪除知識庫")

    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == kb_id,
        KmKnowledgeBase.tenant_id == current.tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")

    # 先刪 widget_sessions（含 messages，由 ORM cascade 處理）
    for s in db.query(WidgetSession).filter(WidgetSession.kb_id == kb_id).all():
        db.delete(s)

    # 再刪文件（chunks 由 DB ondelete=CASCADE 自動清除）
    for doc in db.query(KmDocument).filter(KmDocument.knowledge_base_id == kb_id).all():
        db.delete(doc)

    db.delete(kb)
    db.commit()


@router.post("/knowledge-bases/{kb_id}/generate-token", response_model=KbResponse)
def generate_widget_token(
    kb_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """產生（或重設）Widget public_token"""
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以產生 Widget Token")

    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == kb_id,
        KmKnowledgeBase.tenant_id == current.tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")

    kb.public_token = uuid.uuid4().hex
    db.commit()
    db.refresh(kb)
    return _to_response(kb, db)
