"""新增 bot_widget_sessions 與 bot_widget_messages 表

Revision ID: 014
Revises: 013
Create Date: 2026-05-09
"""
import sqlalchemy as sa
from alembic import op

revision = '014_bot_widget_sessions'
down_revision = '013_rename_bots_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'bot_widget_sessions',
        sa.Column('id', sa.String(64), primary_key=True, comment='Session UUID'),
        sa.Column('bot_id', sa.Integer, sa.ForeignKey('km_bots.id', ondelete='CASCADE'), nullable=False),
        sa.Column('visitor_name', sa.String(100), nullable=True),
        sa.Column('visitor_email', sa.String(200), nullable=True),
        sa.Column('visitor_phone', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_active_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_bot_widget_sessions_bot_id', 'bot_widget_sessions', ['bot_id'])

    op.create_table(
        'bot_widget_messages',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.String(64), sa.ForeignKey('bot_widget_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_bot_widget_messages_session_id', 'bot_widget_messages', ['session_id'])


def downgrade() -> None:
    op.drop_index('ix_bot_widget_messages_session_id', 'bot_widget_messages')
    op.drop_table('bot_widget_messages')
    op.drop_index('ix_bot_widget_sessions_bot_id', 'bot_widget_sessions')
    op.drop_table('bot_widget_sessions')
