"""BiSource ORM：對應 bi_sources 表（專案上傳檔案與內容）"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class BiSource(Base):
    __tablename__ = "bi_sources"

    source_id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id = Column(UUID(as_uuid=True), ForeignKey("bi_projects.project_id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(50), nullable=False, index=True)  # DATA（商務分析用）
    file_name = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)
    is_selected = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("BiProject", back_populates="sources")
