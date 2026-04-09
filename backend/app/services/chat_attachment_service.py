"""Chat 訊息附加檔：允許格式、參考文字組裝、無引用時刪除 stored_files"""
from __future__ import annotations

import hashlib
import logging
from io import BytesIO
from uuid import UUID, uuid4

from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.chat_message import ChatMessage
from app.models.chat_message_attachment import ChatMessageAttachment
from app.models.notebook_source import NotebookSource
from app.models.stored_file import StoredFile
from app.services.stored_files_store import (
    absolute_blob_path,
    delete_blob_if_exists,
    get_stored_files_base_dir,
    storage_rel_path_for,
    write_blob,
)

logger = logging.getLogger(__name__)

# 純文字（與前端 CHAT_ATTACH_MAX_FILE_BYTES 對齊）
CHAT_ATTACH_MAX_BYTES = 30 * 1024
# PDF 二進位單檔上限（擷取後仍受 CHAT_AGENT_REFERENCE_MAX_CHARS 限制）
CHAT_ATTACH_PDF_MAX_BYTES = 4 * 1024 * 1024
# 圖片（與 settings.CHAT_INLINE_IMAGE_MAX_BYTES 對齊，供 persist 與驗證）
CHAT_ATTACHMENT_IMAGE_EXT = frozenset({".jpg", ".jpeg", ".png", ".webp", ".gif"})
CHAT_ATTACHMENT_EXT = frozenset(
    {".txt", ".md", ".csv", ".json", ".tsv", ".log", ".text", ".pdf", *CHAT_ATTACHMENT_IMAGE_EXT}
)


def _attachment_ext(name: str) -> str:
    i = name.rfind(".")
    return name[i:].lower() if i >= 0 else ""


def _is_pdf(filename: str, content_type: str | None) -> bool:
    if _attachment_ext(filename) == ".pdf":
        return True
    t = (content_type or "").lower()
    return t == "application/pdf"


def _is_image(filename: str, content_type: str | None) -> bool:
    ext = _attachment_ext(filename)
    if ext in CHAT_ATTACHMENT_IMAGE_EXT:
        return True
    t = (content_type or "").lower()
    return t in ("image/jpeg", "image/png", "image/webp", "image/gif")


def _max_upload_bytes(filename: str, content_type: str | None) -> int:
    if _is_pdf(filename, content_type):
        return CHAT_ATTACH_PDF_MAX_BYTES
    if _is_image(filename, content_type):
        return int(settings.CHAT_INLINE_IMAGE_MAX_BYTES)
    return CHAT_ATTACH_MAX_BYTES


def is_chat_attachment_allowed(filename: str, content_type: str | None) -> bool:
    ext = _attachment_ext(filename)
    t = (content_type or "").lower()
    if ext == ".pdf" or t == "application/pdf":
        return True
    if _is_image(filename, content_type):
        return True
    if ext in CHAT_ATTACHMENT_EXT:
        return True
    if t.startswith("text/"):
        return True
    if t in ("application/csv", "application/json"):
        return True
    if ext == "" and (not t or t == "application/octet-stream"):
        return True
    return False


def _extract_pdf_text(raw: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(raw), strict=False)
    except Exception as e:
        raise ValueError(
            "無法解析此 PDF（可能已加密或檔案損毀），請改用純文字或解密後再上傳。"
        ) from e

    if reader.is_encrypted:
        raise ValueError("PDF 已加密，請先解密再上傳。")

    max_pages = settings.CHAT_PDF_MAX_PAGES
    cap = settings.CHAT_PDF_EXTRACT_MAX_CHARS_PER_FILE
    chunks: list[str] = []
    total = 0
    truncated_pages = False
    for i, page in enumerate(reader.pages):
        if i >= max_pages:
            truncated_pages = True
            break
        try:
            page_text = (page.extract_text() or "").strip()
        except Exception:
            page_text = ""
        if not page_text:
            continue
        sep_len = 2 if chunks else 0
        if total + sep_len + len(page_text) > cap:
            room = cap - total - sep_len - 40
            if room > 0:
                chunks.append(page_text[:room].rstrip())
            chunks.append("…（單檔擷取字數已達上限，已截斷）")
            total = cap
            break
        chunks.append(page_text)
        total += len(page_text) + sep_len

    text = "\n\n".join(chunks).strip()
    suffix_parts: list[str] = []
    if truncated_pages:
        suffix_parts.append(f"…（僅擷取前 {max_pages} 頁，其餘略）")
    suffix = ("\n\n" + "\n".join(suffix_parts)) if suffix_parts else ""

    if not text:
        return (
            "（此 PDF 未擷取到可讀文字，常見於掃描圖檔；請使用純文字、可複製 PDF 或 OCR 後再上傳。）"
            + suffix
        )
    return text + suffix


def _decode_attachment_plaintext(filename: str, content_type: str | None, raw: bytes) -> str:
    if _is_pdf(filename, content_type):
        return _extract_pdf_text(raw)
    if _is_image(filename, content_type):
        return (
            f"（圖片檔「{filename}」已作為附件儲存並顯示於對話中；以下不包含像素／辨識內容。）"
        )
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


def cleanup_stored_file_if_unreferenced(db: Session, file_id: UUID) -> None:
    c1 = db.query(ChatMessageAttachment).filter(ChatMessageAttachment.file_id == file_id).count()
    c2 = db.query(NotebookSource).filter(NotebookSource.file_id == file_id).count()
    if c1 + c2 > 0:
        return
    row = db.query(StoredFile).filter(StoredFile.id == file_id, StoredFile.deleted_at.is_(None)).first()
    if not row:
        return
    try:
        delete_blob_if_exists(row.tenant_id, file_id)
    except OSError as e:
        logger.warning("delete blob failed file_id=%s: %s", file_id, e)
    db.delete(row)
    db.commit()


def collect_attachment_file_ids_for_thread(db: Session, thread_id: UUID) -> set[UUID]:
    rows = (
        db.query(ChatMessageAttachment.file_id)
        .join(ChatMessage, ChatMessage.id == ChatMessageAttachment.message_id)
        .filter(ChatMessage.thread_id == thread_id)
        .all()
    )
    return {r[0] for r in rows}


def build_attachment_reference_text(
    db: Session,
    *,
    message_id: UUID,
    max_chars: int | None = None,
) -> str:
    """組裝與 Chat Agent 相同區塊格式；超過 max_chars 則拋 ValueError。"""
    limit = max_chars if max_chars is not None else settings.CHAT_AGENT_REFERENCE_MAX_CHARS
    atts = (
        db.query(ChatMessageAttachment)
        .filter(ChatMessageAttachment.message_id == message_id)
        .order_by(ChatMessageAttachment.created_at.asc())
        .all()
    )
    if not atts:
        return ""
    parts: list[str] = []
    for a in atts:
        sf = db.query(StoredFile).filter(StoredFile.id == a.file_id).first()
        if not sf or sf.deleted_at is not None:
            continue
        if _is_image(sf.original_filename, sf.content_type):
            continue
        try:
            path = absolute_blob_path(sf.tenant_id, sf.id)
        except RuntimeError:
            continue
        if not path.is_file():
            continue
        raw = path.read_bytes()
        text = _decode_attachment_plaintext(sf.original_filename, sf.content_type, raw)
        block = f"=== 檔案：{sf.original_filename} ===\n{text}"
        parts.append(block)
    out = "\n\n".join(parts)
    if len(out) > limit:
        raise ValueError(f"附加檔合併後超過 {limit:,} 字元，請刪減檔案或縮短內容")
    return out


# 「啟用附件」後：自該則 user 起算，僅前 N 次 user 發言送 LLM 時帶同一組參考
ATTACHMENT_CONTEXT_USER_ROUNDS = 2  # 測試用；上線請改回 5


def _as_uuid(v: object) -> UUID:
    if isinstance(v, UUID):
        return v
    if isinstance(v, str):
        return UUID(v)
    raise TypeError(f"無法轉成 UUID：{type(v)!r}")


def file_ids_linked_to_thread(db: Session, thread_id: UUID, file_ids: list[UUID]) -> bool:
    """每個 file_id 須至少在本 thread 某則訊息上出現過（chat_message_attachments）。"""
    if not file_ids:
        return True
    for fid in file_ids:
        n = (
            db.query(ChatMessageAttachment)
            .join(ChatMessage, ChatMessage.id == ChatMessageAttachment.message_id)
            .filter(ChatMessage.thread_id == thread_id, ChatMessageAttachment.file_id == fid)
            .count()
        )
        if n == 0:
            return False
    return True


def build_reference_text_for_file_ids(
    db: Session,
    *,
    tenant_id: str,
    file_ids: list[UUID],
    max_chars: int | None = None,
) -> str:
    """依 file_id 列表組裝與單則訊息附件相同區塊格式；順序依 UUID 字串排序以穩定輸出。"""
    limit = max_chars if max_chars is not None else settings.CHAT_AGENT_REFERENCE_MAX_CHARS
    if not file_ids:
        return ""
    parts: list[str] = []
    for fid in sorted(file_ids, key=lambda u: str(u)):
        sf = db.query(StoredFile).filter(StoredFile.id == fid).first()
        if not sf or sf.deleted_at is not None:
            continue
        if sf.tenant_id != tenant_id:
            continue
        if _is_image(sf.original_filename, sf.content_type):
            continue
        try:
            path = absolute_blob_path(sf.tenant_id, sf.id)
        except RuntimeError:
            continue
        if not path.is_file():
            continue
        raw = path.read_bytes()
        text = _decode_attachment_plaintext(sf.original_filename, sf.content_type, raw)
        block = f"=== 檔案：{sf.original_filename} ===\n{text}"
        parts.append(block)
    out = "\n\n".join(parts)
    if len(out) > limit:
        raise ValueError(f"附加檔合併後超過 {limit:,} 字元，請刪減檔案或縮短內容")
    return out


def resolve_llm_attachment_window_reference_text(
    db: Session,
    *,
    thread_id: UUID,
    for_user_message_id: UUID,
    tenant_id: str,
    max_chars: int | None = None,
) -> str:
    """
    由 for_user_message_id（須為該 thread 之 user 訊息）往回找最近一則帶錨點之 user；
    若（含該錨點）至目前之 user 序次數 ≤ ATTACHMENT_CONTEXT_USER_ROUNDS，則回傳該錨點檔案之參考文字，否則空字串。
    """
    limit = max_chars if max_chars is not None else settings.CHAT_AGENT_REFERENCE_MAX_CHARS
    msg = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == for_user_message_id, ChatMessage.thread_id == thread_id)
        .first()
    )
    if not msg or (msg.role or "").strip().lower() != "user":
        return ""
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.sequence.asc(), ChatMessage.created_at.asc())
        .all()
    )
    user_msgs = [m for m in rows if (m.role or "").strip().lower() == "user"]
    try:
        idx_current = user_msgs.index(msg)
    except ValueError:
        return ""
    anchor_idx: int | None = None
    for i in range(idx_current, -1, -1):
        cf = user_msgs[i].context_file_ids
        if cf is not None:
            anchor_idx = i
            break
    if anchor_idx is None:
        return ""
    rounds = idx_current - anchor_idx + 1
    if rounds > ATTACHMENT_CONTEXT_USER_ROUNDS:
        return ""
    anchor = user_msgs[anchor_idx]
    raw_ids = anchor.context_file_ids
    if not raw_ids:
        return ""
    uuids: list[UUID] = []
    for x in raw_ids:
        try:
            uuids.append(_as_uuid(x))
        except (TypeError, ValueError):
            continue
    if not uuids:
        return ""
    if not file_ids_linked_to_thread(db, thread_id, uuids):
        raise ValueError("context_file_ids 含有不屬於本對話之檔案")
    return build_reference_text_for_file_ids(db, tenant_id=tenant_id, file_ids=uuids, max_chars=limit)


def persist_chat_uploads(
    db: Session,
    *,
    tenant_id: str,
    user_id: int,
    message_id: UUID,
    files: list[tuple[str, str | None, bytes]],
) -> list[StoredFile]:
    """
    files: (original_filename, content_type_or_none, body_bytes)
    先全部通過大小／型別檢查後再寫入磁碟 + stored_files + chat_message_attachments（會 flush）。
    """
    if get_stored_files_base_dir() is None:
        raise RuntimeError("STORED_FILES_DIR 未設定，無法儲存上傳檔")

    normalized: list[tuple[str, str | None, bytes]] = []
    for orig_name, ctype, body in files:
        name = (orig_name or "(未命名)").strip() or "(未命名)"
        lim = _max_upload_bytes(name, ctype)
        if len(body) > lim:
            raise ValueError("檔案過大，請節錄重點後再上傳。")
        if not is_chat_attachment_allowed(name, ctype):
            raise ValueError(
                f"不支援的檔案類型：{name}（僅限純文字、PDF 與圖片 jpeg/png/webp/gif）"
            )
        normalized.append((name, ctype, body))

    out: list[StoredFile] = []
    for name, ctype, body in normalized:
        fid = uuid4()
        digest = hashlib.sha256(body).hexdigest()
        row = StoredFile(
            id=fid,
            tenant_id=tenant_id,
            uploaded_by_user_id=user_id,
            storage_backend="local",
            storage_rel_path=storage_rel_path_for(tenant_id, fid),
            original_filename=name[:512],
            content_type=(ctype or None) if ctype else None,
            size_bytes=len(body),
            sha256_hex=digest,
        )
        write_blob(tenant_id, fid, body)
        db.add(row)
        db.flush()
        db.add(ChatMessageAttachment(message_id=message_id, file_id=fid))
        out.append(row)
    return out
