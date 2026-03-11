"""QtnProject API 結構"""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class QtnProjectCreate(BaseModel):
    agent_id: str = Field(..., description="agent 識別")
    project_name: str = Field(..., max_length=255)
    project_desc: str | None = Field(None, max_length=2000)


class QtnProjectUpdate(BaseModel):
    project_name: str = Field(..., max_length=255)
    project_desc: str | None = Field(None, max_length=2000)


class QtnProjectDraftUpdate(BaseModel):
    qtn_draft: dict[str, Any] | None = Field(..., description="報價預覽草稿資料")


class QtnProjectFinalUpdate(BaseModel):
    qtn_final: dict[str, Any] | None = Field(..., description="正式報價單資料（賣方、買方、條款、品項等）")


class QtnProjectStatusUpdate(BaseModel):
    status: str = Field(..., description="專案狀態：STEP1, STEP2, STEP3, STEP4")


class QtnProjectResponse(BaseModel):
    project_id: UUID
    project_name: str
    project_desc: str | None
    created_at: datetime
    qtn_draft: dict[str, Any] | None = None
    qtn_final: dict[str, Any] | None = None
    status: str = "STEP1"

    class Config:
        from_attributes = True
