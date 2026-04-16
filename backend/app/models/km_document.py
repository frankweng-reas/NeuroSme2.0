"""KmDocument ORM：km_documents 表，知識庫文件（含處理狀態）"""
from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class KmDocument(Base):
    __tablename__ = "km_documents"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    tenant_id = Column(
        String(100),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    knowledge_base_id = Column(
        Integer,
        ForeignKey("km_knowledge_bases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    filename = Column(String(512), nullable=False)
    content_type = Column(String(255), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    # 'private'：owner 可見；'public'：整個 tenant 可見
    scope = Column(String(32), nullable=False, server_default="private")
    # 'pending' → 'processing' → 'ready' | 'error'
    status = Column(String(32), nullable=False, server_default="pending")
    error_message = Column(Text, nullable=True)
    chunk_count = Column(Integer, nullable=True)
    tags = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    knowledge_base = relationship("KmKnowledgeBase", back_populates="documents", lazy="select")
