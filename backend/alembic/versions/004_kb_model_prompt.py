"""KM: add model_name + system_prompt to km_knowledge_bases

Revision ID: 004_kb_model_prompt
Revises: 003_km_knowledge_bases
Create Date: 2026-04-16
"""
import sqlalchemy as sa
from alembic import op

revision = "004_kb_model_prompt"
down_revision = "003_km_knowledge_bases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "km_knowledge_bases",
        sa.Column("model_name", sa.String(100), nullable=True),
    )
    op.add_column(
        "km_knowledge_bases",
        sa.Column("system_prompt", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("km_knowledge_bases", "system_prompt")
    op.drop_column("km_knowledge_bases", "model_name")
