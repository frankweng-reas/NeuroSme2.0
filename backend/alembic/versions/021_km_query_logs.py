"""add km_query_logs table

Revision ID: 021
Revises: 020
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'km_query_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column('tenant_id', sa.String(100),
                  sa.ForeignKey('tenants.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('user_id', sa.Integer,
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('knowledge_base_id', sa.Integer,
                  sa.ForeignKey('km_knowledge_bases.id', ondelete='CASCADE'), nullable=False),
        sa.Column('answer_mode', sa.String(32), nullable=False),
        sa.Column('query', sa.Text, nullable=False),
        sa.Column('hit', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('matched_chunk_ids', JSONB, nullable=True),
        sa.Column('session_type', sa.String(32), nullable=False, server_default='internal'),
        sa.Column('widget_session_id', sa.String(64),
                  sa.ForeignKey('widget_sessions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('chat_thread_id', UUID(as_uuid=True),
                  sa.ForeignKey('chat_threads.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_km_query_logs_tenant_id', 'km_query_logs', ['tenant_id'])
    op.create_index('ix_km_query_logs_knowledge_base_id', 'km_query_logs', ['knowledge_base_id'])
    op.create_index('ix_km_query_logs_created_at', 'km_query_logs', ['created_at'])
    op.create_index('ix_km_query_logs_hit', 'km_query_logs', ['hit'])


def downgrade():
    op.drop_index('ix_km_query_logs_hit', 'km_query_logs')
    op.drop_index('ix_km_query_logs_created_at', 'km_query_logs')
    op.drop_index('ix_km_query_logs_knowledge_base_id', 'km_query_logs')
    op.drop_index('ix_km_query_logs_tenant_id', 'km_query_logs')
    op.drop_table('km_query_logs')
