"""KM: pgvector extension + km_documents + km_chunks

Revision ID: 001_km_tables
Revises: 000_initial
Create Date: 2026-04-16
"""
import sqlalchemy as sa
from alembic import op

revision = "001_km_tables"
down_revision = "initial001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "km_documents",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "owner_user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger, nullable=True),
        # 'private'：owner_user_id 所有者可見；'public'：整個 tenant 可見（admin 上傳）
        sa.Column("scope", sa.String(32), nullable=False, server_default="private"),
        # 'pending' → 'processing' → 'ready' | 'error'
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("chunk_count", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "km_chunks",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "document_id",
            sa.Integer,
            sa.ForeignKey("km_documents.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        # vector(1536) 使用 pgvector extension，不能用一般 SQLAlchemy 型別，用 raw SQL 補加
        sa.Column("metadata", sa.JSON, nullable=True),
    )

    # 用 raw SQL 新增 vector 欄位（須已啟用 pgvector extension）
    op.execute("ALTER TABLE km_chunks ADD COLUMN embedding vector(1536)")

    # HNSW index for fast cosine similarity search
    op.execute(
        "CREATE INDEX km_chunks_embedding_hnsw ON km_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.drop_table("km_chunks")
    op.drop_table("km_documents")
