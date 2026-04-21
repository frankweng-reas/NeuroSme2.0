"""API Key 認證：驗證 X-API-Key header，回傳對應的 ApiKey ORM 物件"""
import hashlib
import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.api_key import ApiKey

logger = logging.getLogger(__name__)

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def get_api_key(
    raw_key: Annotated[str | None, Security(_api_key_header)],
    db: Annotated[Session, Depends(get_db)],
) -> ApiKey:
    """FastAPI dependency：驗證 X-API-Key，回傳 ApiKey 物件（含 tenant_id）。"""
    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 X-API-Key header",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    api_key = db.query(ApiKey).filter(
        ApiKey.key_hash == key_hash,
        ApiKey.is_active.is_(True),
    ).first()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效或已停用的 API Key",
        )

    from sqlalchemy import func as sqlfunc
    api_key.last_used_at = sqlfunc.now()
    db.commit()

    return api_key
