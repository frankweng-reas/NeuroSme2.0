"""AgentCatalog 相關 Pydantic 結構（super_admin 維護用）"""
from pydantic import BaseModel, Field


class AgentCatalogBase(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    sort_id: str | None = Field(None, max_length=100)
    group_id: str = Field(..., min_length=1, max_length=100)
    group_name: str = Field(..., min_length=1, max_length=255)
    agent_id: str = Field(..., min_length=1, max_length=100)
    agent_name: str = Field(..., min_length=1, max_length=255)
    icon_name: str | None = Field(None, max_length=100)


class AgentCatalogCreate(AgentCatalogBase):
    pass


class AgentCatalogUpdate(BaseModel):
    sort_id: str | None = Field(None, max_length=100)
    group_id: str = Field(..., min_length=1, max_length=100)
    group_name: str = Field(..., min_length=1, max_length=255)
    agent_id: str = Field(..., min_length=1, max_length=100)
    agent_name: str = Field(..., min_length=1, max_length=255)
    icon_name: str | None = Field(None, max_length=100)


class AgentCatalogResponse(BaseModel):
    id: str
    sort_id: str | None = None
    group_id: str
    group_name: str
    agent_id: str
    agent_name: str
    icon_name: str | None = None

    class Config:
        from_attributes = True
