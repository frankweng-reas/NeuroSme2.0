from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class KmKnowledgeBase(Base):
    __tablename__ = "km_knowledge_bases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    model_name = Column(String(100), nullable=True)
    system_prompt = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # personal = 只有建立者可見；company = 同 tenant 全員可見
    scope = Column(String(20), nullable=False, server_default="personal")
    # rag = LLM 整合回答；direct = LLM 精確選取 FAQ 後回傳原文答案
    answer_mode = Column(String(20), nullable=False, server_default="rag")

    documents = relationship("KmDocument", back_populates="knowledge_base", lazy="dynamic")
