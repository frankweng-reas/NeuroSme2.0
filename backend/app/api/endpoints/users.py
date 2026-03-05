"""Users API：GET /users/me 當前使用者、GET /users/by-email、POST /users/ 註冊、GET/PUT /users/{id}/agents"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.endpoints.agents import _parse_agent_id
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.user_agent import UserAgent
from app.schemas.user import UserAgentsUpdate, UserCreate, UserResponse, UserRoleUpdate
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


def _is_admin_or_super(user: User) -> bool:
    """admin 或 super_admin 可執行管理操作"""
    return user.role in ("admin", "super_admin")


def _require_self_or_admin(current: User, target_user_id: int) -> None:
    """僅本人或 admin/super_admin 可操作"""
    if current.id != target_user_id and not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="無權限")


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current: Annotated[User, Depends(get_current_user)]):
    """取得當前登入使用者（從 JWT）"""
    return current


@router.get("/by-email", response_model=UserResponse)
def get_user_by_email(
    email: str = Query(..., description="使用者 email"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """依 email 查詢 user（需登入，僅本人或 admin 可查他人）"""
    user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if current.id != user.id and not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="無權限")
    return user


@router.get("/", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出當前 admin 所屬 tenant 內所有使用者"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    return db.query(User).filter(User.tenant_id == current.tenant_id).all()


@router.post("/", response_model=UserResponse)
def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    db_user = db.query(User).filter(
        func.lower(User.email) == user.email.lower(),
        User.tenant_id == current.tenant_id,
    ).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    db_user = User(
        email=user.email,
        username=user.username,
        hashed_password=user.password,  # TODO: 使用 bcrypt 加密
        tenant_id=current.tenant_id,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.get("/{user_id}/agents")
def get_user_agents(
    user_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 user 可存取的 agent_id 清單（僅本人或 admin）"""
    _require_self_or_admin(current, user_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    raw_ids = get_agent_ids_for_user(db, user_id)
    # 回傳 tenant_id:id 格式，與 AgentResponse.id 一致
    agent_ids = [f"{user.tenant_id}:{aid}" for aid in raw_ids]
    return {"agent_ids": agent_ids}


@router.patch("/{user_id}/role")
def update_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新該 user 的角色（僅 admin）"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="role must be admin or member")
    if body.role == "member" and user.role == "admin":
        admin_count = db.query(User).filter(
            User.role == "admin",
            User.tenant_id == user.tenant_id,
        ).count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="系統至少需保留一位 admin，無法將唯一的管理員改為 member",
            )
    user.role = body.role
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/agents")
def update_user_agents(
    user_id: int,
    body: UserAgentsUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新該 user 可存取的 agent 清單（僅 admin）"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # 刪除既有關聯
    db.query(UserAgent).filter(
        UserAgent.user_id == user_id,
        UserAgent.tenant_id == user.tenant_id,
    ).delete()
    # 新增新關聯（agent_id 支援 tenant_id:id 或 僅 id）
    for raw_id in body.agent_ids:
        tenant_id, aid = _parse_agent_id(raw_id, user.tenant_id)
        if tenant_id != user.tenant_id:
            continue  # 略過非該 tenant 的 agent
        db.add(UserAgent(
            user_id=user_id,
            agent_id=aid,
            tenant_id=user.tenant_id,
        ))
    db.commit()
    return {"agent_ids": body.agent_ids}
