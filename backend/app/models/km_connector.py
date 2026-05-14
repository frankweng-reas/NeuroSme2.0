"""KmConnector ORM：km_connectors 表，外部資料來源連接器設定"""
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, func
)

from app.core.database import Base


class KmConnector(Base):
    __tablename__ = "km_connectors"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    tenant_id = Column(
        String(100),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    knowledge_base_id = Column(
        Integer,
        ForeignKey("km_knowledge_bases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # slack | notion | gdrive | web | rss | api
    source_type = Column(String(32), nullable=False, index=True)
    display_name = Column(String(100), nullable=False)

    # 各 source 專屬設定，例如 {"channel_ids": ["C0A2ZQ4K6BS"], "days_lookback": 7}
    config = Column(JSON, nullable=False, server_default="{}")

    # 加密存放認證資訊，例如 {"token": "xoxp-..."}
    # 寫入前由 connector_service 以 Fernet 加密；讀取後解密
    credentials_enc = Column(Text, nullable=True)

    # active | paused | error
    status = Column(String(20), nullable=False, server_default="active", index=True)

    # 同步頻率（分鐘），0 = 只允許手動觸發
    sync_interval_minutes = Column(Integer, nullable=False, server_default="60")

    # 增量同步游標（各 Connector 自行定義格式，例如 Slack 用最後一則訊息的 ts）
    last_cursor = Column(String(255), nullable=True)

    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)

    # 是否在下次排程時強制全量重新同步（忽略 last_cursor）
    force_full_sync = Column(Boolean, nullable=False, server_default="false")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
