"""AgentCatalog ORM：對應 agent_catalog 表，系統全域 agent 定義"""
from sqlalchemy import Column, String
from app.core.database import Base


class AgentCatalog(Base):
    __tablename__ = "agent_catalog"

    id = Column(String(100), primary_key=True, index=True)
    sort_id = Column(String(100), nullable=True, index=True)
    group_id = Column(String(100), nullable=False, index=True)
    group_name = Column(String(255), nullable=False)
    agent_id = Column(String(100), nullable=False, index=True)
    agent_name = Column(String(255), nullable=False)
    icon_name = Column(String(100), nullable=True)
