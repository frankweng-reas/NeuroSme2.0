"""api_key add bot_id

Revision ID: 017
Revises: 016
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = '017_api_key_bot'
down_revision = '016_bot_voice'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('api_keys', sa.Column(
        'bot_id', sa.Integer(),
        sa.ForeignKey('km_bots.id', ondelete='SET NULL'),
        nullable=True,
    ))
    op.create_index('ix_api_keys_bot_id', 'api_keys', ['bot_id'])


def downgrade():
    op.drop_index('ix_api_keys_bot_id', 'api_keys')
    op.drop_column('api_keys', 'bot_id')
