"""BiProject API 結構"""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class BiProjectCreate(BaseModel):
    agent_id: str = Field(..., description="agent 識別")
    project_name: str = Field(..., max_length=255)
    project_desc: str | None = Field(None, max_length=2000)


class BiProjectUpdate(BaseModel):
    project_name: str | None = Field(None, max_length=255)
    project_desc: str | None = Field(None, max_length=2000)
    conversation_data: list[dict[str, Any]] | None = Field(None, description="對話紀錄 JSON 陣列")


class BiProjectResponse(BaseModel):
    project_id: UUID
    project_name: str
    project_desc: str | None
    created_at: datetime
    conversation_data: list[dict[str, Any]] | None = None
    schema_id: str | None = Field(
        None,
        description="與 DuckDB / 分析意圖對齊的 bi_schemas.id；匯入 CSV 時會依所選模板更新",
    )

    class Config:
        from_attributes = True
