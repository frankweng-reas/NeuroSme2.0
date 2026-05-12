"""add label to api_keys; allow multiple active keys per bot

Revision ID: 025_api_key_label
Revises: 024_bot_fallback_message
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa

revision = '025_api_key_label'
down_revision = '024'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'api_keys',
        sa.Column('label', sa.String(100), nullable=True),
    )


def downgrade():
    op.drop_column('api_keys', 'label')
