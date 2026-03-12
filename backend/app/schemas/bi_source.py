"""BiSource API 結構"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class BiSourceCreate(BaseModel):
    project_id: str = Field(..., description="專案 UUID")
    source_type: str = Field(..., description="DATA（商務分析用）")
    file_name: str = Field(..., max_length=255)
    content: str | None = Field(None, description="檔案或文字內容，可為空")
    is_selected: bool = Field(True, description="是否納入 chat 參考")


class BiSourceResponse(BaseModel):
    source_id: str
    project_id: str
    source_type: str
    file_name: str
    content: str | None
    is_selected: bool
    created_at: datetime

    class Config:
        from_attributes = True


class BiSourceUpdate(BaseModel):
    file_name: str | None = Field(None, max_length=255, description="新檔名")
    content: str | None = Field(None, description="更新內容")
    is_selected: bool | None = Field(None, description="是否納入 chat 參考")
