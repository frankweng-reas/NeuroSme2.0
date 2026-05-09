"""Widget 管理 API：供登入用戶查看 Widget 訪客 session 與對話紀錄"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bot import Bot
from app.models.bot_widget_session import BotWidgetMessage, BotWidgetSession
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.user import User
from app.models.widget_message import WidgetMessage
from app.models.widget_session import WidgetSession

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────────


class WidgetSessionItem(BaseModel):
    session_id: str
    visitor_name: str | None
    visitor_email: str | None
    visitor_phone: str | None
    message_count: int
    created_at: str
    last_active_at: str

    model_config = {"from_attributes": True}


class WidgetMessageItem(BaseModel):
    id: int
    role: str
    content: str
    created_at: str

    model_config = {"from_attributes": True}


class WidgetSessionDetail(WidgetSessionItem):
    messages: list[WidgetMessageItem]


# ── Helpers ────────────────────────────────────────────────────────────────────


def _get_kb_for_user(kb_id: int, current: User, db: Session) -> KmKnowledgeBase:
    kb = (
        db.query(KmKnowledgeBase)
        .filter(
            KmKnowledgeBase.id == kb_id,
            KmKnowledgeBase.tenant_id == current.tenant_id,
        )
        .first()
    )
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")
    return kb


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.get("/kb/{kb_id}/sessions", response_model=list[WidgetSessionItem])
def list_widget_sessions(
    kb_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出指定知識庫的所有 Widget 訪客 Session（含訊息筆數）"""
    _get_kb_for_user(kb_id, current, db)

    sessions = (
        db.query(WidgetSession)
        .filter(WidgetSession.kb_id == kb_id)
        .order_by(WidgetSession.last_active_at.desc())
        .all()
    )

    result = []
    for s in sessions:
        count = db.query(WidgetMessage).filter(WidgetMessage.session_id == s.id).count()
        result.append(
            WidgetSessionItem(
                session_id=s.id,
                visitor_name=s.visitor_name,
                visitor_email=s.visitor_email,
                visitor_phone=s.visitor_phone,
                message_count=count,
                created_at=s.created_at.isoformat(),
                last_active_at=s.last_active_at.isoformat(),
            )
        )
    return result


@router.get("/sessions/{session_id}/messages", response_model=WidgetSessionDetail)
def get_widget_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一 Widget Session 的完整對話紀錄"""
    session = db.query(WidgetSession).filter(WidgetSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session 不存在")

    # 確認此 session 所屬 KB 是當前 tenant 的
    _get_kb_for_user(session.kb_id, current, db)

    messages = (
        db.query(WidgetMessage)
        .filter(WidgetMessage.session_id == session_id)
        .order_by(WidgetMessage.created_at)
        .all()
    )

    return WidgetSessionDetail(
        session_id=session.id,
        visitor_name=session.visitor_name,
        visitor_email=session.visitor_email,
        visitor_phone=session.visitor_phone,
        message_count=len(messages),
        created_at=session.created_at.isoformat(),
        last_active_at=session.last_active_at.isoformat(),
        messages=[
            WidgetMessageItem(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=m.created_at.isoformat(),
            )
            for m in messages
        ],
    )


# ── Bot Widget Admin Endpoints ──────────────────────────────────────────────────


def _get_bot_for_user(bot_id: int, current: User, db: Session) -> Bot:
    bot = (
        db.query(Bot)
        .filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id)
        .first()
    )
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")
    return bot


@router.get("/bot/{bot_id}/sessions", response_model=list[WidgetSessionItem])
def list_bot_widget_sessions(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出指定 Bot 的所有 Widget 訪客 Session（含訊息筆數）"""
    _get_bot_for_user(bot_id, current, db)

    sessions = (
        db.query(BotWidgetSession)
        .filter(BotWidgetSession.bot_id == bot_id)
        .order_by(BotWidgetSession.last_active_at.desc())
        .all()
    )

    result = []
    for s in sessions:
        count = db.query(BotWidgetMessage).filter(BotWidgetMessage.session_id == s.id).count()
        result.append(
            WidgetSessionItem(
                session_id=s.id,
                visitor_name=s.visitor_name,
                visitor_email=s.visitor_email,
                visitor_phone=s.visitor_phone,
                message_count=count,
                created_at=s.created_at.isoformat(),
                last_active_at=s.last_active_at.isoformat(),
            )
        )
    return result


@router.get("/bot-sessions/{session_id}/messages", response_model=WidgetSessionDetail)
def get_bot_widget_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一 Bot Widget Session 的完整對話紀錄"""
    session = db.query(BotWidgetSession).filter(BotWidgetSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session 不存在")

    _get_bot_for_user(session.bot_id, current, db)

    messages = (
        db.query(BotWidgetMessage)
        .filter(BotWidgetMessage.session_id == session_id)
        .order_by(BotWidgetMessage.created_at)
        .all()
    )

    return WidgetSessionDetail(
        session_id=session.id,
        visitor_name=session.visitor_name,
        visitor_email=session.visitor_email,
        visitor_phone=session.visitor_phone,
        message_count=len(messages),
        created_at=session.created_at.isoformat(),
        last_active_at=session.last_active_at.isoformat(),
        messages=[
            WidgetMessageItem(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=m.created_at.isoformat(),
            )
            for m in messages
        ],
    )
