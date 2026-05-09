"""重新命名 bots → km_bots，bot_knowledge_bases → km_bot_kb

Revision ID: 013
Revises: 012
Create Date: 2026-05-09
"""
from alembic import op

revision = '013_rename_bots_tables'
down_revision = '012_bots'
branch_labels = None
depends_on = None


def upgrade():
    op.rename_table('bots', 'km_bots')
    op.rename_table('bot_knowledge_bases', 'km_bot_kb')

    # 更新 index 名稱（舊 index 仍指向舊表名，需重建）
    op.drop_index('ix_bots_tenant_id', table_name='km_bots')
    op.drop_index('ix_bots_public_token', table_name='km_bots')
    op.create_index('ix_km_bots_tenant_id', 'km_bots', ['tenant_id'])
    op.create_index('ix_km_bots_public_token', 'km_bots', ['public_token'], unique=True)


def downgrade():
    op.drop_index('ix_km_bots_public_token', table_name='km_bots')
    op.drop_index('ix_km_bots_tenant_id', table_name='km_bots')
    op.rename_table('km_bot_kb', 'bot_knowledge_bases')
    op.rename_table('km_bots', 'bots')
    op.create_index('ix_bots_public_token', 'bots', ['public_token'], unique=True)
    op.create_index('ix_bots_tenant_id', 'bots', ['tenant_id'])
