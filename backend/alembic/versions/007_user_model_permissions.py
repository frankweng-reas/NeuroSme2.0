"""Add allowed_models to users for per-user LLM model access control

Revision ID: 007_user_model_permissions
Revises: 006_llm_model_notes
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '007_user_model_permissions'
down_revision = '006_llm_model_notes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # null = 繼承租戶全部模型；[] = 無權限；["model1",...] = 僅限指定模型
    op.add_column('users', sa.Column('allowed_models', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'allowed_models')
