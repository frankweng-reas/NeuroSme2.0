"""遷移：新增 source_files 表

Revision ID: 014
Revises: 013
Create Date: 2025-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "source_files",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_source_files_user_tenant_agent",
        "source_files",
        ["user_id", "tenant_id", "agent_id"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_source_files_user_tenant_agent_filename",
        "source_files",
        ["user_id", "tenant_id", "agent_id", "file_name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_source_files_user_tenant_agent_filename", "source_files", type_="unique")
    op.drop_index("ix_source_files_user_tenant_agent", table_name="source_files")
    op.drop_table("source_files")
