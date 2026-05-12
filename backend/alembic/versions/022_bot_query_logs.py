"""add bot_query_logs table

Revision ID: 022
Revises: 021
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '022'
down_revision = '021'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'bot_query_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column('tenant_id', sa.String(100),
                  sa.ForeignKey('tenants.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('bot_id', sa.Integer,
                  sa.ForeignKey('km_bots.id', ondelete='CASCADE'), nullable=False),
        sa.Column('session_id', sa.String(64),
                  sa.ForeignKey('bot_widget_sessions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('query', sa.Text, nullable=False),
        sa.Column('hit', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_bot_query_logs_tenant_id', 'bot_query_logs', ['tenant_id'])
    op.create_index('ix_bot_query_logs_bot_id', 'bot_query_logs', ['bot_id'])
    op.create_index('ix_bot_query_logs_created_at', 'bot_query_logs', ['created_at'])
    op.create_index('ix_bot_query_logs_hit', 'bot_query_logs', ['hit'])


def downgrade():
    op.drop_index('ix_bot_query_logs_hit', 'bot_query_logs')
    op.drop_index('ix_bot_query_logs_created_at', 'bot_query_logs')
    op.drop_index('ix_bot_query_logs_bot_id', 'bot_query_logs')
    op.drop_index('ix_bot_query_logs_tenant_id', 'bot_query_logs')
    op.drop_table('bot_query_logs')
