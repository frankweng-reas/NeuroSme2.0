"""add key_type to api_keys

Revision ID: 018_api_key_type
Revises: 017_api_key_bot
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = '018_api_key_type'
down_revision = '017_api_key_bot'
branch_labels = None
depends_on = None


def upgrade():
    # 加 key_type 欄位，預設 'bot' 以保持向下相容（現有 key 皆為 bot 用途）
    op.add_column(
        'api_keys',
        sa.Column('key_type', sa.String(20), nullable=False, server_default='bot'),
    )


def downgrade():
    op.drop_column('api_keys', 'key_type')
