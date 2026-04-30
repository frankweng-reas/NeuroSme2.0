"""LLM Provider Config Pydantic schemas"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


VALID_PROVIDERS = {"openai", "gemini", "twcc", "local", "anthropic"}


class LLMModelEntry(BaseModel):
    """available_models 陣列中的單一模型項目"""
    model: str
    note: Optional[str] = Field(None, description="給用戶看的簡短說明，例：手寫 ✓ 印刷 ✓")


class LLMModelOption(BaseModel):
    """下拉選單用：實際送給 chat 的 model 字串 + 顯示標籤 + 備註"""

    value: str
    label: str
    note: Optional[str] = None


class LLMProviderConfigCreate(BaseModel):
    provider: str = Field(..., description="LLM provider：openai | gemini | twcc")
    label: Optional[str] = Field(None, description="顯示名稱，例：OpenAI（公司帳號）")
    api_key: Optional[str] = Field(None, description="API Key 明文（儲存時將加密）")
    api_base_url: Optional[str] = Field(None, description="自訂 base URL，台智雲必填")
    default_model: Optional[str] = Field(None, description="預設模型字串")
    available_models: Optional[List[LLMModelEntry]] = Field(None, description="可供使用者選擇的模型清單")
    is_active: bool = Field(True, description="是否啟用")


class LLMProviderConfigUpdate(BaseModel):
    label: Optional[str] = None
    api_key: Optional[str] = Field(None, description="新 API Key 明文；傳 null 表示不更新")
    api_base_url: Optional[str] = None
    available_models: Optional[List[LLMModelEntry]] = None
    is_active: Optional[bool] = None


class LLMProviderConfigResponse(BaseModel):
    id: int
    tenant_id: str
    provider: str
    label: Optional[str]
    api_key_masked: Optional[str] = Field(None, description="遮蔽後的 API Key，例：sk-a****bcde")
    api_base_url: Optional[str]
    default_model: Optional[str]
    available_models: Optional[List[LLMModelEntry]]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
