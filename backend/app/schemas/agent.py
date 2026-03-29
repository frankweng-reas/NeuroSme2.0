"""Agent API 回應結構 (AgentResponse)"""
from pydantic import BaseModel

from app.models.agent_catalog import AgentCatalog


def _agent_composite_id(tenant_id: str, agent_id: str) -> str:
    """API 用 id：tenant_id:id，全域唯一"""
    return f"{tenant_id}:{agent_id}"


class AgentResponse(BaseModel):
    id: str  # tenant_id:id 格式，全域唯一
    group_id: str
    group_name: str
    agent_id: str
    agent_name: str
    icon_name: str | None = None
    is_purchased: bool = False
    tenant_id: str = ""

    class Config:
        from_attributes = True

    @classmethod
    def from_catalog(cls, catalog: AgentCatalog, tenant_id: str) -> "AgentResponse":
        """從 AgentCatalog 建立，id 為 tenant_id:agent_id"""
        return cls(
            id=_agent_composite_id(tenant_id, catalog.agent_id),
            group_id=catalog.group_id,
            group_name=catalog.group_name,
            agent_id=catalog.agent_id,
            agent_name=catalog.agent_name,
            icon_name=catalog.icon_name,
            is_purchased=True,
            tenant_id=tenant_id,
        )
