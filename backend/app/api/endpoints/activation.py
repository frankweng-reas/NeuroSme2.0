"""Activation Code API：兌換（admin）、查狀態（admin）"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.activation import (
    RedeemError,
    ActivationStatus,
    get_activation_status,
    redeem_code,
)

router = APIRouter()


class RedeemRequest(BaseModel):
    code: str = Field(..., min_length=1)


class RedeemResponse(BaseModel):
    customer_name: str
    agent_ids: list[str]
    expires_at: str | None


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
        expires_at=record.expires_at.isoformat() if record.expires_at else None,
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
