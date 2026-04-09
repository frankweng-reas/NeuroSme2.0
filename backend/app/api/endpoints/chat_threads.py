"""ChatAgent 對話串與訊息：chat_threads / chat_messages（LLM 觀測列於 chat_llm_requests，可另接內部寫入）"""
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, joinedload
from starlette.requests import Request

from app.api.endpoints.source_files import _check_agent_access
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.chat_llm_request import ChatLlmRequest
from app.models.chat_message import ChatMessage
from app.models.chat_message_attachment import ChatMessageAttachment
from app.models.chat_thread import ChatThread
from app.models.user import User
from app.models.stored_file import StoredFile
from app.services.chat_attachment_service import (
    build_attachment_reference_text,
    cleanup_stored_file_if_unreferenced,
    collect_attachment_file_ids_for_thread,
    file_ids_linked_to_thread,
    persist_chat_uploads,
    resolve_llm_attachment_window_reference_text,
)
from app.services.stored_files_store import absolute_blob_path

router = APIRouter()

MAX_MESSAGE_CONTENT_LEN = 500_000
_VALID_ROLES = frozenset({"user", "assistant", "system"})


class ChatThreadCreate(BaseModel):
    agent_id: str = Field(..., description="與 /agents 相同之 composite 或業務 agent_id")
    title: str | None = Field(None, max_length=512)


class ChatThreadPatch(BaseModel):
    title: str | None = Field(None, max_length=512)
    status: str | None = Field(None, max_length=32)


class ChatThreadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: str
    agent_id: str
    title: str | None
    status: str
    last_message_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ChatMessageCreate(BaseModel):
    role: str = Field(..., description="user | assistant | system")
    content: str = Field(..., min_length=1, max_length=MAX_MESSAGE_CONTENT_LEN)
    llm_request_id: UUID | None = Field(
        None,
        description="可選，對應 chat_llm_requests.id（須與此 thread 同租戶；僅 assistant 可帶）",
    )
    context_file_ids: list[UUID] | None = Field(
        None,
        description="僅 user：非 None 時錨定本段附件（須皆曾出現於本 thread）；省略則沿用上一錨點",
    )


class ChatMessageAttachmentItem(BaseModel):
    file_id: UUID
    original_filename: str
    size_bytes: int
    content_type: str | None = None


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    thread_id: UUID
    sequence: int
    role: str
    content: str
    llm_request_id: UUID | None
    created_at: datetime
    attachments: list[ChatMessageAttachmentItem] = Field(default_factory=list)
    context_file_ids: list[UUID] | None = Field(
        None,
        description="user：非 None 表示錨定集合；None 表示沿用上一錨點",
    )


class ChatMessagePatch(BaseModel):
    context_file_ids: list[UUID] | None = Field(
        None,
        description="僅 user：更新錨定之檔案 id 列表（須皆曾出現於本 thread）",
    )


class ThreadFileItem(BaseModel):
    file_id: UUID
    original_filename: str
    size_bytes: int
    content_type: str | None = None


class AttachmentReferenceTextResponse(BaseModel):
    text: str


class ChatAttachmentsUploadResult(BaseModel):
    uploaded: int


def _parse_context_file_ids_column(msg: ChatMessage) -> list[UUID] | None:
    raw = msg.context_file_ids
    if raw is None:
        return None
    out: list[UUID] = []
    for x in raw:
        try:
            out.append(UUID(str(x)))
        except ValueError:
            continue
    return out


def _message_to_response(msg: ChatMessage) -> ChatMessageResponse:
    atts: list[ChatMessageAttachmentItem] = []
    for a in sorted(msg.attachments, key=lambda x: x.created_at):
        sf = a.file
        if sf is None or sf.deleted_at is not None:
            continue
        atts.append(
            ChatMessageAttachmentItem(
                file_id=sf.id,
                original_filename=sf.original_filename,
                size_bytes=int(sf.size_bytes),
                content_type=sf.content_type,
            )
        )
    return ChatMessageResponse(
        id=msg.id,
        thread_id=msg.thread_id,
        sequence=msg.sequence,
        role=msg.role,
        content=msg.content,
        llm_request_id=msg.llm_request_id,
        created_at=msg.created_at,
        attachments=atts,
        context_file_ids=_parse_context_file_ids_column(msg),
    )


def _require_context_file_ids_in_thread(db: Session, *, thread_id: UUID, uuids: list[UUID]) -> None:
    if not file_ids_linked_to_thread(db, thread_id, uuids):
        raise HTTPException(
            status_code=400,
            detail="context_file_ids 須皆為本對話曾出現過的附加檔（先於對話中上傳或引用）",
        )


def _get_thread_owned(db: Session, *, thread_id: UUID, tenant_id: str, user_id: int) -> ChatThread:
    row = (
        db.query(ChatThread)
        .filter(
            ChatThread.id == thread_id,
            ChatThread.tenant_id == tenant_id,
            ChatThread.user_id == user_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="對話不存在或無權限")
    return row


@router.get("/threads", response_model=list[ChatThreadResponse])
def list_chat_threads(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    tenant_id, aid = _check_agent_access(db, current, agent_id)
    rows = (
        db.query(ChatThread)
        .filter(
            ChatThread.tenant_id == tenant_id,
            ChatThread.user_id == current.id,
            ChatThread.agent_id == aid,
        )
        .order_by(ChatThread.updated_at.desc())
        .all()
    )
    return rows


@router.post("/threads", response_model=ChatThreadResponse, status_code=status.HTTP_201_CREATED)
def create_chat_thread(
    body: ChatThreadCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    tenant_id, aid = _check_agent_access(db, current, body.agent_id)
    t = (body.title or "").strip() or None
    row = ChatThread(
        tenant_id=tenant_id,
        user_id=current.id,
        agent_id=aid,
        title=t,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/threads/{thread_id}", response_model=ChatThreadResponse)
def patch_chat_thread(
    thread_id: UUID,
    body: ChatThreadPatch,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    row = _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    patch_data = body.model_dump(exclude_unset=True)
    if "title" in patch_data:
        t = patch_data["title"]
        row.title = (t or "").strip() or None if isinstance(t, str) else None
    if "status" in patch_data:
        s = (patch_data["status"] or "").strip()
        if s:
            row.status = s
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat_thread(
    thread_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    row = _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    file_ids = collect_attachment_file_ids_for_thread(db, thread_id)
    db.delete(row)
    db.commit()
    for fid in file_ids:
        cleanup_stored_file_if_unreferenced(db, fid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageResponse])
def list_chat_messages(
    thread_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    rows = (
        db.query(ChatMessage)
        .options(
            joinedload(ChatMessage.attachments).joinedload(ChatMessageAttachment.file),
        )
        .filter(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.sequence.asc(), ChatMessage.created_at.asc())
        .all()
    )
    return [_message_to_response(m) for m in rows]


@router.get("/threads/{thread_id}/files", response_model=list[ThreadFileItem])
def list_thread_files(
    thread_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    subq = (
        db.query(
            ChatMessageAttachment.file_id.label("fid"),
            func.min(ChatMessageAttachment.created_at).label("first_at"),
        )
        .join(ChatMessage, ChatMessage.id == ChatMessageAttachment.message_id)
        .filter(ChatMessage.thread_id == thread_id)
        .group_by(ChatMessageAttachment.file_id)
    ).subquery()
    rows = (
        db.query(StoredFile, subq.c.first_at)
        .join(subq, subq.c.fid == StoredFile.id)
        .filter(StoredFile.deleted_at.is_(None))
        .order_by(subq.c.first_at.asc())
        .all()
    )
    return [
        ThreadFileItem(
            file_id=sf.id,
            original_filename=sf.original_filename,
            size_bytes=int(sf.size_bytes),
            content_type=sf.content_type,
        )
        for sf, _ in rows
    ]


@router.get("/threads/{thread_id}/files/{file_id}/content")
def get_thread_stored_file_content(
    thread_id: UUID,
    file_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """下載本對話曾出現之 stored_files 內容（供前端顯示圖片等；須登入且擁有該 thread）。"""
    _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    n = (
        db.query(ChatMessageAttachment)
        .join(ChatMessage, ChatMessage.id == ChatMessageAttachment.message_id)
        .filter(ChatMessage.thread_id == thread_id, ChatMessageAttachment.file_id == file_id)
        .count()
    )
    if n == 0:
        raise HTTPException(status_code=404, detail="此對話中無該附件")
    sf = (
        db.query(StoredFile)
        .filter(
            StoredFile.id == file_id,
            StoredFile.tenant_id == current.tenant_id,
            StoredFile.deleted_at.is_(None),
        )
        .first()
    )
    if not sf:
        raise HTTPException(status_code=404, detail="檔案不存在")
    try:
        path = absolute_blob_path(sf.tenant_id, sf.id)
    except RuntimeError:
        raise HTTPException(status_code=503, detail="檔案儲存未設定")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="實體檔案不存在")
    raw = path.read_bytes()
    ct = (sf.content_type or "").strip() or "application/octet-stream"
    return Response(
        content=raw,
        media_type=ct,
        headers={
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.post("/threads/{thread_id}/messages", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
def append_chat_message(
    thread_id: UUID,
    body: ChatMessageCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    thread = _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    role = (body.role or "").strip().lower()
    if role not in _VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role 須為 {sorted(_VALID_ROLES)} 之一")
    max_seq = db.query(func.coalesce(func.max(ChatMessage.sequence), 0)).filter(ChatMessage.thread_id == thread_id).scalar()
    next_seq = int(max_seq or 0) + 1
    now = datetime.now(timezone.utc)
    llm_rid: UUID | None = None
    if body.llm_request_id is not None:
        if role != "assistant":
            raise HTTPException(status_code=400, detail="llm_request_id 僅能搭配 role=assistant")
        owned = (
            db.query(ChatLlmRequest)
            .filter(
                ChatLlmRequest.id == body.llm_request_id,
                ChatLlmRequest.thread_id == thread_id,
                ChatLlmRequest.tenant_id == thread.tenant_id,
            )
            .first()
        )
        if not owned:
            raise HTTPException(status_code=400, detail="llm_request_id 無效或不屬於此對話")
        llm_rid = body.llm_request_id
    ctx_json: list[str] | None = None
    if body.context_file_ids is not None:
        if role != "user":
            raise HTTPException(status_code=400, detail="context_file_ids 僅能搭配 role=user")
        _require_context_file_ids_in_thread(db, thread_id=thread_id, uuids=list(body.context_file_ids))
        ctx_json = [str(u) for u in body.context_file_ids]
    msg = ChatMessage(
        thread_id=thread_id,
        sequence=next_seq,
        role=role,
        content=body.content,
        llm_request_id=llm_rid,
        context_file_ids=ctx_json,
    )
    thread.last_message_at = now
    thread.updated_at = now
    db.add(msg)
    db.add(thread)
    db.commit()
    db.refresh(msg)
    m2 = (
        db.query(ChatMessage)
        .options(
            joinedload(ChatMessage.attachments).joinedload(ChatMessageAttachment.file),
        )
        .filter(ChatMessage.id == msg.id)
        .first()
    )
    return _message_to_response(m2) if m2 else _message_to_response(msg)


@router.post(
    "/threads/{thread_id}/messages/{message_id}/attachments",
    response_model=ChatAttachmentsUploadResult,
    status_code=status.HTTP_201_CREATED,
)
async def upload_chat_message_attachments(
    thread_id: UUID,
    message_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """以 request.form().getlist(\"files\") 解析多檔；避免部分環境下 list[UploadFile]=File(...) 收不到檔案。"""
    thread = _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    msg = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="訊息不存在")
    if (msg.role or "").strip().lower() != "user":
        raise HTTPException(status_code=400, detail="僅能為 user 訊息上傳附加檔")
    form = await request.form()
    raw_files = form.getlist("files")
    if not raw_files:
        raise HTTPException(
            status_code=400,
            detail='multipart 欄位 "files" 為空；請確認前端以 FormData.append("files", blob, filename) 上傳',
        )
    triples: list[tuple[str, str | None, bytes]] = []
    try:
        for uf in raw_files:
            if not hasattr(uf, "read"):
                continue
            body = await uf.read()  # type: ignore[union-attr]
            fn = getattr(uf, "filename", None) or "(未命名)"
            ct = getattr(uf, "content_type", None)
            triples.append((fn, ct, body))
        if not triples:
            raise HTTPException(status_code=400, detail="未讀取到任何上傳檔案內容")
        persist_chat_uploads(
            db,
            tenant_id=thread.tenant_id,
            user_id=current.id,
            message_id=message_id,
            files=triples,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    db.commit()
    return ChatAttachmentsUploadResult(uploaded=len(triples))


@router.get(
    "/threads/{thread_id}/messages/{message_id}/attachment-reference-text",
    response_model=AttachmentReferenceTextResponse,
)
def get_message_attachment_reference_text(
    thread_id: UUID,
    message_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    msg = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="訊息不存在")
    try:
        text = build_attachment_reference_text(
            db,
            message_id=message_id,
            max_chars=settings.CHAT_AGENT_REFERENCE_MAX_CHARS,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return AttachmentReferenceTextResponse(text=text)


@router.get(
    "/threads/{thread_id}/messages/{message_id}/llm-attachment-reference-text",
    response_model=AttachmentReferenceTextResponse,
)
def get_llm_attachment_reference_text(
    thread_id: UUID,
    message_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    thread = _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    msg = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="訊息不存在")
    if (msg.role or "").strip().lower() != "user":
        raise HTTPException(status_code=400, detail="僅能對 user 訊息查詢 LLM 附件參考")
    try:
        text = resolve_llm_attachment_window_reference_text(
            db,
            thread_id=thread_id,
            for_user_message_id=message_id,
            tenant_id=thread.tenant_id,
            max_chars=settings.CHAT_AGENT_REFERENCE_MAX_CHARS,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return AttachmentReferenceTextResponse(text=text)


@router.patch("/threads/{thread_id}/messages/{message_id}", response_model=ChatMessageResponse)
def patch_chat_message(
    thread_id: UUID,
    message_id: UUID,
    body: ChatMessagePatch,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    patch_data = body.model_dump(exclude_unset=True)
    if not patch_data:
        raise HTTPException(status_code=400, detail="請至少提供要更新的欄位")
    msg = (
        db.query(ChatMessage)
        .options(
            joinedload(ChatMessage.attachments).joinedload(ChatMessageAttachment.file),
        )
        .filter(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="訊息不存在")
    if (msg.role or "").strip().lower() != "user":
        raise HTTPException(status_code=400, detail="僅能更新 user 訊息")
    if "context_file_ids" in patch_data:
        raw = patch_data["context_file_ids"]
        if raw is None:
            msg.context_file_ids = None
        else:
            _require_context_file_ids_in_thread(db, thread_id=thread_id, uuids=list(raw))
            msg.context_file_ids = [str(u) for u in raw]
    now = datetime.now(timezone.utc)
    trow = db.query(ChatThread).filter(ChatThread.id == thread_id).first()
    if trow:
        trow.updated_at = now
        db.add(trow)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    m2 = (
        db.query(ChatMessage)
        .options(
            joinedload(ChatMessage.attachments).joinedload(ChatMessageAttachment.file),
        )
        .filter(ChatMessage.id == msg.id)
        .first()
    )
    return _message_to_response(m2) if m2 else _message_to_response(msg)


@router.delete(
    "/threads/{thread_id}/messages/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_chat_message(
    thread_id: UUID,
    message_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    thread = _get_thread_owned(db, thread_id=thread_id, tenant_id=current.tenant_id, user_id=current.id)
    msg = (
        db.query(ChatMessage)
        .options(joinedload(ChatMessage.attachments))
        .filter(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="訊息不存在")
    file_ids = [a.file_id for a in msg.attachments]
    db.delete(msg)
    now = datetime.now(timezone.utc)
    latest = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == thread_id)
        .order_by(desc(ChatMessage.sequence), desc(ChatMessage.created_at))
        .first()
    )
    thread.last_message_at = latest.created_at if latest else None
    thread.updated_at = now
    db.add(thread)
    db.commit()
    for fid in file_ids:
        cleanup_stored_file_if_unreferenced(db, fid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
