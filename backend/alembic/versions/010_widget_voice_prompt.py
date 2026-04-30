"""Add widget_voice_prompt to km_knowledge_bases.

Revision ID: 010_widget_voice_prompt
Revises: 009_widget_voice_enabled
Create Date: 2026-04-30
"""
import sqlalchemy as sa
from alembic import op

revision = '010_widget_voice_prompt'
down_revision = '009_widget_voice_enabled'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'km_knowledge_bases',
        sa.Column('widget_voice_prompt', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('km_knowledge_bases', 'widget_voice_prompt')
