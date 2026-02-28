"""Agent API 回應結構 (AgentResponse)"""
from pydantic import BaseModel


class AgentResponse(BaseModel):
    id: str
    group_id: str
    group_name: str
    agent_id: str
    agent_name: str
    icon_name: str | None = None

    class Config:
        from_attributes = True
