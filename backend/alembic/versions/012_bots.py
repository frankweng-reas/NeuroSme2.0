"""新增 bots 與 bot_knowledge_bases 表

Revision ID: 012
Revises: 011
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = '012_bots'
down_revision = '011_km_chunks_tsvector'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'bots',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('tenant_id', sa.String, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('system_prompt', sa.Text, nullable=True),
        sa.Column('model_name', sa.String(100), nullable=True),
        sa.Column('public_token', sa.String(64), nullable=True, unique=True),
        sa.Column('widget_title', sa.String(100), nullable=True),
        sa.Column('widget_logo_url', sa.Text, nullable=True),
        sa.Column('widget_color', sa.String(20), nullable=True, server_default="'#1A3A52'"),
        sa.Column('widget_lang', sa.String(10), nullable=True, server_default="'zh-TW'"),
        sa.Column('created_by', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_bots_tenant_id', 'bots', ['tenant_id'])
    op.create_index('ix_bots_public_token', 'bots', ['public_token'], unique=True)

    op.create_table(
        'bot_knowledge_bases',
        sa.Column('bot_id', sa.Integer, sa.ForeignKey('bots.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('knowledge_base_id', sa.Integer, sa.ForeignKey('km_knowledge_bases.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
    )


def downgrade():
    op.drop_table('bot_knowledge_bases')
    op.drop_index('ix_bots_public_token', table_name='bots')
    op.drop_index('ix_bots_tenant_id', table_name='bots')
    op.drop_table('bots')
