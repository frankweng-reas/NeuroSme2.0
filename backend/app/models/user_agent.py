"""UserAgent 關聯表：使用者可存取的 agent"""
from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from app.core.database import Base


class UserAgent(Base):
    __tablename__ = "user_agents"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    agent_id = Column(String(100), ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True)
