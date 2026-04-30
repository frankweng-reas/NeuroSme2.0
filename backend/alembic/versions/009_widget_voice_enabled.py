"""Add widget_voice_enabled to km_knowledge_bases.

Revision ID: 009_widget_voice_enabled
Revises: 008_nullable_embedding
Create Date: 2026-04-30
"""
import sqlalchemy as sa
from alembic import op

revision = '009_widget_voice_enabled'
down_revision = '008_nullable_embedding'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'km_knowledge_bases',
        sa.Column('widget_voice_enabled', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('km_knowledge_bases', 'widget_voice_enabled')
