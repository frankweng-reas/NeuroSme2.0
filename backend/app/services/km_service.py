"""KM 服務：文字擷取、Chunking、Embedding、向量檢索

設計：
  - 使用 pgvector 做向量搜尋（cosine similarity）
  - Embedding model：自動依 tenant 已設定的 provider 選擇（Gemini > OpenAI > Local）
    - Gemini  → text-embedding-004        (768 維)
    - OpenAI  → text-embedding-3-small    (768 維，指定 dimensions)
    - Local   → ollama/nomic-embed-text   (768 維)
  - 支援 PDF（pypdf）、純文字/Markdown（UTF-8）
  - chunk_size=1500 字元，overlap=200 字元
"""
import io
import logging

import litellm
from sqlalchemy.orm import Session

from app.models.km_chunk import KmChunk
from app.models.km_document import KmDocument
from app.models.llm_provider_config import LLMProviderConfig
from app.services.llm_service import _get_llm_params
from app.core.encryption import decrypt_api_key

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 768
CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200

# Embedding model 對應各 provider
_EMBED_MODELS = {
    "gemini": "gemini/text-embedding-004",
    "openai": "text-embedding-3-small",
    "local":  "ollama/nomic-embed-text",
}

# 各文件類型的 chunking 策略與檢索 top_k
# chunk_size 越小 → top_k 越大（總 context 字元數約 3000–6000）
CHUNK_STRATEGIES: dict[str, dict] = {
    "faq":     {"chunk_size": 300,  "overlap": 50,  "top_k": 12},
    "spec":    {"chunk_size": 400,  "overlap": 50,  "top_k": 10},
    "policy":  {"chunk_size": 800,  "overlap": 150, "top_k": 6},
    "article": {"chunk_size": 1500, "overlap": 200, "top_k": 4},
}
DOC_TYPES = frozenset(CHUNK_STRATEGIES.keys())


def _strategy(doc_type: str) -> dict:
    """取得文件類型對應策略，未知類型 fallback 到 article。"""
    return CHUNK_STRATEGIES.get(doc_type, CHUNK_STRATEGIES["article"])


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

import re as _re


def _chunk_sliding(text: str, chunk_size: int, overlap: int) -> list[str]:
    """滑動視窗切分（基礎實作）。"""
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


def _chunk_faq(text: str) -> list[str]:
    """FAQ 專用切割：每個 Q&A 對成一個 chunk。

    三層 fallback：
      1a. 偵測明確的 Q&A pattern（Q:/A:, 問:/答:, 數字編號）
      1b. 偵測 ●/○ bullet 格式（問題=●, 答案=○ 縮排）
      2.  按雙換行段落切
      3.  fallback：滑動視窗（chunk_size=300）
    """
    # Layer 1a：Q&A 前綴 pattern（Q:, 問:, 1. 等）
    qa_pattern = _re.compile(
        r'(?:^|\n)(?=\s*(?:Q[：:】]|問[：:]|\d+[.、)）]\s))',
        _re.MULTILINE,
    )
    parts = [p.strip() for p in qa_pattern.split(text) if p.strip()]
    if len(parts) >= 2:
        logger.debug("FAQ chunking：Q&A pattern，%d 對", len(parts))
        return parts

    # Layer 1b：● 問題 / ○ 答案 的 bullet 格式
    # 以 ● 作為 chunk 邊界，每個 ● 問題 + 其後的 ○ 答案 = 一個 chunk
    bullet_pattern = _re.compile(r'(?:^|\n)(?=\s*[●•]\s)', _re.MULTILINE)
    bullet_parts = [p.strip() for p in bullet_pattern.split(text) if p.strip()]
    if len(bullet_parts) >= 2:
        logger.debug("FAQ chunking：● bullet 格式，%d 對", len(bullet_parts))
        return bullet_parts

    # Layer 2：按段落切（雙換行）
    paragraphs = [p.strip() for p in _re.split(r'\n{2,}', text) if p.strip()]
    if len(paragraphs) >= 2:
        logger.debug("FAQ chunking：段落模式，%d 段", len(paragraphs))
        return paragraphs

    # Layer 3：滑動視窗 fallback
    logger.debug("FAQ chunking：fallback 滑動視窗")
    return _chunk_sliding(text, chunk_size=300, overlap=50)


def chunk_text(
    text: str,
    doc_type: str = "article",
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> list[str]:
    """文件切分入口：依 doc_type 選擇切分策略。
    - faq：Q&A 感知切割（每對獨立 chunk）
    - 其他：依 CHUNK_STRATEGIES 的 chunk_size/overlap 滑動視窗
    """
    text = text.strip()
    if not text:
        return []

    if doc_type == "faq":
        return _chunk_faq(text)

    s = _strategy(doc_type)
    size = chunk_size if chunk_size is not None else s["chunk_size"]
    ov = overlap if overlap is not None else s["overlap"]
    return _chunk_sliding(text, chunk_size=size, overlap=ov)


# ──────────────────────────────────────────────────────────────────────────────
# Embedding
# ──────────────────────────────────────────────────────────────────────────────


def _get_embed_params(db: Session, tenant_id: str) -> tuple[str, str | None, str | None] | None:
    """
    自動偵測 tenant 已設定的 provider，依優先順序回傳 (model, api_key, api_base)。
    優先順序：Gemini > OpenAI > Local
    找不到任何設定時回傳 None。
    """
    def _db_cfg(provider: str):
        return (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == tenant_id,
                LLMProviderConfig.provider == provider,
                LLMProviderConfig.is_active.is_(True),
            )
            .order_by(LLMProviderConfig.id)
            .first()
        )

    def _key(cfg) -> str | None:
        if not cfg or not cfg.api_key_encrypted:
            return None
        try:
            return decrypt_api_key(cfg.api_key_encrypted)
        except ValueError:
            return None

    for provider in ("gemini", "openai", "local"):
        cfg = _db_cfg(provider)
        if not cfg:
            continue
        key = _key(cfg)
        model = _EMBED_MODELS[provider]
        if provider == "local":
            # Local 不需要 API key，用 placeholder；api_base 從設定取
            return model, key or "local", cfg.api_base_url or None
        if key:
            return model, key, None

    return None


def embed_texts_sync(texts: list[str], model: str, api_key: str, api_base: str | None = None) -> list[list[float]]:
    """同步呼叫 LiteLLM embedding，回傳向量清單。"""
    kwargs: dict = dict(model=model, input=texts, api_key=api_key)
    if api_base:
        kwargs["api_base"] = api_base
    # OpenAI text-embedding-3-small 支援指定輸出維度（MRL），統一輸出 768
    if model == "text-embedding-3-small":
        kwargs["dimensions"] = EMBEDDING_DIM
    response = litellm.embedding(**kwargs)
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
    doc_type: str = "article",
) -> None:
    """完整管線：文字擷取 → 切分 → Embedding → 寫入 km_chunks。
    同步執行（於上傳請求中直接處理，適合初期小量文件場景）。
    doc_type 決定 chunk_size / overlap（見 CHUNK_STRATEGIES）。
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

        # 2. 依文件類型切分 chunks
        chunks = chunk_text(text, doc_type=doc_type)
        if not chunks:
            doc.status = "error"
            doc.error_message = "文字切分失敗"
            db.commit()
            return

        # 3. 自動偵測 Embedding provider（Gemini > OpenAI > Local）
        embed_params = _get_embed_params(db, tenant_id)
        if not embed_params:
            doc.status = "error"
            doc.error_message = "未設定任何 LLM Provider，無法產生 Embedding。請在管理介面設定 Gemini、OpenAI 或 Local provider。"
            db.commit()
            return
        embed_model, embed_key, embed_base = embed_params
        logger.info("KM embed 使用 model=%s (doc_id=%d)", embed_model, doc_id)

        # 4. 批次 Embedding（每批 100 筆）
        all_embeddings: list[list[float]] = []
        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            embeddings = embed_texts_sync(batch, model=embed_model, api_key=embed_key, api_base=embed_base)
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
    user_id: int = 0,
    top_k: int | None = None,
    selected_doc_ids: list[int] | None = None,
    knowledge_base_id: int | None = None,
    skip_scope_check: bool = False,
) -> list[KmChunk]:
    """同步向量檢索：query → embedding → cosine similarity 找 top-K chunks。

    top_k：若未指定，依 KB 內文件的 doc_type 自動決定（取最大 top_k 以保守覆蓋）。
    存取範圍：
      - scope='public'（任何 tenant 使用者可見）
      - scope='private' 且 owner_user_id = user_id（個人私有）
    若提供 knowledge_base_id，只在該知識庫的文件中搜尋。
    若提供 selected_doc_ids（非空），則只在指定文件中搜尋。
    skip_scope_check=True：跳過 scope/owner 過濾（Widget 公開存取用）。
    """
    embed_params = _get_embed_params(db, tenant_id)
    if not embed_params:
        logger.warning("KM 檢索失敗：tenant_id=%s 無可用 Embedding provider", tenant_id)
        return []
    embed_model, embed_key, embed_base = embed_params

    # 動態決定 top_k：依 KB 內文件類型取最大值（混合類型保守取多）
    if top_k is None:
        try:
            q_types = db.query(KmDocument.doc_type).filter(
                KmDocument.tenant_id == tenant_id,
                KmDocument.status == "ready",
            )
            if knowledge_base_id is not None:
                q_types = q_types.filter(KmDocument.knowledge_base_id == knowledge_base_id)
            elif selected_doc_ids:
                q_types = q_types.filter(KmDocument.id.in_(selected_doc_ids))
            doc_types = [row[0] for row in q_types.distinct().all()]
            top_k = max(
                (_strategy(dt)["top_k"] for dt in doc_types),
                default=8,
            )
        except Exception:
            top_k = 8
        logger.debug("km_retrieve top_k=%d (doc_types=%s)", top_k, doc_types if doc_types else "unknown")

    try:
        embeddings = embed_texts_sync([query], model=embed_model, api_key=embed_key, api_base=embed_base)
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
            )
        )
        if not skip_scope_check:
            q = q.filter(
                (KmDocument.scope == "public") | (KmDocument.owner_user_id == user_id)
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


def format_km_context(chunks: list[KmChunk], show_source: bool = True) -> str:
    """將 retrieved chunks 格式化為 system prompt 的參考資料字串。"""
    if not chunks:
        return ""

    parts: list[str] = []
    for chunk in chunks:
        if show_source:
            doc_name = chunk.document.filename if chunk.document else "未知文件"
            parts.append(f"--- 來源：{doc_name} ---\n{chunk.content.strip()}")
        else:
            parts.append(chunk.content.strip())

    return "\n\n".join(parts)
