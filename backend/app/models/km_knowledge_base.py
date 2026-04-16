from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class KmKnowledgeBase(Base):
    __tablename__ = "km_knowledge_bases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    model_name = Column(String(100), nullable=True)   # 例如 gpt-4o-mini、gemini/gemini-2.5-flash
    system_prompt = Column(Text, nullable=True)        # 覆寫預設 CS system prompt
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    documents = relationship("KmDocument", back_populates="knowledge_base", lazy="dynamic")
