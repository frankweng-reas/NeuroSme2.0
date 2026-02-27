from sqlalchemy import Column, Integer, String
from app.core.database import Base
from app.models.base import TimestampMixin


class Agent(Base, TimestampMixin):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    group_id = Column(String(100), nullable=False, index=True)
    group_name = Column(String(255), nullable=False)
    agent_id = Column(String(100), nullable=False, index=True)
    agent_name = Column(String(255), nullable=False)
    icon_name = Column(String(100), nullable=True)
