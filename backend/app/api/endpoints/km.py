"""KM API：文件上傳、列表、刪除、狀態查詢、Chunk 編輯"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.km_chunk import KmChunk
from app.models.km_document import KmDocument
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.user import User
from app.services.km_service import detect_faq_format, process_document

router = APIRouter()
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class KmDocumentResponse(BaseModel):
    id: int
    filename: str
    content_type: str | None
    size_bytes: int | None
    scope: str
    status: str
    error_message: str | None
    chunk_count: int | None
    tags: list[str] | None
    knowledge_base_id: int | None
    doc_type: str
    created_at: str

    model_config = {"from_attributes": True}


def _to_response(doc: KmDocument) -> KmDocumentResponse:
    return KmDocumentResponse(
        id=doc.id,
        filename=doc.filename,
        content_type=doc.content_type,
        size_bytes=doc.size_bytes,
        scope=doc.scope,
        status=doc.status,
        error_message=doc.error_message,
        chunk_count=doc.chunk_count,
        tags=doc.tags or [],
        knowledge_base_id=doc.knowledge_base_id,
        doc_type=doc.doc_type,
        created_at=doc.created_at.isoformat() if doc.created_at else "",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".markdown", ".docx", ".doc"}

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def _check_file_type(filename: str, content_type: str | None) -> None:
    name = (filename or "").lower()
    ct = (content_type or "").lower().split(";")[0].strip()
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""

    if ext not in ALLOWED_EXTENSIONS and ct not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"不支援的檔案類型（{ext or ct}）。支援：PDF、TXT、Markdown。",
        )


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post("/documents", response_model=KmDocumentResponse)
async def upload_km_document(
    file: Annotated[UploadFile, File(description="上傳 PDF / TXT / Markdown")],
    scope: Annotated[str, Form(description="'private' 個人 | 'public' 租戶共用（admin）")] = "private",
    tags: Annotated[str, Form(description="JSON 陣列字串，如 '[\"HR\",\"IT\"]'，可選")] = "[]",
    knowledge_base_id: Annotated[int | None, Form(description="知識庫 ID，可選")] = None,
    doc_type: Annotated[str, Form(description="文件類型：article | policy | spec | faq")] = "article",
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """上傳文件到知識庫。完成後同步進行 chunking + embedding。"""
    import json as _json
    from app.services.km_service import DOC_TYPES

    # doc_type 驗證
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"doc_type 必須是 {sorted(DOC_TYPES)} 之一")

    # tags 解析
    try:
        parsed_tags: list[str] = _json.loads(tags) if tags.strip() else []
        if not isinstance(parsed_tags, list):
            parsed_tags = []
        parsed_tags = [str(t).strip() for t in parsed_tags if str(t).strip()]
    except Exception:
        parsed_tags = []

    # knowledge_base_id 驗證，並依 KB scope 決定文件 scope
    if knowledge_base_id is not None:
        from app.models.km_knowledge_base import KmKnowledgeBase
        kb = db.query(KmKnowledgeBase).filter(
            KmKnowledgeBase.id == knowledge_base_id,
            KmKnowledgeBase.tenant_id == current.tenant_id,
        ).first()
        if not kb:
            raise HTTPException(status_code=404, detail="知識庫不存在")
        # direct 模式知識庫只接受 faq 文件類型
        if getattr(kb, 'answer_mode', 'rag') == 'direct' and doc_type != 'faq':
            raise HTTPException(
                status_code=400,
                detail="此知識庫為「精確直答」模式，只能上傳 FAQ 類型文件",
            )
        # 權限：company KB 需 manager+；personal KB 只有 KB 建立者或 admin+ 可上傳
        is_admin = current.role in ("admin", "super_admin")
        can_manage = current.role in ("admin", "super_admin", "manager")
        if kb.scope == "company" and not can_manage:
            raise HTTPException(status_code=403, detail="只有管理員可以上傳到公司共用知識庫")
        if kb.scope == "personal" and kb.created_by != current.id and not is_admin:
            raise HTTPException(status_code=403, detail="只能上傳到自己的知識庫")
        # 文件 scope 自動繼承 KB scope（company → public，personal → private）
        scope = "public" if kb.scope == "company" else "private"
    else:
        # 無 KB 的文件沿用傳入 scope，但非 manager+ 只能 private
        if scope not in ("private", "public"):
            scope = "private"
        if scope == "public" and current.role not in ("admin", "super_admin", "manager"):
            scope = "private"

    filename = file.filename or "unknown"
    content_type = file.content_type

    _check_file_type(filename, content_type)

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"檔案超過 20MB 上限（目前 {len(file_bytes) // 1024 // 1024}MB）",
        )

    # FAQ 格式預先驗證（在建立 DB 記錄前，避免留下無效的 pending 記錄）
    if doc_type == "faq":
        from app.services.km_service import extract_text as _extract_text
        preview_text = _extract_text(file_bytes, content_type, filename)
        if preview_text and not detect_faq_format(preview_text):
            raise HTTPException(
                status_code=422,
                detail=(
                    "此檔案未包含可辨識的 FAQ 格式（需有「Q:/問:/問題:」前綴或「●/○」問答符號，"
                    "且至少 2 組問答對）。"
                    "建議先使用「Doc Refiner」將文件整理成標準 Q&A 格式後再上傳，"
                    "或改選「一般文章」類型。"
                ),
            )

    # 建立文件記錄
    owner_id = current.id if scope == "private" else None
    doc = KmDocument(
        tenant_id=current.tenant_id,
        owner_user_id=owner_id,
        filename=filename,
        content_type=content_type,
        size_bytes=len(file_bytes),
        scope=scope,
        status="pending",
        tags=parsed_tags if parsed_tags else None,
        knowledge_base_id=knowledge_base_id,
        doc_type=doc_type,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # 同步處理（extract → chunk → embed → save）
    process_document(
        doc_id=doc.id,
        file_bytes=file_bytes,
        content_type=content_type,
        filename=filename,
        db=db,
        tenant_id=current.tenant_id,
        doc_type=doc_type,
        agent_id="knowledge",
        user_id=current.id,
    )

    db.refresh(doc)
    return _to_response(doc)


@router.get("/documents", response_model=list[KmDocumentResponse])
def list_km_documents(
    scope: str | None = Query(None, description="過濾：'private' | 'public' | 不傳=全部"),
    knowledge_base_id: int | None = Query(None, description="依知識庫 ID 過濾"),
    no_kb: bool = Query(False, description="True=只列出未歸屬知識庫的文件（Knowledge Agent 用）"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出可存取的知識庫文件（公共 + 自己的私有）。"""
    # [LEGACY 相容] owner_user_id 過濾只用於早期無 KB 的舊文件。
    # 有 KB 的文件應走 KB.created_by + KB.scope 判斷（見 km_service.py RAG 篩選）。
    query = db.query(KmDocument).filter(
        KmDocument.tenant_id == current.tenant_id,
        (
            (KmDocument.scope == "public")
            | (KmDocument.owner_user_id == current.id)
        ),
    )

    if scope == "private":
        query = query.filter(KmDocument.owner_user_id == current.id)
    elif scope == "public":
        query = query.filter(KmDocument.scope == "public")

    if knowledge_base_id is not None:
        query = query.filter(KmDocument.knowledge_base_id == knowledge_base_id)
    elif no_kb:
        query = query.filter(KmDocument.knowledge_base_id == None)  # noqa: E711

    docs = query.order_by(KmDocument.created_at.desc()).all()
    return [_to_response(d) for d in docs]


@router.get("/documents/{doc_id}", response_model=KmDocumentResponse)
def get_km_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一文件狀態。"""
    doc = db.query(KmDocument).filter(
        KmDocument.id == doc_id,
        KmDocument.tenant_id == current.tenant_id,
        (
            (KmDocument.scope == "public")
            | (KmDocument.owner_user_id == current.id)
        ),
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在或無存取權限")
    return _to_response(doc)


@router.delete("/documents/{doc_id}", status_code=204)
def delete_km_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除文件（含所有 chunks）。私有文件只能刪除自己的，公共文件須 admin。"""
    doc = db.query(KmDocument).filter(
        KmDocument.id == doc_id,
        KmDocument.tenant_id == current.tenant_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在")

    if doc.scope == "public" and current.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="只有管理員可以刪除公共知識庫文件")
    if doc.scope == "private" and doc.owner_user_id != current.id:
        raise HTTPException(status_code=403, detail="無法刪除他人的私有文件")

    db.delete(doc)
    db.commit()
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Chunk 編輯 API
# 權限走 KB 層級（見 .cursor/rules/km-architecture.mdc）：
#   personal KB → kb.created_by == current.id
#   company  KB → current.role in ("admin", "super_admin", "manager")
# ──────────────────────────────────────────────────────────────────────────────


class KmChunkResponse(BaseModel):
    id: int
    chunk_index: int
    content: str

    model_config = {"from_attributes": True}


class KmChunkUpdateBody(BaseModel):
    content: str


class KmChunkCreateBody(BaseModel):
    content: str


def _get_doc_and_check_kb_permission(
    doc_id: int,
    current: User,
    db: Session,
) -> KmDocument:
    """取得文件並依 KB scope 驗證編輯權限。"""
    doc = db.query(KmDocument).filter(
        KmDocument.id == doc_id,
        KmDocument.tenant_id == current.tenant_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not doc.knowledge_base_id:
        raise HTTPException(status_code=400, detail="此文件未歸屬知識庫，不支援 Chunk 編輯")

    kb = db.get(KmKnowledgeBase, doc.knowledge_base_id)
    if not kb:
        raise HTTPException(status_code=404, detail="所屬知識庫不存在")

    if kb.scope == "personal":
        if kb.created_by != current.id:
            raise HTTPException(status_code=403, detail="只有知識庫建立者可以編輯內容")
    else:  # company
        if current.role not in ("admin", "super_admin", "manager"):
            raise HTTPException(status_code=403, detail="公司共用知識庫需要管理員權限才能編輯內容")

    return doc


def _get_chunk_and_check_kb_permission(
    chunk_id: int,
    current: User,
    db: Session,
) -> KmChunk:
    """取得 Chunk 並透過其父文件驗證 KB 編輯權限。"""
    chunk = db.get(KmChunk, chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail="Chunk 不存在")

    _get_doc_and_check_kb_permission(chunk.document_id, current, db)
    return chunk


@router.get("/documents/{doc_id}/chunks", response_model=list[KmChunkResponse])
def list_doc_chunks(
    doc_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出文件的所有 Chunks，依 chunk_index 排序。"""
    _get_doc_and_check_kb_permission(doc_id, current, db)
    chunks = (
        db.query(KmChunk)
        .filter(KmChunk.document_id == doc_id)
        .order_by(KmChunk.chunk_index)
        .all()
    )
    return chunks


def _build_content_tsv(content: str, doc_type: str, db: Session):
    """依文件類型建立 BM25 tsvector，僅 faq/spec 才建，其餘回傳 None。
    faq/spec 一律索引全文（Q+A），確保 tag 與答案術語也能被關鍵字搜到。
    """
    import sqlalchemy as sa
    BM25_DOC_TYPES = {"faq", "spec"}
    if doc_type not in BM25_DOC_TYPES:
        return None
    return db.execute(
        sa.text("SELECT to_tsvector('public.cjk', :t)"),
        {"t": content},
    ).scalar()


@router.patch("/chunks/{chunk_id}", response_model=KmChunkResponse)
def update_chunk(
    chunk_id: int,
    body: KmChunkUpdateBody,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新單一 Chunk 的內容，並重新產生 Embedding 與 BM25 tsvector。"""
    from app.services.km_service import _get_embed_params, embed_texts_sync

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="內容不可為空")

    chunk = _get_chunk_and_check_kb_permission(chunk_id, current, db)
    doc = db.get(KmDocument, chunk.document_id)
    doc_type = doc.doc_type if doc else "article"

    embed_params = _get_embed_params(db, current.tenant_id)
    if not embed_params:
        raise HTTPException(
            status_code=400,
            detail="未設定 Embedding Provider，無法重新產生 Embedding。",
        )
    embed_provider, embed_model, embed_key, embed_base = embed_params

    try:
        vectors, _ = embed_texts_sync(
            [content],
            model=embed_model,
            api_key=embed_key,
            provider=embed_provider,
            api_base=embed_base,
        )
    except Exception as e:
        logger.error("Chunk re-embed 失敗 chunk_id=%d: %s", chunk_id, e)
        raise HTTPException(status_code=500, detail=f"Embedding 失敗：{e}")

    chunk.content = content
    chunk.embedding = vectors[0]
    chunk.content_tsv = _build_content_tsv(content, doc_type, db)
    db.commit()
    db.refresh(chunk)
    return chunk


@router.delete("/chunks/{chunk_id}", status_code=204)
def delete_chunk(
    chunk_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除單一 Chunk，並更新父文件的 chunk_count。"""
    chunk = _get_chunk_and_check_kb_permission(chunk_id, current, db)
    doc = db.get(KmDocument, chunk.document_id)

    db.delete(chunk)
    if doc and doc.chunk_count is not None and doc.chunk_count > 0:
        doc.chunk_count -= 1
    db.commit()
    return None


@router.post("/documents/{doc_id}/chunks", response_model=KmChunkResponse, status_code=201)
def add_chunk(
    doc_id: int,
    body: KmChunkCreateBody,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """在文件末尾新增一個 Chunk，並產生 Embedding 與 BM25 tsvector。"""
    from app.services.km_service import _get_embed_params, embed_texts_sync

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="內容不可為空")

    doc = _get_doc_and_check_kb_permission(doc_id, current, db)
    doc_type = doc.doc_type

    embed_params = _get_embed_params(db, current.tenant_id)
    if not embed_params:
        raise HTTPException(
            status_code=400,
            detail="未設定 Embedding Provider，無法產生 Embedding。",
        )
    embed_provider, embed_model, embed_key, embed_base = embed_params

    try:
        vectors, _ = embed_texts_sync(
            [content],
            model=embed_model,
            api_key=embed_key,
            provider=embed_provider,
            api_base=embed_base,
        )
    except Exception as e:
        logger.error("新增 Chunk embed 失敗 doc_id=%d: %s", doc_id, e)
        raise HTTPException(status_code=500, detail=f"Embedding 失敗：{e}")

    max_index_row = (
        db.query(KmChunk.chunk_index)
        .filter(KmChunk.document_id == doc_id)
        .order_by(KmChunk.chunk_index.desc())
        .first()
    )
    next_index = (max_index_row[0] + 1) if max_index_row else 0

    new_chunk = KmChunk(
        document_id=doc_id,
        chunk_index=next_index,
        content=content,
        embedding=vectors[0],
        content_tsv=_build_content_tsv(content, doc_type, db),
    )
    db.add(new_chunk)

    doc.chunk_count = (doc.chunk_count or 0) + 1

    db.commit()
    db.refresh(new_chunk)
    return new_chunk
