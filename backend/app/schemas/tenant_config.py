"""TenantConfig Pydantic schemas"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class TenantConfigResponse(BaseModel):
    """GET 回傳：目前租戶設定（API Key 已遮罩）"""
    tenant_id: str
    default_llm_provider: Optional[str]
    default_llm_model: Optional[str]
    embedding_provider: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_locked_at: Optional[datetime] = None
    embedding_version: int = 1
    # Speech（api_key 以遮罩形式回傳）
    speech_provider: Optional[str] = None
    speech_base_url: Optional[str] = None
    speech_api_key_masked: Optional[str] = None
    speech_model: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True


class DefaultLLMUpdate(BaseModel):
    """PATCH /llm-configs/default-model 用：更新預設 LLM"""
    provider: str = Field(..., description="LLM provider：openai | gemini | twcc | local")
    model: str = Field(..., description="模型字串，例：gemini/gemini-2.5-flash")


class EmbeddingMigrateRequest(BaseModel):
    """POST /llm-configs/embedding-config/migrate 用：遷移 embedding model"""
    provider: str = Field(..., description="新 embedding provider：gemini | openai | local")
    model: str = Field(..., description="新 embedding model，例：text-embedding-004")
    confirm: bool = Field(..., description="必須傳 true 以確認此操作將清空所有向量索引")


class SpeechConfigUpdate(BaseModel):
    """PATCH /llm-configs/tenant-config/speech 用：更新語音模型設定"""
    provider: Optional[str] = Field(None, description="語音 provider：local | openai")
    base_url: Optional[str] = Field(None, description="服務 base URL，例：http://host:8002")
    api_key: Optional[str] = Field(None, description="API Key；None = 不變更，空字串 = 清除")
    model: Optional[str] = Field(None, description="模型名稱，例：Systran/faster-whisper-medium")
