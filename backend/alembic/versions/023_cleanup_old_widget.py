"""phase2 cleanup: drop widget_sessions/messages, remove kb widget columns, update km_query_logs

Revision ID: 023
Revises: 022
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa

revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade():
    # 1. 移除 km_query_logs.widget_session_id 的 FK 並改為無 FK 的普通欄位（保留歷史資料欄位）
    op.drop_constraint('km_query_logs_widget_session_id_fkey', 'km_query_logs', type_='foreignkey')

    # 2. 移除 widget_messages（先移除，因為 FK 指向 widget_sessions）
    op.drop_table('widget_messages')

    # 3. 移除 widget_sessions
    op.drop_table('widget_sessions')

    # 4. 移除 km_knowledge_bases 的舊 widget 欄位
    for col in ['public_token', 'widget_title', 'widget_logo_url',
                'widget_color', 'widget_lang', 'widget_voice_enabled', 'widget_voice_prompt']:
        op.drop_column('km_knowledge_bases', col)


def downgrade():
    # 還原 km_knowledge_bases widget 欄位
    op.add_column('km_knowledge_bases', sa.Column('widget_voice_prompt', sa.Text, nullable=True))
    op.add_column('km_knowledge_bases', sa.Column('widget_voice_enabled', sa.Boolean, nullable=False, server_default='false'))
    op.add_column('km_knowledge_bases', sa.Column('widget_lang', sa.String(10), nullable=True))
    op.add_column('km_knowledge_bases', sa.Column('widget_color', sa.String(20), nullable=True))
    op.add_column('km_knowledge_bases', sa.Column('widget_logo_url', sa.Text, nullable=True))
    op.add_column('km_knowledge_bases', sa.Column('widget_title', sa.String(100), nullable=True))
    op.add_column('km_knowledge_bases', sa.Column('public_token', sa.String(64), nullable=True))

    # 還原 widget_sessions
    op.create_table(
        'widget_sessions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('kb_id', sa.Integer, sa.ForeignKey('km_knowledge_bases.id', ondelete='CASCADE'), nullable=False),
        sa.Column('visitor_name', sa.String(100), nullable=True),
        sa.Column('visitor_email', sa.String(200), nullable=True),
        sa.Column('visitor_phone', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_active_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    # 還原 widget_messages
    op.create_table(
        'widget_messages',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.String(64), sa.ForeignKey('widget_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    # 還原 km_query_logs FK
    op.create_foreign_key(
        'km_query_logs_widget_session_id_fkey',
        'km_query_logs', 'widget_sessions',
        ['widget_session_id'], ['id'],
        ondelete='SET NULL'
    )
