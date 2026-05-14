"""connector_service：連接器 credentials 加解密、同步排程核心邏輯"""
from __future__ import annotations

import base64
import hashlib
import logging
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.connectors import CONNECTOR_REGISTRY, ConnectorDocument
from app.core.config import settings
from app.core.database import SessionLocal
from app.models.km_connector import KmConnector
from app.models.km_document import KmDocument
from app.services.km_service import process_document

logger = logging.getLogger(__name__)


# ── Fernet 金鑰：由 JWT_SECRET 衍生，確保跨重啟一致 ──────────────────────────

def _get_fernet() -> Fernet:
    raw = settings.JWT_SECRET.encode()
    key = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
    return Fernet(key)


def encrypt_credentials(credentials: dict) -> str:
    """將 credentials dict 加密為字串，存入 KmConnector.credentials_enc"""
    import json
    f = _get_fernet()
    return f.encrypt(json.dumps(credentials).encode()).decode()


def decrypt_credentials(credentials_enc: str) -> dict:
    """解密 KmConnector.credentials_enc 回 dict"""
    import json
    f = _get_fernet()
    try:
        return json.loads(f.decrypt(credentials_enc.encode()))
    except (InvalidToken, Exception) as e:
        raise ValueError(f"credentials 解密失敗：{e}") from e


# ── 單次同步邏輯 ──────────────────────────────────────────────────────────────

def sync_connector(connector_id: int, db: Session) -> dict:
    """
    執行單一 connector 的同步。

    Returns:
        {"synced": int, "skipped": int, "error": str | None}
    """
    connector = db.get(KmConnector, connector_id)
    if not connector:
        return {"synced": 0, "skipped": 0, "error": f"connector {connector_id} 不存在"}

    if connector.status == "paused":
        return {"synced": 0, "skipped": 0, "error": None}

    source_type = connector.source_type
    connector_cls = CONNECTOR_REGISTRY.get(source_type)
    if not connector_cls:
        return {"synced": 0, "skipped": 0, "error": f"未知的 source_type: {source_type}"}

    try:
        credentials = decrypt_credentials(connector.credentials_enc or "")
    except ValueError as e:
        _mark_error(connector, str(e), db)
        return {"synced": 0, "skipped": 0, "error": str(e)}

    instance = connector_cls()
    try:
        instance.validate_credentials(credentials)
    except ValueError as e:
        _mark_error(connector, str(e), db)
        return {"synced": 0, "skipped": 0, "error": str(e)}

    last_cursor = None if connector.force_full_sync else connector.last_cursor

    try:
        documents, new_cursor = instance.fetch(
            config=connector.config or {},
            credentials=credentials,
            last_cursor=last_cursor,
        )
    except Exception as e:
        logger.exception("Connector %d fetch 失敗", connector_id)
        _mark_error(connector, str(e), db)
        return {"synced": 0, "skipped": 0, "error": str(e)}

    synced = 0
    skipped = 0

    for doc in documents:
        result = _upsert_document(connector, doc, db)
        if result == "synced":
            synced += 1
        else:
            skipped += 1

    connector.last_synced_at = datetime.now(timezone.utc)
    connector.last_error = None
    connector.force_full_sync = False
    if new_cursor:
        connector.last_cursor = new_cursor
    if connector.status == "error":
        connector.status = "active"
    db.commit()

    logger.info("Connector %d (%s) 同步完成：synced=%d skipped=%d", connector_id, source_type, synced, skipped)
    return {"synced": synced, "skipped": skipped, "error": None}


def _upsert_document(
    connector: KmConnector,
    doc: ConnectorDocument,
    db: Session,
) -> str:
    """
    若 source_id 相同且內容未變則跳過，否則建立新的 KmDocument 並 ingest。
    回傳 'synced' 或 'skipped'。
    """
    content_hash = hashlib.sha256(doc.content.encode()).hexdigest()[:16]
    # 用 source_id 作為 filename prefix 來判斷是否已存在
    existing = (
        db.query(KmDocument)
        .filter(
            KmDocument.knowledge_base_id == connector.knowledge_base_id,
            KmDocument.filename == doc.filename,
        )
        .first()
    )

    if existing:
        # 內容未變（以 filename 判斷，connector 每次產出固定 filename 表示同一份文件）
        # 刪除舊版並重新 ingest（確保最新內容）
        db.delete(existing)
        db.commit()

    file_bytes = doc.content.encode("utf-8")
    kb = connector.knowledge_base_id

    # 繼承 KB 的 scope 設定（與 km.py 的上傳邏輯一致）
    from app.models.km_knowledge_base import KmKnowledgeBase
    kb_obj = db.get(KmKnowledgeBase, kb)
    scope = "public" if kb_obj and kb_obj.scope == "company" else "private"

    km_doc = KmDocument(
        tenant_id=connector.tenant_id,
        owner_user_id=connector.created_by,
        knowledge_base_id=kb,
        filename=doc.filename,
        content_type="text/markdown",
        size_bytes=len(file_bytes),
        scope=scope,
        status="pending",
        doc_type=doc.doc_type,
        tags=doc.tags,
    )
    db.add(km_doc)
    db.commit()
    db.refresh(km_doc)

    try:
        process_document(
            doc_id=km_doc.id,
            file_bytes=file_bytes,
            content_type="text/markdown",
            filename=doc.filename,
            db=db,
            tenant_id=connector.tenant_id,
            doc_type=doc.doc_type,
            agent_id="connector",
            user_id=connector.created_by,
        )
    except Exception as e:
        logger.error("Connector document %d ingest 失敗：%s", km_doc.id, e)
        km_doc.status = "error"
        km_doc.error_message = str(e)
        db.commit()

    return "synced"


def _mark_error(connector: KmConnector, error: str, db: Session) -> None:
    connector.status = "error"
    connector.last_error = error
    connector.last_synced_at = datetime.now(timezone.utc)
    db.commit()


# ── 排程器呼叫的入口 ──────────────────────────────────────────────────────────

def run_due_connectors() -> None:
    """
    掃描所有到期的 active connector 並執行同步。
    由 APScheduler 每分鐘呼叫一次。
    """
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        connectors = (
            db.query(KmConnector)
            .filter(KmConnector.status == "active", KmConnector.sync_interval_minutes > 0)
            .all()
        )
        for c in connectors:
            if c.last_synced_at is None:
                due = True
            else:
                elapsed = (now - c.last_synced_at).total_seconds() / 60
                due = elapsed >= c.sync_interval_minutes

            if due:
                logger.info("排程觸發 connector %d (%s)", c.id, c.source_type)
                sync_connector(c.id, db)
