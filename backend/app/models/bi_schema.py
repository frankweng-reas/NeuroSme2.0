"""BiSchema ORM：對應 bi_schemas 表（分析 Schema 配置，含 columns、indicators 等）"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class BiSchema(Base):
    __tablename__ = "bi_schemas"

    id = Column(String(100), primary_key=True, index=True)  # 如 fact_business_operations
    name = Column(String(255), nullable=False)
    desc = Column(Text, nullable=True)  # 描述
    schema_json = Column(JSONB, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    is_template = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
