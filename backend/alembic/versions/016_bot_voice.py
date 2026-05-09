"""add widget_voice_enabled/prompt to km_bots

Revision ID: 016_bot_voice
Revises: 015_kb_scope
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "016_bot_voice"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "km_bots",
        sa.Column("widget_voice_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "km_bots",
        sa.Column("widget_voice_prompt", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("km_bots", "widget_voice_prompt")
    op.drop_column("km_bots", "widget_voice_enabled")
