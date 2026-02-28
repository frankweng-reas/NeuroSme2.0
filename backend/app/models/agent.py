"""Agent ORM：對應 agents 表 (id, group_id, agent_id, agent_name, icon_name)"""
from sqlalchemy import Column, String
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class Agent(Base, TimestampMixin):
    __tablename__ = "agents"

    id = Column(String(100), primary_key=True, index=True)
    group_id = Column(String(100), nullable=False, index=True)
    group_name = Column(String(255), nullable=False)
    agent_id = Column(String(100), nullable=False, index=True)
    agent_name = Column(String(255), nullable=False)
    icon_name = Column(String(100), nullable=True)

    users = relationship(
        "User",
        secondary="user_agents",
        back_populates="agents",
        lazy="selectin",
    )
