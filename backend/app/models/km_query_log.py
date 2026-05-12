"""KmQueryLog：KB 查詢記錄，供零命中統計與知識庫品質分析使用"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from app.core.database import Base


class KmQueryLog(Base):
    __tablename__ = "km_query_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    knowledge_base_id = Column(Integer, ForeignKey("km_knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True)
    answer_mode = Column(String(32), nullable=False)          # 'rag' / 'direct'
    query = Column(Text, nullable=False)
    hit = Column(Boolean, nullable=False, server_default="false", index=True)
    matched_chunk_ids = Column(JSONB, nullable=True)          # list of chunk UUID strings
    session_type = Column(String(32), nullable=False, server_default="internal")  # 'internal'
    widget_session_id = Column(String(64), nullable=True)   # 保留欄位供歷史查詢，FK 已移除
    chat_thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_threads.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
