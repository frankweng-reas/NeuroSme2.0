"""SourceFile API 結構"""
from datetime import datetime

from pydantic import BaseModel, Field


class SourceFileCreate(BaseModel):
    agent_id: str = Field(..., description="agent 識別，支援 tenant_id:id 或 id")
    file_name: str = Field(..., max_length=255)
    content: str = Field(..., description="CSV 檔案內容")


class SourceFileResponse(BaseModel):
    id: int
    file_name: str
    is_selected: bool = True
    created_at: datetime

    class Config:
        from_attributes = True


class SourceFileDetailResponse(SourceFileResponse):
    """單一檔案詳情，含 content（供編輯用）"""

    content: str = Field(..., description="檔案內容")


class SourceFileUpdate(BaseModel):
    is_selected: bool | None = Field(None, description="是否選用此檔案")
    file_name: str | None = Field(None, max_length=255, description="新檔名")
    content: str | None = Field(None, description="更新內容")
