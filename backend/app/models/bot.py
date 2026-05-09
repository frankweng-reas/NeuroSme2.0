from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class Bot(Base):
    __tablename__ = "km_bots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    system_prompt = Column(Text, nullable=True)
    model_name = Column(String(100), nullable=True)

    # Widget / Public API 存取憑證
    public_token = Column(String(64), nullable=True, unique=True, index=True)
    widget_title = Column(String(100), nullable=True)
    widget_logo_url = Column(Text, nullable=True)
    widget_color = Column(String(20), nullable=True, default="#1A3A52")
    widget_lang = Column(String(10), nullable=True, default="zh-TW")

    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    knowledge_bases = relationship(
        "KmKnowledgeBase",
        secondary="km_bot_kb",
        lazy="joined",
        order_by="BotKnowledgeBase.sort_order",
    )


class BotKnowledgeBase(Base):
    __tablename__ = "km_bot_kb"

    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="CASCADE"), primary_key=True)
    knowledge_base_id = Column(Integer, ForeignKey("km_knowledge_bases.id", ondelete="CASCADE"), primary_key=True)
    sort_order = Column(Integer, nullable=False, default=0)
