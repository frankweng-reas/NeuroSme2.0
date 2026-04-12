"""Activation Code API：產生（super_admin）、兌換（admin）、查狀態（admin）"""
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.activation_code import ActivationCode
from app.models.user import User
from app.services.activation import (
    RedeemError,
    ActivationStatus,
    generate_code,
    get_activation_status,
    redeem_code,
)

router = APIRouter()


class GenerateRequest(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    agent_ids: list[str] = Field(..., min_length=1)
    expires_at: date | None = Field(None)


class GenerateResponse(BaseModel):
    code: str
    customer_name: str
    agent_ids: list[str]
    expires_at: date | None


class HistoryItem(BaseModel):
    id: int
    customer_name: str
    agent_ids: list[str]
    expires_at: date | None
    created_at: str
    activated_at: str | None


class RedeemRequest(BaseModel):
    code: str = Field(..., min_length=1)


class RedeemResponse(BaseModel):
    customer_name: str
    agent_ids: list[str]
    expires_at: date | None


@router.post("/generate", response_model=GenerateResponse)
def generate(
    body: GenerateRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> GenerateResponse:
    """產生 Activation Code（僅 super_admin）"""
    if current.role != "super_admin":
        raise HTTPException(status_code=403, detail="需 super_admin 權限")
    code = generate_code(
        customer_name=body.customer_name,
        agent_ids=body.agent_ids,
        expires_at=body.expires_at,
        db=db,
    )
    return GenerateResponse(
        code=code,
        customer_name=body.customer_name,
        agent_ids=body.agent_ids,
        expires_at=body.expires_at,
    )


@router.post("/redeem", response_model=RedeemResponse)
def redeem(
    body: RedeemRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> RedeemResponse:
    """兌換 Activation Code（admin 或 super_admin）"""
    if current.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    try:
        record = redeem_code(code=body.code, tenant_id=current.tenant_id, db=db)
    except RedeemError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedeemResponse(
        customer_name=record.customer_name,
        agent_ids=record.agent_ids_list,
        expires_at=record.expires_at,
    )


@router.get("/status", response_model=ActivationStatus)
def status(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> ActivationStatus:
    """查詢目前 tenant 的啟用狀態（admin 或 super_admin）"""
    if current.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    return get_activation_status(tenant_id=current.tenant_id, db=db)


@router.get("/history", response_model=list[HistoryItem])
def history(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> list[HistoryItem]:
    """查詢所有 Activation Code 歷史（super_admin）"""
    if current.role != "super_admin":
        raise HTTPException(status_code=403, detail="需 super_admin 權限")
    records = (
        db.query(ActivationCode)
        .order_by(ActivationCode.created_at.desc())
        .all()
    )
    return [
        HistoryItem(
            id=r.id,
            customer_name=r.customer_name,
            agent_ids=r.agent_ids_list,
            expires_at=r.expires_at,
            created_at=r.created_at.isoformat() if r.created_at else "",
            activated_at=r.activated_at.isoformat() if r.activated_at else None,
        )
        for r in records
    ]
