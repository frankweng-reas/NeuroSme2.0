"""Bot API：Knowledge Bot Agent 的 Bot CRUD + token 管理"""
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bot import Bot, BotKnowledgeBase
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class BotKbItem(BaseModel):
    knowledge_base_id: int
    sort_order: int = 0


class BotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    system_prompt: str | None = None
    model_name: str | None = None
    knowledge_base_ids: list[BotKbItem] = []


class BotUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    is_active: bool | None = None
    system_prompt: str | None = None
    model_name: str | None = None
    knowledge_base_ids: list[BotKbItem] | None = None
    widget_title: str | None = None
    widget_logo_url: str | None = None
    widget_color: str | None = None
    widget_lang: str | None = None
    widget_voice_enabled: bool | None = None
    widget_voice_prompt: str | None = None


class BotKbResponse(BaseModel):
    knowledge_base_id: int
    name: str
    sort_order: int

    model_config = {"from_attributes": True}


class BotResponse(BaseModel):
    id: int
    name: str
    description: str | None
    is_active: bool
    system_prompt: str | None
    model_name: str | None
    public_token: str | None
    widget_title: str | None
    widget_logo_url: str | None
    widget_color: str | None
    widget_lang: str | None
    widget_voice_enabled: bool
    widget_voice_prompt: str | None
    knowledge_bases: list[BotKbResponse]
    created_at: str

    model_config = {"from_attributes": True}


def _to_response(bot: Bot, db: Session) -> BotResponse:
    kb_rows = (
        db.query(BotKnowledgeBase, KmKnowledgeBase.name)
        .join(KmKnowledgeBase, BotKnowledgeBase.knowledge_base_id == KmKnowledgeBase.id)
        .filter(BotKnowledgeBase.bot_id == bot.id)
        .order_by(BotKnowledgeBase.sort_order)
        .all()
    )
    kbs = [
        BotKbResponse(
            knowledge_base_id=row.BotKnowledgeBase.knowledge_base_id,
            name=row.name,
            sort_order=row.BotKnowledgeBase.sort_order,
        )
        for row in kb_rows
    ]
    return BotResponse(
        id=bot.id,
        name=bot.name,
        description=bot.description,
        is_active=bot.is_active,
        system_prompt=bot.system_prompt,
        model_name=bot.model_name,
        public_token=bot.public_token,
        widget_title=bot.widget_title,
        widget_logo_url=bot.widget_logo_url,
        widget_color=bot.widget_color,
        widget_lang=bot.widget_lang,
        widget_voice_enabled=bot.widget_voice_enabled or False,
        widget_voice_prompt=bot.widget_voice_prompt,
        knowledge_bases=kbs,
        created_at=bot.created_at.isoformat() if bot.created_at else "",
    )


def _can_manage(role: str) -> bool:
    return role in ("admin", "super_admin", "manager")


def _is_admin(role: str) -> bool:
    return role in ("admin", "super_admin")


def _sync_kb_relations(bot_id: int, kb_items: list[BotKbItem], db: Session) -> None:
    db.query(BotKnowledgeBase).filter(BotKnowledgeBase.bot_id == bot_id).delete()
    for item in kb_items:
        db.add(BotKnowledgeBase(
            bot_id=bot_id,
            knowledge_base_id=item.knowledge_base_id,
            sort_order=item.sort_order,
        ))


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post("", response_model=BotResponse, status_code=201)
def create_bot(
    body: BotCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以建立 Bot")

    existing = db.query(Bot).filter(
        Bot.tenant_id == current.tenant_id,
        Bot.name == body.name.strip(),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Bot「{body.name}」已存在")

    bot = Bot(
        tenant_id=current.tenant_id,
        name=body.name.strip(),
        description=body.description,
        system_prompt=body.system_prompt or None,
        model_name=body.model_name or None,
        created_by=current.id,
    )
    db.add(bot)
    db.flush()
    _sync_kb_relations(bot.id, body.knowledge_base_ids, db)
    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)


@router.get("", response_model=list[BotResponse])
def list_bots(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    bots = (
        db.query(Bot)
        .filter(Bot.tenant_id == current.tenant_id)
        .order_by(Bot.created_at.asc())
        .all()
    )
    return [_to_response(b, db) for b in bots]


@router.get("/{bot_id}", response_model=BotResponse)
def get_bot(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")
    return _to_response(bot, db)


@router.patch("/{bot_id}", response_model=BotResponse)
def update_bot(
    bot_id: int,
    body: BotUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以修改 Bot")

    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")

    if body.name is not None:
        bot.name = body.name.strip()
    if body.description is not None:
        bot.description = body.description
    if body.is_active is not None:
        bot.is_active = body.is_active
    if body.system_prompt is not None:
        bot.system_prompt = body.system_prompt or None
    if body.model_name is not None:
        bot.model_name = body.model_name or None
    if body.widget_title is not None:
        bot.widget_title = body.widget_title or None
    if body.widget_logo_url is not None:
        bot.widget_logo_url = body.widget_logo_url or None
    if body.widget_color is not None:
        bot.widget_color = body.widget_color or None
    if body.widget_lang is not None:
        bot.widget_lang = body.widget_lang or None
    if body.widget_voice_enabled is not None:
        bot.widget_voice_enabled = body.widget_voice_enabled
    if body.widget_voice_prompt is not None:
        bot.widget_voice_prompt = body.widget_voice_prompt or None
    if body.knowledge_base_ids is not None:
        _sync_kb_relations(bot.id, body.knowledge_base_ids, db)

    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)


@router.delete("/{bot_id}", status_code=204)
def delete_bot(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    if not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以刪除 Bot")

    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")

    db.delete(bot)
    db.commit()


@router.post("/{bot_id}/generate-token", response_model=BotResponse)
def generate_bot_token(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """產生（或重設）Bot Widget public_token，僅限 admin / super_admin"""
    if not _is_admin(current.role):
        raise HTTPException(status_code=403, detail="只有系統管理員可以開通 Widget Token")

    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")

    bot.public_token = uuid.uuid4().hex
    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)


@router.delete("/{bot_id}/token", response_model=BotResponse)
def revoke_bot_token(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """停用 Bot Widget：清空 public_token，僅限 admin / super_admin"""
    if not _is_admin(current.role):
        raise HTTPException(status_code=403, detail="只有系統管理員可以停用 Widget Token")

    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")

    bot.public_token = None
    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)
