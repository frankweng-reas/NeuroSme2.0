"""KM: add km_knowledge_bases table + knowledge_base_id to km_documents

Revision ID: 003_km_knowledge_bases
Revises: 002_km_tags
Create Date: 2026-04-16
"""
import sqlalchemy as sa
from alembic import op

revision = "003_km_knowledge_bases"
down_revision = "002_km_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "km_knowledge_bases",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String, nullable=False, index=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.add_column(
        "km_documents",
        sa.Column(
            "knowledge_base_id",
            sa.Integer,
            sa.ForeignKey("km_knowledge_bases.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("km_documents", "knowledge_base_id")
    op.drop_table("km_knowledge_bases")
