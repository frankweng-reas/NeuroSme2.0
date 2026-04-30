"""User 相關 Pydantic 結構：UserBase, UserCreate, UserResponse"""
from typing import Optional

from pydantic import BaseModel, EmailStr

Role = str  # 'admin' | 'manager' | 'member'


class UserBase(BaseModel):
    email: EmailStr
    username: str


class UserCreate(UserBase):
    password: str
    role: str = "member"
    must_change_password: bool = False


class UserResponse(UserBase):
    id: int
    role: Role = "member"
    tenant_id: str = ""
    display_name: Optional[str] = None
    avatar_b64: Optional[str] = None

    class Config:
        from_attributes = True


class UserProfileUpdate(BaseModel):
    """本人更新個人 profile：顯示名稱、頭像"""
    display_name: Optional[str] = None
    avatar_b64: Optional[str] = None


class UserAgentsUpdate(BaseModel):
    """更新使用者可存取的 agent 清單"""
    agent_ids: list[str]


class UserRoleUpdate(BaseModel):
    """更新使用者角色"""
    role: str  # 'admin' | 'manager' | 'member'


class UserUpdate(BaseModel):
    """管理員修改使用者：顯示名稱、角色"""
    username: Optional[str] = None
    role: Optional[str] = None


class UserModelPermissionsUpdate(BaseModel):
    """更新使用者可使用的模型清單；null = 繼承租戶全部模型"""
    allowed_models: Optional[list[str]] = None


class UserModelPermissionsResponse(BaseModel):
    """使用者模型權限回應"""
    user_id: int
    allowed_models: Optional[list[str]] = None
