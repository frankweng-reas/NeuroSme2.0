"""bot_rag_service.py

KB Bot 共用 RAG 業務邏輯。
三條查詢路徑（測試 Chat / Widget / API Key）均呼叫此模組，確保行為一致：
  - RAG 多 KB 檢索
  - System prompt 組裝（Bot 自訂 > 預設 cs.md）
  - Messages 組裝（history + user question）
  - [NOT_FOUND] → fallback message 替換
  - hit 判定
"""

import logging
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class _DetachedChunk:
    """KmChunk 的純 Python 快照，脫離 SQLAlchemy session，可安全跨 async 邊界使用。
    介面與 KmChunk 相容（.id / .content / .document.filename），
    確保 km_faq_llm_select、extract_faq_question/answer 等不需修改即可使用。
    """
    class _Doc:
        def __init__(self, filename: str):
            self.filename = filename

    def __init__(self, chunk) -> None:
        self.id = chunk.id
        self.content = chunk.content
        fname = chunk.document.filename if chunk.document else "未知文件"
        self.document = self._Doc(fname)

# 每輪對話 = user + assistant，保留 N 輪
_DEFAULT_MAX_HISTORY_TURNS = 10


@dataclass
class BotRagContext:
    """prepare_bot_rag_messages() 的回傳值，供各 endpoint 直接使用。"""
    messages: list[dict]                    # 組裝完畢，可直接送 LLM
    sources: list[dict]                     # [{"filename": ..., "excerpt": ...}]
    context_chunk_ids: list[str]            # RAG 命中的 chunk UUID，用於 hit 判定
    model: str                              # 解析後的模型名稱（可能為空字串）
    # 以下備用，供呼叫端需要時取用
    rag_context_text: str = ""
    system_prompt_used: str | None = None   # 實際帶進 LLM 的 system prompt（除 RAG context 外）
    is_faq_direct: bool = False             # Bot 含 direct KB，走精準問答流程
    faq_candidates: list | None = None      # direct 模式候選 [(KmChunk, float), ...]，由呼叫端 await km_faq_llm_select


def prepare_bot_rag_messages(
    bot,                          # app.models.bot.Bot
    question: str,
    history: list[dict],          # [{"role": "user"|"assistant", "content": "..."}]
    db: Session,
    tenant_id: str,
    *,
    user_id: int = 0,
    skip_scope_check: bool = True,
    agent_id: str = "kb-bot-builder",
    max_history_turns: int = _DEFAULT_MAX_HISTORY_TURNS,
    show_source_in_context: bool = True,  # False → widget 不顯示來源標注
) -> BotRagContext:
    """
    共用：Bot RAG 多 KB 檢索 + system prompt 組裝 + messages 準備。

    呼叫端只需負責：認證、串流/非串流、session logging 等各自差異的部分。
    """
    from app.models.bot import BotKnowledgeBase
    from app.services.chat_service import _load_system_prompt_from_file
    from app.services.km_service import (
        format_km_context,
        km_faq_retrieve_sync,
        km_retrieve_sync,
    )

    # ── 1. 取得 Bot 關聯的所有 KB id ─────────────────────────────────────────
    kb_rows = (
        db.query(BotKnowledgeBase)
        .filter(BotKnowledgeBase.bot_id == bot.id)
        .order_by(BotKnowledgeBase.sort_order)
        .all()
    )
    all_kb_ids: list[int] = [row.knowledge_base_id for row in kb_rows]

    # Bot 層級的 answer_mode 決定整體流程
    bot_mode = (bot.answer_mode or "rag").strip()
    is_direct = bot_mode == "direct"

    # ── 2a. 精準 FAQ 檢索（bot.answer_mode == "direct"）──────────────────────
    faq_candidates: list = []   # list[tuple[_DetachedChunk, float]]
    if is_direct and all_kb_ids:
        for kb_id in all_kb_ids:
            try:
                results = km_faq_retrieve_sync(
                    question, db, tenant_id, user_id, knowledge_base_id=kb_id, top_k=3,
                )
                faq_candidates.extend(results)
            except Exception as exc:
                logger.warning("Bot FAQ 檢索失敗 (kb_id=%s): %s", kb_id, exc)
        # 依 RRF 分數降序，取 top 3
        faq_candidates.sort(key=lambda t: t[1], reverse=True)
        faq_candidates = faq_candidates[:3]
        # 轉成純 Python 快照，脫離 session，可安全跨 async 邊界
        faq_candidates = [(_DetachedChunk(c), score) for c, score in faq_candidates]

    # ── 2b. 一般 RAG 檢索（bot.answer_mode == "rag"）──────────────────────────
    all_chunks: list = []
    if not is_direct and all_kb_ids:
        try:
            chunks = km_retrieve_sync(
                question,
                db,
                tenant_id,
                user_id=user_id,
                knowledge_base_ids=all_kb_ids,
                skip_scope_check=skip_scope_check,
                agent_id=agent_id,
            )
            all_chunks = chunks or []
        except Exception as exc:
            logger.warning("Bot RAG 檢索失敗，略過參考資料 (bot_id=%s): %s", bot.id, exc)
    all_chunks.sort(key=lambda c: getattr(c, "score", 0), reverse=True)
    all_chunks = all_chunks[:12]

    # ── 3. chunk IDs ──────────────────────────────────────────────────────────
    if is_direct:
        context_chunk_ids = [str(t[0].id) for t in faq_candidates]
    else:
        context_chunk_ids = [str(c.id) for c in all_chunks]

    rag_context = format_km_context(all_chunks, show_source=show_source_in_context)
    logger.debug(
        "bot_rag: mode=%s, %d chunks, %d faq_candidates (bot_id=%s, agent_id=%s)",
        bot_mode, len(all_chunks), len(faq_candidates), bot.id, agent_id,
    )

    # ── 4. 組裝 sources ────────────────────────────────────────────────────────
    sources: list[dict] = []
    seen_files: set[str] = set()
    for chunk, _ in (faq_candidates or []):
        fname = chunk.document.filename if chunk.document else "未知文件"
        if fname not in seen_files:
            seen_files.add(fname)
            sources.append({"filename": fname, "excerpt": chunk.content.strip()[:200]})
    for chunk in all_chunks:
        fname = chunk.document.filename if chunk.document else "未知文件"
        if fname not in seen_files:
            seen_files.add(fname)
            sources.append({"filename": fname, "excerpt": chunk.content.strip()[:200]})

    # ── 5. 組裝 system prompt ──────────────────────────────────────────────────
    system_parts: list[str] = []

    # 5a. 固定層：行為約束（永遠生效）
    base_prompt = _load_system_prompt_from_file("bot_base")
    if base_prompt:
        system_parts.append(base_prompt)

    # 5b. 用戶自訂層：角色定義、語氣、業務規則（選填）
    bot_system = (bot.system_prompt or "").strip()
    if bot_system:
        system_parts.append(bot_system)

    if rag_context.strip():
        system_parts.append(f"以下為參考資料：\n\n{rag_context.strip()}")

    system_content = "\n\n".join(system_parts) if system_parts else None

    # ── 6. 組裝 messages ───────────────────────────────────────────────────────
    messages: list[dict] = []
    if system_content:
        messages.append({"role": "system", "content": system_content})

    trimmed = history[-(max_history_turns * 2):]
    messages.extend(trimmed)
    messages.append({"role": "user", "content": question})

    # ── 7. 解析模型 ────────────────────────────────────────────────────────────
    model = (bot.model_name or "").strip()

    return BotRagContext(
        messages=messages,
        sources=sources,
        context_chunk_ids=context_chunk_ids,
        model=model,
        rag_context_text=rag_context,
        system_prompt_used=bot_system or None,
        is_faq_direct=is_direct,
        faq_candidates=faq_candidates if is_direct else None,
    )


def apply_bot_fallback(raw_answer: str | None, bot) -> str:
    """
    [NOT_FOUND] 處理：
      - fallback 已啟用且有內容 → 回傳 bot.fallback_message
      - 否則 → 回傳預設客服說明文字
    """
    from app.api.endpoints.chat import _clean_rag_response
    return _clean_rag_response(
        raw_answer,
        "cs",
        fallback_message=bot.fallback_message,
        fallback_message_enabled=bot.fallback_message_enabled or False,
    )


def rag_hit(raw_answer: str | None, context_chunk_ids: list[str]) -> bool:
    """判斷此次查詢是否命中（複用 chat.py 的 _rag_hit_from_response）。"""
    from app.api.endpoints.chat import _rag_hit_from_response
    return _rag_hit_from_response(raw_answer, context_chunk_ids)
