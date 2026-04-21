"""API Key 管理端點：建立、列出、撤銷 API Keys，以及查詢用量"""
import hashlib
import logging
import os
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.api_key import ApiKey, ApiKeyUsage
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

_ALLOWED_ROLES = {"admin", "super_admin", "manager"}


def _can_manage(role: str) -> bool:
    return role in _ALLOWED_ROLES


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="API Key 名稱，用於識別用途")


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    is_active: bool
    created_at: str
    last_used_at: str | None

    model_config = {"from_attributes": True}


class ApiKeyCreateResponse(ApiKeyResponse):
    plain_key: str = Field(..., description="API Key 明文，僅此一次顯示，請立即複製保存")


class DailyUsage(BaseModel):
    date: str
    request_count: int
    input_tokens: int
    output_tokens: int


class ApiKeyUsageResponse(BaseModel):
    api_key_id: int
    days: list[DailyUsage]
    total_requests: int
    total_input_tokens: int
    total_output_tokens: int


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _to_response(key: ApiKey) -> ApiKeyResponse:
    return ApiKeyResponse(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        is_active=key.is_active,
        created_at=key.created_at.isoformat() if key.created_at else "",
        last_used_at=key.last_used_at.isoformat() if key.last_used_at else None,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=ApiKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="建立 API Key",
    description="建立新的 API Key。明文金鑰只會在此回應中出現一次，請立即複製保存。",
)
def create_api_key(
    body: ApiKeyCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以建立 API Key")

    raw_key = "nsk_" + os.urandom(16).hex()
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:8]

    api_key = ApiKey(
        tenant_id=current.tenant_id,
        name=body.name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        is_active=True,
        created_by=current.id,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return ApiKeyCreateResponse(
        **_to_response(api_key).model_dump(),
        plain_key=raw_key,
    )


@router.get(
    "",
    response_model=list[ApiKeyResponse],
    summary="列出 API Keys",
    description="列出本 tenant 下所有 API Keys（不含明文）。",
)
def list_api_keys(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    keys = (
        db.query(ApiKey)
        .filter(ApiKey.tenant_id == current.tenant_id)
        .order_by(ApiKey.created_at.desc())
        .all()
    )
    return [_to_response(k) for k in keys]


@router.delete(
    "/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="撤銷 API Key",
    description="將指定 API Key 設為停用（is_active=False），不可逆。",
)
def revoke_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以撤銷 API Key")

    api_key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.tenant_id == current.tenant_id,
    ).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API Key 不存在")

    api_key.is_active = False
    db.commit()


@router.get(
    "/{key_id}/usage",
    response_model=ApiKeyUsageResponse,
    summary="查詢 API Key 用量",
    description="查詢指定 API Key 近 30 天每日用量（requests、tokens）。",
)
def get_api_key_usage(
    key_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    api_key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.tenant_id == current.tenant_id,
    ).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API Key 不存在")

    since = date.today() - timedelta(days=29)
    usages = (
        db.query(ApiKeyUsage)
        .filter(
            ApiKeyUsage.api_key_id == key_id,
            ApiKeyUsage.date >= since,
        )
        .order_by(ApiKeyUsage.date.asc())
        .all()
    )

    days = [
        DailyUsage(
            date=u.date.isoformat(),
            request_count=u.request_count,
            input_tokens=u.input_tokens,
            output_tokens=u.output_tokens,
        )
        for u in usages
    ]

    return ApiKeyUsageResponse(
        api_key_id=key_id,
        days=days,
        total_requests=sum(d.request_count for d in days),
        total_input_tokens=sum(d.input_tokens for d in days),
        total_output_tokens=sum(d.output_tokens for d in days),
    )
