"""API Key ORM：對應 api_keys / api_key_usages 表"""
from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="SET NULL"), nullable=True, index=True)
    key_type = Column(String(20), nullable=False, default="bot")  # 'bot' | 'voice' | 'general'
    name = Column(String(100), nullable=False)
    key_prefix = Column(String(12), nullable=False)
    key_hash = Column(String(64), nullable=False, unique=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    usages = relationship("ApiKeyUsage", back_populates="api_key", lazy="dynamic")


class ApiKeyUsage(Base):
    __tablename__ = "api_key_usages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    api_key_id = Column(Integer, ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    request_count = Column(Integer, nullable=False, default=0)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    audio_seconds = Column(Float, nullable=False, default=0.0)

    api_key = relationship("ApiKey", back_populates="usages")
