"""KM Connector API：建立、列表、更新、刪除、手動觸發同步"""
import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.connectors import CONNECTOR_REGISTRY
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.km_connector import KmConnector
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.user import User
from app.services.connector_service import (
    decrypt_credentials,
    encrypt_credentials,
    sync_connector,
)

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_SOURCE_TYPES = frozenset(CONNECTOR_REGISTRY.keys())


# ── Schemas ───────────────────────────────────────────────────────────────────


class ConnectorCreate(BaseModel):
    knowledge_base_id: int
    source_type: str
    display_name: str = Field(..., min_length=1, max_length=100)
    config: dict = {}
    credentials: dict  # 明文傳入，儲存前加密
    sync_interval_minutes: int = Field(60, ge=0)


class ConnectorUpdate(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=100)
    config: dict | None = None
    credentials: dict | None = None
    sync_interval_minutes: int | None = Field(None, ge=0)
    status: str | None = None
    force_full_sync: bool | None = None


class ConnectorResponse(BaseModel):
    id: int
    knowledge_base_id: int
    source_type: str
    display_name: str
    config: dict
    status: str
    sync_interval_minutes: int
    last_synced_at: str | None
    last_cursor: str | None
    last_error: str | None
    force_full_sync: bool
    created_at: str

    @classmethod
    def from_orm(cls, c: KmConnector) -> "ConnectorResponse":
        return cls(
            id=c.id,
            knowledge_base_id=c.knowledge_base_id,
            source_type=c.source_type,
            display_name=c.display_name,
            config=c.config or {},
            status=c.status,
            sync_interval_minutes=c.sync_interval_minutes,
            last_synced_at=c.last_synced_at.isoformat() if c.last_synced_at else None,
            last_cursor=c.last_cursor,
            last_error=c.last_error,
            force_full_sync=c.force_full_sync,
            created_at=c.created_at.isoformat(),
        )


# ── 權限輔助 ──────────────────────────────────────────────────────────────────


def _get_kb_or_404(kb_id: int, tenant_id: str, db: Session) -> KmKnowledgeBase:
    kb = db.query(KmKnowledgeBase).filter_by(id=kb_id, tenant_id=tenant_id).first()
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")
    return kb


def _check_kb_manage_permission(kb: KmKnowledgeBase, current: User) -> None:
    if kb.scope == "personal" and kb.created_by != current.id:
        raise HTTPException(status_code=403, detail="無權限管理此知識庫的連接器")
    if kb.scope == "company" and current.role not in ("admin", "super_admin", "manager"):
        raise HTTPException(status_code=403, detail="需要管理員或主管權限")


def _get_connector_or_404(connector_id: int, tenant_id: str, db: Session) -> KmConnector:
    c = db.query(KmConnector).filter_by(id=connector_id, tenant_id=tenant_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="連接器不存在")
    return c


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/connectors", summary="建立連接器")
def create_connector(
    body: ConnectorCreate,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectorResponse:
    if body.source_type not in VALID_SOURCE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"不支援的 source_type：{body.source_type}。支援：{sorted(VALID_SOURCE_TYPES)}",
        )

    kb = _get_kb_or_404(body.knowledge_base_id, current.tenant_id, db)
    _check_kb_manage_permission(kb, current)

    # 驗證 credentials
    connector_cls = CONNECTOR_REGISTRY[body.source_type]
    instance = connector_cls()
    try:
        instance.validate_credentials(body.credentials)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    credentials_enc = encrypt_credentials(body.credentials)

    c = KmConnector(
        tenant_id=current.tenant_id,
        knowledge_base_id=body.knowledge_base_id,
        created_by=current.id,
        source_type=body.source_type,
        display_name=body.display_name,
        config=body.config,
        credentials_enc=credentials_enc,
        sync_interval_minutes=body.sync_interval_minutes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    logger.info("建立 connector %d (%s) by user %d", c.id, c.source_type, current.id)
    return ConnectorResponse.from_orm(c)


@router.get("/connectors", summary="列出此 tenant 的所有連接器")
def list_connectors(
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    kb_id: int | None = None,
) -> list[ConnectorResponse]:
    q = db.query(KmConnector).filter_by(tenant_id=current.tenant_id)
    if kb_id:
        q = q.filter_by(knowledge_base_id=kb_id)
    return [ConnectorResponse.from_orm(c) for c in q.order_by(KmConnector.id).all()]


@router.get("/connectors/{connector_id}", summary="取得連接器詳情")
def get_connector(
    connector_id: int,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectorResponse:
    c = _get_connector_or_404(connector_id, current.tenant_id, db)
    return ConnectorResponse.from_orm(c)


@router.patch("/connectors/{connector_id}", summary="更新連接器設定")
def update_connector(
    connector_id: int,
    body: ConnectorUpdate,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectorResponse:
    c = _get_connector_or_404(connector_id, current.tenant_id, db)
    kb = _get_kb_or_404(c.knowledge_base_id, current.tenant_id, db)
    _check_kb_manage_permission(kb, current)

    if body.display_name is not None:
        c.display_name = body.display_name
    if body.config is not None:
        c.config = body.config
    if body.credentials is not None:
        connector_cls = CONNECTOR_REGISTRY.get(c.source_type)
        if connector_cls:
            try:
                connector_cls().validate_credentials(body.credentials)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
        c.credentials_enc = encrypt_credentials(body.credentials)
    if body.sync_interval_minutes is not None:
        c.sync_interval_minutes = body.sync_interval_minutes
    if body.status is not None:
        if body.status not in ("active", "paused"):
            raise HTTPException(status_code=400, detail="status 只允許 'active' 或 'paused'")
        c.status = body.status
    if body.force_full_sync is not None:
        c.force_full_sync = body.force_full_sync

    db.commit()
    db.refresh(c)
    return ConnectorResponse.from_orm(c)


@router.delete("/connectors/{connector_id}", summary="刪除連接器")
def delete_connector(
    connector_id: int,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    c = _get_connector_or_404(connector_id, current.tenant_id, db)
    kb = _get_kb_or_404(c.knowledge_base_id, current.tenant_id, db)
    _check_kb_manage_permission(kb, current)
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/connectors/{connector_id}/sync", summary="手動觸發同步")
def trigger_sync(
    connector_id: int,
    background_tasks: BackgroundTasks,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    c = _get_connector_or_404(connector_id, current.tenant_id, db)
    kb = _get_kb_or_404(c.knowledge_base_id, current.tenant_id, db)
    _check_kb_manage_permission(kb, current)

    background_tasks.add_task(_run_sync_task, connector_id)
    return {"ok": True, "message": f"connector {connector_id} 同步已在背景啟動"}


def _run_sync_task(connector_id: int) -> None:
    from app.core.database import SessionLocal
    with SessionLocal() as db:
        result = sync_connector(connector_id, db)
        logger.info("手動同步 connector %d 完成：%s", connector_id, result)


@router.get("/connectors/sources/supported", summary="列出支援的來源類型")
def list_supported_sources() -> dict:
    return {
        "sources": [
            {"source_type": "slack", "display_name": "Slack", "status": "available"},
        ]
    }


class SlackValidateRequest(BaseModel):
    token: str


class SlackChannel(BaseModel):
    id: str
    name: str
    is_private: bool
    member_count: int | None = None


@router.post("/connectors/slack/validate", summary="驗證 Slack token 並列出可用頻道")
def validate_slack_token(
    body: SlackValidateRequest,
    current: Annotated[User, Depends(get_current_user)],
) -> dict:
    """驗證 Slack token 是否有效，並回傳可加入的頻道列表"""
    try:
        from slack_sdk import WebClient
        from slack_sdk.errors import SlackApiError
    except ImportError:
        raise HTTPException(status_code=500, detail="slack_sdk 未安裝")

    client = WebClient(token=body.token)

    # 驗證 token
    try:
        auth = client.auth_test()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token 無效：{e}")

    # 列出頻道：先拿公開頻道（channels:read），再嘗試私人頻道（groups:read 可選）
    channels: list[SlackChannel] = []

    def _fetch_channels(types: str) -> None:
        cursor = None
        while True:
            resp = client.conversations_list(
                types=types,
                exclude_archived=True,
                limit=200,
                cursor=cursor,
            )
            for ch in resp.get("channels", []):
                channels.append(SlackChannel(
                    id=ch["id"],
                    name=ch.get("name", ch["id"]),
                    is_private=ch.get("is_private", False),
                    member_count=ch.get("num_members"),
                ))
            cursor = resp.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break

    try:
        _fetch_channels("public_channel")
    except Exception as e:
        logger.warning("無法列出公開頻道：%s", e)

    try:
        _fetch_channels("private_channel")
    except Exception as e:
        logger.info("無法列出私人頻道（需要 groups:read 權限，可忽略）：%s", e)

    channels.sort(key=lambda c: c.name)

    return {
        "ok": True,
        "workspace": auth.get("team"),
        "user": auth.get("user"),
        "channels": [c.model_dump() for c in channels],
    }
