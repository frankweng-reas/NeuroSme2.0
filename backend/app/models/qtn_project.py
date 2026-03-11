"""QtnProject ORM：對應 qtn_projects 表（報價專案）"""
from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class QtnProject(Base):
    __tablename__ = "qtn_projects"

    project_id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)
    agent_id = Column(String(100), nullable=False, index=True)
    project_name = Column(String(255), nullable=False)
    project_desc = Column(Text, nullable=True)
    qtn_draft = Column(JSONB, nullable=True)
    qtn_final = Column(JSONB, nullable=True)
    status = Column(String(50), nullable=False, default="STEP1")
    total_amount = Column(Numeric(15, 2), nullable=True)
    currency = Column(String(10), nullable=True, default="TWD")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    sources = relationship("QtnSource", back_populates="project", cascade="all, delete-orphan")
