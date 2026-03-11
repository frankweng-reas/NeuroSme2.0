"""Company ORM：對應 companies 表（公司資訊）"""
from sqlalchemy import Column, DateTime, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class Company(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    legal_name = Column(String(255), nullable=True)
    tax_id = Column(String(50), nullable=True)
    logo_url = Column(Text, nullable=True)  # URL 或 base64 data URL
    address = Column(Text, nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    contact = Column(String(255), nullable=True)
    sort_order = Column(String(50), nullable=True)
    quotation_terms = Column(Text, nullable=True)  # 報價預設條款
