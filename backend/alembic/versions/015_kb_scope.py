"""add scope to km_knowledge_bases

Revision ID: 015
Revises: 014
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014_bot_widget_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "km_knowledge_bases",
        sa.Column("scope", sa.String(20), nullable=False, server_default="personal"),
    )


def downgrade() -> None:
    op.drop_column("km_knowledge_bases", "scope")
