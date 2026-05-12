"""KM 知識庫 API：建立、列表、更新、刪除知識庫（kb）"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bot import BotKnowledgeBase
from app.models.km_document import KmDocument
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.user import User
from app.models.km_chunk import KmChunk

router = APIRouter()
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


KB_SCOPES = {"personal", "company"}


class KbCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    model_name: str | None = None
    system_prompt: str | None = None
    scope: str = "personal"
    answer_mode: str = "rag"  # 'rag' | 'direct'


class KbUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    model_name: str | None = None
    system_prompt: str | None = None
    scope: str | None = None
    answer_mode: str | None = None  # 'rag' | 'direct'


class KbResponse(BaseModel):
    id: int
    name: str
    description: str | None
    model_name: str | None
    system_prompt: str | None
    scope: str
    answer_mode: str
    created_by: int | None
    doc_count: int
    ready_count: int
    bot_count: int
    created_at: str

    model_config = {"from_attributes": True}


def _to_response(kb: KmKnowledgeBase, db: Session) -> KbResponse:
    all_docs = db.query(KmDocument).filter(KmDocument.knowledge_base_id == kb.id).all()
    bot_count = db.query(BotKnowledgeBase).filter(BotKnowledgeBase.knowledge_base_id == kb.id).count()
    return KbResponse(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        model_name=kb.model_name,
        system_prompt=kb.system_prompt,
        scope=kb.scope or "personal",
        answer_mode=kb.answer_mode or "rag",
        created_by=kb.created_by,
        doc_count=len(all_docs),
        ready_count=sum(1 for d in all_docs if d.status == "ready"),
        bot_count=bot_count,
        created_at=kb.created_at.isoformat() if kb.created_at else "",
    )


def _can_manage(role: str) -> bool:
    return role in ("admin", "super_admin", "manager")


def _is_admin(role: str) -> bool:
    """Token 開通/撤銷限 admin / super_admin，manager 不在此列"""
    return role in ("admin", "super_admin")


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post("/knowledge-bases", response_model=KbResponse, status_code=201)
def create_knowledge_base(
    body: KbCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    scope = (body.scope or "personal").strip()
    if scope not in KB_SCOPES:
        raise HTTPException(status_code=400, detail=f"scope 必須是 {KB_SCOPES} 之一")
    # member 只能建立 personal KB；company scope 需要 manager+
    if scope == "company" and not _can_manage(current.role):
        raise HTTPException(status_code=403, detail="只有管理員可以建立公司共用知識庫")
    # 強制 member 的 scope 永遠是 personal
    if not _can_manage(current.role):
        scope = "personal"

    existing = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.tenant_id == current.tenant_id,
        KmKnowledgeBase.name == body.name.strip(),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"知識庫「{body.name}」已存在")

    kb = KmKnowledgeBase(
        tenant_id=current.tenant_id,
        name=body.name.strip(),
        description=body.description,
        model_name=body.model_name or None,
        system_prompt=body.system_prompt or None,
        scope=scope,
        answer_mode=body.answer_mode if body.answer_mode in ("rag", "direct") else "rag",
        created_by=current.id,
    )
    db.add(kb)
    db.commit()
    db.refresh(kb)
    return _to_response(kb, db)


@router.get("/knowledge-bases", response_model=list[KbResponse])
def list_knowledge_bases(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    from sqlalchemy import or_
    # personal：只有建立者自己的；company：同 tenant 全員可見
    kbs = (
        db.query(KmKnowledgeBase)
        .filter(
            KmKnowledgeBase.tenant_id == current.tenant_id,
            or_(
                KmKnowledgeBase.scope == "company",
                KmKnowledgeBase.created_by == current.id,
            ),
        )
        .order_by(KmKnowledgeBase.created_at.asc())
        .all()
    )
    return [_to_response(kb, db) for kb in kbs]


@router.patch("/knowledge-bases/{kb_id}", response_model=KbResponse)
def update_knowledge_base(
    kb_id: int,
    body: KbUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == kb_id,
        KmKnowledgeBase.tenant_id == current.tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")
    # admin+：可修改任意 KB
    # manager：只能修改自己建立的 KB
    # member：只能修改自己的 personal KB
    if not _is_admin(current.role):
        if kb.created_by != current.id:
            raise HTTPException(status_code=403, detail="只能修改自己建立的知識庫")
        if not _can_manage(current.role) and kb.scope != "personal":
            raise HTTPException(status_code=403, detail="只能修改自己的個人知識庫")

    if body.name is not None:
        kb.name = body.name.strip()
    if body.description is not None:
        kb.description = body.description
    kb.model_name = body.model_name or None
    kb.system_prompt = body.system_prompt or None
    if body.scope is not None:
        new_scope = body.scope.strip()
        if new_scope not in KB_SCOPES:
            raise HTTPException(status_code=400, detail=f"scope 必須是 {KB_SCOPES} 之一")
        if not _can_manage(current.role):
            raise HTTPException(status_code=403, detail="只有管理員可以變更知識庫範圍")
        kb.scope = new_scope
    if body.answer_mode is not None:
        if body.answer_mode not in ("rag", "direct"):
            raise HTTPException(status_code=400, detail="answer_mode 必須是 'rag' 或 'direct'")
        kb.answer_mode = body.answer_mode
    db.commit()
    db.refresh(kb)
    return _to_response(kb, db)


@router.delete("/knowledge-bases/{kb_id}", status_code=204)
def delete_knowledge_base(
    kb_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除知識庫。member 只能刪自己建的 personal KB；manager+ 可刪任意 KB。"""
    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == kb_id,
        KmKnowledgeBase.tenant_id == current.tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")
    # admin+：可刪除任意 KB
    # manager：只能刪除自己建立的 KB
    # member：只能刪除自己的 personal KB
    if not _is_admin(current.role):
        if kb.created_by != current.id:
            raise HTTPException(status_code=403, detail="只能刪除自己建立的知識庫")
        if not _can_manage(current.role) and kb.scope != "personal":
            raise HTTPException(status_code=403, detail="只能刪除自己的個人知識庫")

    # 刪文件（chunks 由 DB ondelete=CASCADE 自動清除）
    for doc in db.query(KmDocument).filter(KmDocument.knowledge_base_id == kb_id).all():
        db.delete(doc)

    db.delete(kb)
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# Admin 專用：列出 tenant 下所有 KB（含建立者名稱）
# ──────────────────────────────────────────────────────────────────────────────

class KbAdminResponse(KbResponse):
    created_by_name: str | None = None


@router.get("/admin/knowledge-bases", response_model=list[KbAdminResponse])
def admin_list_knowledge_bases(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出 tenant 下所有 KB（不限 scope/owner），僅限 admin / super_admin"""
    if not _is_admin(current.role):
        raise HTTPException(status_code=403, detail="只有系統管理員可以存取此 API")

    kbs = (
        db.query(KmKnowledgeBase)
        .filter(KmKnowledgeBase.tenant_id == current.tenant_id)
        .order_by(KmKnowledgeBase.created_at.asc())
        .all()
    )

    user_ids = {kb.created_by for kb in kbs if kb.created_by is not None}
    user_map: dict[int, str] = {}
    if user_ids:
        users = db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()
        user_map = {u.id: u.username for u in users}

    results = []
    for kb in kbs:
        base = _to_response(kb, db)
        results.append(KbAdminResponse(
            **base.model_dump(),
            created_by_name=user_map.get(kb.created_by) if kb.created_by else None,
        ))
    return results


# ──────────────────────────────────────────────────────────────────────────────
# 查詢統計
# ──────────────────────────────────────────────────────────────────────────────

class QueryStatsSummary(BaseModel):
    total_queries: int
    hit_count: int
    zero_hit_count: int
    hit_rate: float  # 0.0 ~ 1.0


class QueryItem(BaseModel):
    query: str
    count: int
    hit: bool
    last_asked_at: str  # ISO 8601


class QueryStatsResponse(BaseModel):
    summary: QueryStatsSummary
    queries: list[QueryItem]
    total: int       # 篩選後去重問題總筆數（分頁用）
    has_more: bool


@router.get("/knowledge-bases/{kb_id}/query-stats", response_model=QueryStatsResponse)
def get_knowledge_base_query_stats(
    kb_id: int,
    days: int = 30,
    view: str = "top_queries",   # top_queries | zero_hit
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """KB 查詢統計：摘要 + 問題清單。view=top_queries 最多人問；view=zero_hit 零命中清單。"""
    from datetime import datetime, timedelta, timezone

    import sqlalchemy as sa

    from app.models.km_query_log import KmQueryLog

    # 確認 KB 存在且屬於此 tenant
    kb = db.query(KmKnowledgeBase).filter(
        KmKnowledgeBase.id == kb_id,
        KmKnowledgeBase.tenant_id == current.tenant_id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="知識庫不存在")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    base_q = db.query(KmQueryLog).filter(
        KmQueryLog.knowledge_base_id == kb_id,
        KmQueryLog.created_at >= since,
    )

    # ── 摘要統計 ──
    total_queries = base_q.count()
    hit_count = base_q.filter(KmQueryLog.hit == True).count()  # noqa: E712
    zero_hit_count = total_queries - hit_count
    hit_rate = round(hit_count / total_queries, 4) if total_queries > 0 else 0.0

    summary = QueryStatsSummary(
        total_queries=total_queries,
        hit_count=hit_count,
        zero_hit_count=zero_hit_count,
        hit_rate=hit_rate,
    )

    # ── 問題清單（GROUP BY query，計次數） ──
    hit_filter = None
    if view == "zero_hit":
        hit_filter = KmQueryLog.hit == False   # noqa: E712

    agg_q = (
        db.query(
            KmQueryLog.query,
            sa.func.count(KmQueryLog.id).label("cnt"),
            sa.func.bool_or(KmQueryLog.hit).label("any_hit"),
            sa.func.max(KmQueryLog.created_at).label("last_at"),
        )
        .filter(
            KmQueryLog.knowledge_base_id == kb_id,
            KmQueryLog.created_at >= since,
        )
    )
    if hit_filter is not None:
        agg_q = agg_q.filter(hit_filter)

    agg_q = agg_q.group_by(KmQueryLog.query).order_by(sa.desc("cnt"))

    total_distinct = agg_q.count()
    rows = agg_q.offset(offset).limit(limit).all()

    queries = [
        QueryItem(
            query=r.query,
            count=r.cnt,
            hit=bool(r.any_hit),
            last_asked_at=r.last_at.isoformat() if r.last_at else "",
        )
        for r in rows
    ]

    return QueryStatsResponse(
        summary=summary,
        queries=queries,
        total=total_distinct,
        has_more=(offset + limit) < total_distinct,
    )
