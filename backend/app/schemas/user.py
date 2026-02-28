"""User 相關 Pydantic 結構：UserBase, UserCreate, UserResponse"""
from pydantic import BaseModel, EmailStr

Role = str  # 'admin' | 'member'


class UserBase(BaseModel):
    email: EmailStr
    username: str


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    id: int
    role: Role = "member"

    class Config:
        from_attributes = True


class UserAgentsUpdate(BaseModel):
    """更新使用者可存取的 agent 清單"""
    agent_ids: list[str]


class UserRoleUpdate(BaseModel):
    """更新使用者角色"""
    role: str  # 'admin' | 'member'
