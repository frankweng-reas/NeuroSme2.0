"""BotQueryLog：Bot Widget 查詢記錄，供零命中統計與 Bot 品質分析使用"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class BotQueryLog(Base):
    __tablename__ = "bot_query_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(
        String(64),
        ForeignKey("bot_widget_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    query = Column(Text, nullable=False)
    hit = Column(Boolean, nullable=False, server_default="false", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
