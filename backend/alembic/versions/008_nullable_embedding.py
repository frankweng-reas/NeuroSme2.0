"""Remove server defaults from embedding_provider and embedding_model; make them nullable.

Fresh installs should show empty embedding config, requiring explicit user setup.

Revision ID: 008_nullable_embedding
Revises: 007_user_model_permissions
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa

revision = '008_nullable_embedding'
down_revision = '007_user_model_permissions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 移除 DB 層面的 DEFAULT，並允許 NULL
    op.alter_column('tenant_configs', 'embedding_provider',
                    existing_type=sa.String(50),
                    nullable=True,
                    server_default=None)
    op.alter_column('tenant_configs', 'embedding_model',
                    existing_type=sa.String(255),
                    nullable=True,
                    server_default=None)


def downgrade() -> None:
    # 還原：補回預設值並重設 NOT NULL（先填補現有 null 列）
    op.execute("UPDATE tenant_configs SET embedding_provider = 'openai' WHERE embedding_provider IS NULL")
    op.execute("UPDATE tenant_configs SET embedding_model = 'text-embedding-3-small' WHERE embedding_model IS NULL")
    op.alter_column('tenant_configs', 'embedding_provider',
                    existing_type=sa.String(50),
                    nullable=False,
                    server_default='openai')
    op.alter_column('tenant_configs', 'embedding_model',
                    existing_type=sa.String(255),
                    nullable=False,
                    server_default='text-embedding-3-small')
