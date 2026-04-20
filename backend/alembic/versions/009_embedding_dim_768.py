"""KM: resize embedding vector from 1536 to 768 (unified dim for Gemini/OpenAI/Local)

Revision ID: 009_embedding_dim_768
Revises: 008_km_doc_type
Create Date: 2026-04-20
"""
from alembic import op

revision = "009_embedding_dim_768"
down_revision = "008_km_doc_type"
branch_labels = None
depends_on = None


def upgrade():
    # 1. 清除所有 chunks（維度改變，舊向量不相容）
    op.execute("DELETE FROM km_chunks")

    # 2. 刪除舊 HNSW index（必須先刪才能改欄位型別）
    op.execute("DROP INDEX IF EXISTS km_chunks_embedding_hnsw")

    # 3. 改欄位維度
    op.execute("ALTER TABLE km_chunks ALTER COLUMN embedding TYPE vector(768)")

    # 4. 重建 HNSW index（768 維）
    op.execute(
        "CREATE INDEX km_chunks_embedding_hnsw ON km_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    # 5. km_documents 狀態重設為 pending，讓使用者知道需要重新上傳
    op.execute("UPDATE km_documents SET status = 'pending', error_message = "
               "'Embedding 維度已升級（768 維），請重新上傳文件以建立索引。' "
               "WHERE status = 'done'")


def downgrade():
    op.execute("DELETE FROM km_chunks")
    op.execute("DROP INDEX IF EXISTS km_chunks_embedding_hnsw")
    op.execute("ALTER TABLE km_chunks ALTER COLUMN embedding TYPE vector(1536)")
    op.execute(
        "CREATE INDEX km_chunks_embedding_hnsw ON km_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )
