"""024_bot_fallback_message

Revision ID: 024
Revises: 023
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa

revision = '024'
down_revision = '023'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'km_bots',
        sa.Column('fallback_message', sa.Text(), nullable=True),
    )
    op.add_column(
        'km_bots',
        sa.Column('fallback_message_enabled', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade():
    op.drop_column('km_bots', 'fallback_message_enabled')
    op.drop_column('km_bots', 'fallback_message')
