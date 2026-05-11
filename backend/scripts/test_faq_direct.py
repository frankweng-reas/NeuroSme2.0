"""
FAQ Direct 模式測試：同步呼叫 km_faq_retrieve_sync，印出候選與 similarity
（不含 LLM 選取，LLM 那段需要 async；此腳本驗證候選召回品質）

Usage:
    cd /home/frank_weng/NeuroSme2.0/backend
    python scripts/test_faq_direct.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.core.database import SessionLocal
from app.models.km_knowledge_base import KmKnowledgeBase
from app.services.km_service import (
    km_faq_retrieve_sync,
    FAQ_TOP_K,
    extract_faq_question,
    extract_faq_answer,
)

KB_ID = 19  # FAQ精準回答知識庫

QUERIES = [
    # 應該要找到
    "youbike站點",
    "捷運尖峰載客率",
    "自行車道長度",
    "停車位數量",
    "行人友善路口",
    # 應該找不到
    "今天天氣",
    "如何煮泡麵",
    "台北101高度",
]

def main():
    db = SessionLocal()
    try:
        kb = db.query(KmKnowledgeBase).filter(KmKnowledgeBase.id == KB_ID).first()
        if not kb:
            print(f"找不到 KB id={KB_ID}")
            return
        print(f"KB: {kb.name!r}  answer_mode={kb.answer_mode}\n")
        print("=" * 70)

        # 取得 tenant_id / user_id
        from app.models.user import User
        user = db.query(User).first()
        tenant_id = user.tenant_id if user else "default"
        user_id = user.id if user else 1

        for query in QUERIES:
            print(f"\n🔍 Query: {query!r}")
            results = km_faq_retrieve_sync(
                query, db, tenant_id, user_id, KB_ID, top_k=FAQ_TOP_K
            )
            if not results:
                print("   → 找不到（候選為空）")
            else:
                for i, (chunk, sim) in enumerate(results, 1):
                    q = extract_faq_question(chunk.content)
                    a = extract_faq_answer(chunk.content)
                    a_preview = a[:80].replace("\n", " ") + ("…" if len(a) > 80 else "")
                    print(f"   [{i}] sim={sim:.4f}  Q: {q}")
                    print(f"        A: {a_preview}")
        print("\n" + "=" * 70)
    finally:
        db.close()

if __name__ == "__main__":
    main()
