"""Tenant 相關 Pydantic 結構"""
from pydantic import BaseModel, Field


class TenantBase(BaseModel):
    id: str = Field(..., min_length=1, max_length=100, description="租戶識別碼")
    name: str = Field(..., min_length=1, max_length=255, description="租戶名稱")


class TenantCreate(TenantBase):
    pass


class TenantUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="租戶名稱")


class TenantResponse(BaseModel):
    id: str
    name: str

    class Config:
        from_attributes = True
