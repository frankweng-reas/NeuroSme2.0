"""User ORM：對應 users 表"""
from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="member")  # admin | manager | member
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    display_name = Column(String(100), nullable=True)
    avatar_b64 = Column(Text, nullable=True)
    # null = 繼承租戶全部模型；[] = 無法使用任何模型；["model1",...] = 僅限指定模型
    allowed_models = Column(JSONB, nullable=True)

    tenant = relationship("Tenant", backref="users")
