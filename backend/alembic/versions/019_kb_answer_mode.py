"""add answer_mode to km_knowledge_bases

Revision ID: 019_kb_answer_mode
Revises: 018_api_key_type
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa

revision = '019_kb_answer_mode'
down_revision = '018_api_key_type'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'km_knowledge_bases',
        sa.Column('answer_mode', sa.String(20), nullable=False, server_default='rag'),
    )


def downgrade() -> None:
    op.drop_column('km_knowledge_bases', 'answer_mode')
