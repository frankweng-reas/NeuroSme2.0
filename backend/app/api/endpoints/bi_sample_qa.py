"""BI 範例問答：使用者依 tenant / user / agent 維護自己的範例問題"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.endpoints.bi_projects import _check_agent_access
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bi_sample_qa import BiSampleQa
from app.models.user import User

router = APIRouter()

MAX_SAMPLE_QA_PER_USER_AGENT = 24
MAX_QUESTION_TEXT_LEN = 280


class BiSampleQaCreate(BaseModel):
    agent_id: str = Field(..., description="與 bi-projects 相同之 agent 識別")
    question_text: str = Field(..., min_length=1, max_length=MAX_QUESTION_TEXT_LEN)


class BiSampleQaPatch(BaseModel):
    question_text: str | None = Field(None, min_length=1, max_length=MAX_QUESTION_TEXT_LEN)


class BiSampleQaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    agent_id: str
    question_text: str
    sort_order: int


def _get_owned_row(
    db: Session,
    *,
    sample_id: UUID,
    tenant_id: str,
    user_id: str,
    agent_id: str,
) -> BiSampleQa:
    row = (
        db.query(BiSampleQa)
        .filter(
            BiSampleQa.id == sample_id,
            BiSampleQa.tenant_id == tenant_id,
            BiSampleQa.user_id == user_id,
            BiSampleQa.agent_id == agent_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="範例問題不存在或無權限")
    return row


@router.get("/", response_model=list[BiSampleQaResponse])
def list_bi_sample_qa(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """目前登入使用者在此 agent 下的自訂範例（已含租戶隔離）。"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)
    rows = (
        db.query(BiSampleQa)
        .filter(
            BiSampleQa.tenant_id == tenant_id,
            BiSampleQa.user_id == str(current.id),
            BiSampleQa.agent_id == aid,
        )
        .order_by(BiSampleQa.sort_order.asc(), BiSampleQa.created_at.asc())
        .all()
    )
    return [
        BiSampleQaResponse(
            id=r.id,
            agent_id=r.agent_id,
            question_text=r.question_text,
            sort_order=r.sort_order,
        )
        for r in rows
    ]


@router.post("/", response_model=BiSampleQaResponse, status_code=status.HTTP_201_CREATED)
def create_bi_sample_qa(
    body: BiSampleQaCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    tenant_id, aid = _check_agent_access(db, current, body.agent_id)
    text = (body.question_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="問題內容不可為空")

    count = (
        db.query(BiSampleQa)
        .filter(
            BiSampleQa.tenant_id == tenant_id,
            BiSampleQa.user_id == str(current.id),
            BiSampleQa.agent_id == aid,
        )
        .count()
    )
    if count >= MAX_SAMPLE_QA_PER_USER_AGENT:
        raise HTTPException(
            status_code=400,
            detail=f"自訂範例最多 {MAX_SAMPLE_QA_PER_USER_AGENT} 則",
        )

    max_so = (
        db.query(func.max(BiSampleQa.sort_order))
        .filter(
            BiSampleQa.tenant_id == tenant_id,
            BiSampleQa.user_id == str(current.id),
            BiSampleQa.agent_id == aid,
        )
        .scalar()
    )
    next_order = (max_so + 1) if max_so is not None else 0

    row = BiSampleQa(
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=aid,
        question_text=text,
        sort_order=next_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return BiSampleQaResponse(
        id=row.id,
        agent_id=row.agent_id,
        question_text=row.question_text,
        sort_order=row.sort_order,
    )


@router.patch("/{sample_id}", response_model=BiSampleQaResponse)
def patch_bi_sample_qa(
    sample_id: UUID,
    body: BiSampleQaPatch,
    agent_id: str = Query(..., description="用於權限檢查，須與該筆範例所屬 agent 一致"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    tenant_id, aid = _check_agent_access(db, current, agent_id)
    row = _get_owned_row(
        db,
        sample_id=sample_id,
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=aid,
    )
    if body.question_text is not None:
        t = body.question_text.strip()
        if not t:
            raise HTTPException(status_code=400, detail="問題內容不可為空")
        row.question_text = t
    db.commit()
    db.refresh(row)
    return BiSampleQaResponse(
        id=row.id,
        agent_id=row.agent_id,
        question_text=row.question_text,
        sort_order=row.sort_order,
    )


@router.delete("/{sample_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bi_sample_qa(
    sample_id: UUID,
    agent_id: str = Query(..., description="用於權限檢查"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    tenant_id, aid = _check_agent_access(db, current, agent_id)
    row = _get_owned_row(
        db,
        sample_id=sample_id,
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=aid,
    )
    db.delete(row)
    db.commit()
    return None
