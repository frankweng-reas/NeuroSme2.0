"""BiProject ORM：對應 bi_projects 表（商務分析專案）"""
from sqlalchemy import Column, DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class BiProject(Base):
    __tablename__ = "bi_projects"

    project_id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)
    agent_id = Column(String(100), nullable=False, index=True)
    project_name = Column(String(255), nullable=False)
    project_desc = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    conversation_data = Column(JSONB, nullable=True)

    sources = relationship("BiSource", back_populates="project", cascade="all, delete-orphan")
