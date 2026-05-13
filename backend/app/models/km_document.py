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
    # [LEGACY] 早期文件沒有 KB 時用來記錄上傳者的欄位。
    # 現行架構：文件必須歸屬 KB（knowledge_base_id），
    # 可見性與編輯權限應走 KB 的 created_by + scope 判斷，不應再使用此欄位。
    # 只有 knowledge_base_id = NULL 的極少數舊文件才沿用此欄位，
    # km_service.py 的 RAG 篩選邏輯保留了相容路徑。
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
    # article | policy | spec | faq（影響 chunking 策略與 top_k）
    doc_type = Column(String(32), nullable=False, server_default="article")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    knowledge_base = relationship("KmKnowledgeBase", back_populates="documents", lazy="select")
