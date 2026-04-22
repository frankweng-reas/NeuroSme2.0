"""OrderingSession ORM：對應 ordering_sessions 表，管理外部點餐 API 的對話歷史"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class OrderingSession(Base):
    __tablename__ = "ordering_sessions"
    __table_args__ = (
        UniqueConstraint("session_id", "api_key_id", name="uq_ordering_session_api_key"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(255), nullable=False, index=True)
    api_key_id = Column(Integer, ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False, index=True)
    kb_id = Column(Integer, nullable=False)
    messages = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
