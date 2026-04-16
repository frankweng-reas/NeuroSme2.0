"""KM 服務：文字擷取、Chunking、Embedding、向量檢索

設計：
  - 使用 pgvector 做向量搜尋（cosine similarity）
  - Embedding model：text-embedding-3-small (dim=1536)，透過租戶 OpenAI API Key
  - 支援 PDF（pypdf）、純文字/Markdown（UTF-8）
  - chunk_size=1500 字元，overlap=200 字元
"""
import io
import logging

import litellm
from sqlalchemy.orm import Session

from app.models.km_chunk import KmChunk
from app.models.km_document import KmDocument
from app.services.llm_service import _get_llm_params

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200


# ──────────────────────────────────────────────────────────────────────────────
# 文字擷取
# ──────────────────────────────────────────────────────────────────────────────


def extract_text(file_bytes: bytes, content_type: str | None, filename: str) -> str:
    """從 PDF 或文字檔擷取純文字。"""
    ct = (content_type or "").lower()
    name = (filename or "").lower()

    if "pdf" in ct or name.endswith(".pdf"):
        return _extract_pdf(file_bytes)

    # 圖片：暫不支援 OCR，回傳空字串讓上層處理
    if ct.startswith("image/") or any(name.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp")):
        return ""

    # 純文字 / Markdown
    try:
        return file_bytes.decode("utf-8").strip()
    except UnicodeDecodeError:
        return file_bytes.decode("latin-1", errors="replace").strip()


def _extract_pdf(file_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore[import-untyped]

        reader = PdfReader(io.BytesIO(file_bytes))
        parts: list[str] = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                parts.append(text.strip())
        return "\n\n".join(parts)
    except Exception as e:
        logger.warning("PDF 擷取失敗: %s", e)
        return ""


# ──────────────────────────────────────────────────────────────────────────────
# Chunking
# ──────────────────────────────────────────────────────────────────────────────


def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    """以字元為單位切分文字（滑動視窗，有重疊）。"""
    text = text.strip()
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = end - overlap

    return chunks


# ──────────────────────────────────────────────────────────────────────────────
# Embedding
# ──────────────────────────────────────────────────────────────────────────────


def _get_embed_api_key(db: Session, tenant_id: str) -> str | None:
    """取得租戶的 OpenAI API Key 用於 Embedding。"""
    _, api_key, _ = _get_llm_params(EMBEDDING_MODEL, db=db, tenant_id=tenant_id)
    return api_key


def embed_texts_sync(texts: list[str], api_key: str) -> list[list[float]]:
    """同步呼叫 LiteLLM embedding，回傳向量清單。"""
    response = litellm.embedding(
        model=EMBEDDING_MODEL,
        input=texts,
        api_key=api_key,
    )
    return [item["embedding"] for item in response.data]


# ──────────────────────────────────────────────────────────────────────────────
# 文件處理管線
# ──────────────────────────────────────────────────────────────────────────────


def process_document(
    doc_id: int,
    file_bytes: bytes,
    content_type: str | None,
    filename: str,
    db: Session,
    tenant_id: str,
) -> None:
    """完整管線：文字擷取 → 切分 → Embedding → 寫入 km_chunks。
    同步執行（於上傳請求中直接處理，適合初期小量文件場景）。
    """
    doc = db.get(KmDocument, doc_id)
    if not doc:
        return

    try:
        doc.status = "processing"
        db.commit()

        # 1. 擷取文字
        text = extract_text(file_bytes, content_type, filename)
        if not text.strip():
            doc.status = "error"
            doc.error_message = "無法從檔案擷取文字內容（PDF 可能加密，或為純圖片 PDF）"
            db.commit()
            return

        # 2. 切分 chunks
        chunks = chunk_text(text)
        if not chunks:
            doc.status = "error"
            doc.error_message = "文字切分失敗"
            db.commit()
            return

        # 3. 取得 Embedding key
        api_key = _get_embed_api_key(db, tenant_id)
        if not api_key:
            doc.status = "error"
            doc.error_message = "未設定 OpenAI API Key，無法產生 Embedding。請在管理介面設定 openai provider。"
            db.commit()
            return

        # 4. 批次 Embedding（每批 100 筆）
        all_embeddings: list[list[float]] = []
        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            embeddings = embed_texts_sync(batch, api_key)
            all_embeddings.extend(embeddings)

        # 5. 寫入 km_chunks
        for idx, (chunk_content, embedding) in enumerate(zip(chunks, all_embeddings)):
            km_chunk = KmChunk(
                document_id=doc_id,
                chunk_index=idx,
                content=chunk_content,
                embedding=embedding,
                metadata_={"filename": filename, "chunk_index": idx},
            )
            db.add(km_chunk)

        doc.status = "ready"
        doc.chunk_count = len(chunks)
        db.commit()

        logger.info(
            "KM 文件 id=%d 處理完成：%d chunks，檔名=%s",
            doc_id,
            len(chunks),
            filename,
        )

    except Exception as e:
        logger.exception("KM 文件 id=%d 處理失敗", doc_id)
        try:
            doc.status = "error"
            doc.error_message = str(e)[:1000]
            db.commit()
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────────────
# 向量檢索
# ──────────────────────────────────────────────────────────────────────────────


def km_retrieve_sync(
    query: str,
    db: Session,
    tenant_id: str,
    user_id: int,
    top_k: int = 8,
    selected_doc_ids: list[int] | None = None,
    knowledge_base_id: int | None = None,
) -> list[KmChunk]:
    """同步向量檢索：query → embedding → cosine similarity 找 top-K chunks。

    存取範圍：
      - scope='public'（任何 tenant 使用者可見）
      - scope='private' 且 owner_user_id = user_id（個人私有）
    若提供 knowledge_base_id，只在該知識庫的文件中搜尋。
    若提供 selected_doc_ids（非空），則只在指定文件中搜尋。
    """
    api_key = _get_embed_api_key(db, tenant_id)
    if not api_key:
        logger.warning("KM 檢索失敗：tenant_id=%s 無 OpenAI API Key", tenant_id)
        return []

    try:
        embeddings = embed_texts_sync([query], api_key)
        query_embedding = embeddings[0]
    except Exception as e:
        logger.warning("KM embedding 失敗: %s", e)
        return []

    try:
        q = (
            db.query(KmChunk)
            .join(KmDocument, KmChunk.document_id == KmDocument.id)
            .filter(
                KmDocument.tenant_id == tenant_id,
                KmDocument.status == "ready",
                (
                    (KmDocument.scope == "public")
                    | (KmDocument.owner_user_id == user_id)
                ),
            )
        )
        if knowledge_base_id is not None:
            q = q.filter(KmDocument.knowledge_base_id == knowledge_base_id)
        elif selected_doc_ids:
            q = q.filter(KmDocument.id.in_(selected_doc_ids))
        results = (
            q.order_by(KmChunk.embedding.cosine_distance(query_embedding))
            .limit(top_k)
            .all()
        )
        return results
    except Exception as e:
        logger.exception("KM 向量搜尋失敗: %s", e)
        return []


def format_km_context(chunks: list[KmChunk]) -> str:
    """將 retrieved chunks 格式化為 system prompt 的參考資料字串。"""
    if not chunks:
        return ""

    parts: list[str] = []
    for chunk in chunks:
        doc_name = chunk.document.filename if chunk.document else "未知文件"
        parts.append(f"--- 來源：{doc_name} ---\n{chunk.content.strip()}")

    return "\n\n".join(parts)
