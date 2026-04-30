from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
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

    # Widget 設定
    public_token = Column(String(64), nullable=True, unique=True, index=True)
    widget_title = Column(String(100), nullable=True)
    widget_logo_url = Column(Text, nullable=True)
    widget_color = Column(String(20), nullable=True, default="#1A3A52")
    widget_lang = Column(String(10), nullable=True, default="zh-TW")
    widget_voice_enabled = Column(Boolean, nullable=False, default=False)
    widget_voice_prompt = Column(Text, nullable=True)

    documents = relationship("KmDocument", back_populates="knowledge_base", lazy="dynamic")
    widget_sessions = relationship("WidgetSession", back_populates="knowledge_base", lazy="dynamic", passive_deletes=True)
