"""Users API：GET /users/me、GET /users/by-email、POST /users/、DELETE /users/{id}、GET/PUT /users/{id}/agents"""
import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.endpoints.agents import _parse_agent_id
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.user_agent import UserAgent
from app.schemas.user import UserAgentsUpdate, UserCreate, UserModelPermissionsResponse, UserModelPermissionsUpdate, UserProfileUpdate, UserResponse, UserRoleUpdate, UserUpdate
from app.services.permission import get_agent_ids_for_user, resolve_agent_catalog

router = APIRouter()
logger = logging.getLogger(__name__)


def _is_admin_or_super(user: User) -> bool:
    """admin 或 super_admin 可執行管理操作（manager 不可）"""
    return user.role in ("admin", "super_admin")


def _require_self_or_admin(current: User, target_user_id: int) -> None:
    """僅本人或 admin/super_admin 可操作"""
    if current.id != target_user_id and not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="無權限")


async def _localauth_create_user(email: str, password: str, name: str, must_change_password: bool) -> None:
    """
    代理呼叫 LocalAuth POST /admin/users 建立認證帳號。
    LOCALAUTH_ADMIN_API_KEY 未設定時直接拋錯——Admin 建帳代表 on-prem 場景，
    若未整合 LocalAuth，建出來的帳號無法登入，視為設定錯誤。
    """
    api_key = settings.LOCALAUTH_ADMIN_API_KEY.strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="尚未設定 LOCALAUTH_ADMIN_API_KEY，無法建立認證帳號。請在後端 .env 設定此值後重啟服務。",
        )
    base_url = settings.LOCALAUTH_ADMIN_URL.rstrip("/")
    payload = {
        "email": email,
        "password": password,
        "name": name,
        "mustChangePassword": must_change_password,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{base_url}/admin/users",
            json=payload,
            headers={"x-admin-api-key": api_key},
        )
    if resp.status_code == 409:
        raise HTTPException(status_code=400, detail="Email 已在認證服務中存在")
    if not resp.is_success:
        detail = resp.text[:200] if resp.text else "LocalAuth 建立帳號失敗"
        logger.error("LocalAuth create user failed: %s %s", resp.status_code, detail)
        raise HTTPException(status_code=502, detail=f"認證服務錯誤：{detail}")


async def _localauth_delete_user_by_email(email: str) -> None:
    """
    代理呼叫 LocalAuth DELETE /admin/users/:id。
    LOCALAUTH_ADMIN_API_KEY 未設定時記錄警告但不中斷刪除（DB 端仍會刪除）。
    """
    api_key = settings.LOCALAUTH_ADMIN_API_KEY.strip()
    if not api_key:
        logger.warning("LOCALAUTH_ADMIN_API_KEY 未設定，跳過 LocalAuth 帳號刪除（email=%s）", email)
        return
    base_url = settings.LOCALAUTH_ADMIN_URL.rstrip("/")
    headers = {"x-admin-api-key": api_key}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base_url}/admin/users", headers=headers)
        if not resp.is_success:
            logger.warning("LocalAuth list users failed: %s", resp.status_code)
            return
        users = resp.json()
        target = next((u for u in users if u.get("email", "").lower() == email.lower()), None)
        if not target:
            return
        uid = target.get("id")
        if not uid:
            return
        del_resp = await client.delete(f"{base_url}/admin/users/{uid}", headers=headers)
        if del_resp.status_code not in (200, 204, 404):
            logger.warning("LocalAuth delete user %s failed: %s", uid, del_resp.status_code)


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current: Annotated[User, Depends(get_current_user)]):
    """取得當前登入使用者（從 JWT）"""
    return current


@router.patch("/me/profile", response_model=UserResponse)
def update_my_profile(
    body: UserProfileUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """本人更新個人顯示名稱與頭像（base64）"""
    user = db.query(User).filter(User.id == current.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.display_name is not None:
        user.display_name = body.display_name.strip() or None
    if body.avatar_b64 is not None:
        user.avatar_b64 = body.avatar_b64 or None
    db.commit()
    db.refresh(user)
    return user


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
async def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """
    建立使用者（僅 admin）。
    若 LOCALAUTH_ADMIN_API_KEY 已設定（on-prem），同時在 LocalAuth 建立認證帳號。
    """
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    if user.role not in ("admin", "manager", "member"):
        raise HTTPException(status_code=400, detail="role must be admin, manager or member")
    db_user = db.query(User).filter(
        func.lower(User.email) == user.email.lower(),
        User.tenant_id == current.tenant_id,
    ).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # on-prem：先在 LocalAuth 建立認證帳號（SaaS 模式 api_key 為空則略過）
    await _localauth_create_user(
        email=user.email,
        password=user.password,
        name=user.username,
        must_change_password=user.must_change_password,
    )

    db_user = User(
        email=user.email,
        username=user.username,
        hashed_password=f"localauth_{user.email}",  # 佔位：實際認證走 LocalAuth JWT
        role=user.role,
        tenant_id=current.tenant_id,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """
    刪除使用者（僅 admin，不可刪自己）。
    若 LOCALAUTH_ADMIN_API_KEY 已設定，同時從 LocalAuth 刪除認證帳號。
    """
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    if current.id == user_id:
        raise HTTPException(status_code=400, detail="不能刪除自己的帳號")
    user = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == current.tenant_id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin":
        admin_count = db.query(User).filter(
            User.role == "admin",
            User.tenant_id == current.tenant_id,
        ).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="系統至少需保留一位 admin，無法刪除")

    # on-prem：同步刪除 LocalAuth 認證帳號
    await _localauth_delete_user_by_email(user.email)

    db.query(UserAgent).filter(UserAgent.user_id == user_id).delete()
    db.delete(user)
    db.commit()


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """修改使用者顯示名稱與角色（僅 admin）"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    user = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == current.tenant_id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.username is not None:
        new_name = body.username.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="顯示名稱不可為空")
        user.username = new_name

    if body.role is not None:
        if body.role not in ("admin", "manager", "member"):
            raise HTTPException(status_code=400, detail="role must be admin, manager or member")
        if body.role in ("member", "manager") and user.role == "admin":
            admin_count = db.query(User).filter(
                User.role == "admin",
                User.tenant_id == current.tenant_id,
            ).count()
            if admin_count <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="系統至少需保留一位 admin，無法將唯一的管理員降級",
                )
        user.role = body.role

    db.commit()
    db.refresh(user)
    return user


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
    if body.role not in ("admin", "manager", "member"):
        raise HTTPException(status_code=400, detail="role must be admin, manager or member")
    if body.role in ("member", "manager") and user.role == "admin":
        admin_count = db.query(User).filter(
            User.role == "admin",
            User.tenant_id == user.tenant_id,
        ).count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="系統至少需保留一位 admin，無法將唯一的管理員改為 member 或 manager",
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
    db.query(UserAgent).filter(
        UserAgent.user_id == user_id,
        UserAgent.tenant_id == user.tenant_id,
    ).delete()
    for raw_id in body.agent_ids:
        tenant_id, aid = _parse_agent_id(raw_id, user.tenant_id)
        if tenant_id != user.tenant_id:
            continue
        cat = resolve_agent_catalog(db, aid)
        if not cat:
            raise HTTPException(status_code=400, detail=f"無效的 agent：{aid}")
        db.add(UserAgent(
            user_id=user_id,
            agent_id=cat.agent_id,
            tenant_id=user.tenant_id,
        ))
    db.commit()
    return {"agent_ids": body.agent_ids}


@router.get("/{user_id}/model-permissions", response_model=UserModelPermissionsResponse)
def get_user_model_permissions(
    user_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 user 的模型權限清單（僅 admin 或本人）"""
    _require_self_or_admin(current, user_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    raw = getattr(user, "allowed_models", None)
    allowed: list[str] | None = None
    if isinstance(raw, list):
        allowed = [str(m) for m in raw if isinstance(m, str)]
    return UserModelPermissionsResponse(user_id=user_id, allowed_models=allowed)


@router.put("/{user_id}/model-permissions", response_model=UserModelPermissionsResponse)
def update_user_model_permissions(
    user_id: int,
    body: UserModelPermissionsUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新該 user 可使用的模型清單（僅 admin）；allowed_models=null 表示繼承租戶全部模型。"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    user = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == current.tenant_id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.allowed_models = body.allowed_models  # type: ignore[assignment]
    db.commit()
    db.refresh(user)
    raw = getattr(user, "allowed_models", None)
    allowed: list[str] | None = None
    if isinstance(raw, list):
        allowed = [str(m) for m in raw if isinstance(m, str)]
    return UserModelPermissionsResponse(user_id=user_id, allowed_models=allowed)
