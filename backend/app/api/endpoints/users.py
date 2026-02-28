"""Users API：GET /users/ 列表、GET /users/by-email 依 email 查詢、POST /users/ 註冊、GET/PUT /users/{id}/agents"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.models.user_agent import UserAgent
from app.schemas.user import UserAgentsUpdate, UserCreate, UserResponse, UserRoleUpdate
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


@router.get("/by-email", response_model=UserResponse)
def get_user_by_email(
    email: str = Query(..., description="使用者 email"),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).all()


@router.post("/", response_model=UserResponse)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    db_user = User(
        email=user.email,
        username=user.username,
        hashed_password=user.password,  # TODO: 使用 bcrypt 加密
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.get("/{user_id}/agents")
def get_user_agents(user_id: int, db: Session = Depends(get_db)):
    """取得該 user 可存取的 agent_id 清單"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    agent_ids = list(get_agent_ids_for_user(db, user_id))
    return {"agent_ids": agent_ids}


@router.patch("/{user_id}/role")
def update_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: Session = Depends(get_db),
):
    """更新該 user 的角色 (admin | member)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="role must be admin or member")
    if body.role == "member" and user.role == "admin":
        admin_count = db.query(User).filter(User.role == "admin").count()
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
):
    """更新該 user 可存取的 agent 清單（覆蓋式）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # 刪除既有關聯
    db.query(UserAgent).filter(UserAgent.user_id == user_id).delete()
    # 新增新關聯
    for agent_id in body.agent_ids:
        db.add(UserAgent(user_id=user_id, agent_id=agent_id))
    db.commit()
    return {"agent_ids": body.agent_ids}
