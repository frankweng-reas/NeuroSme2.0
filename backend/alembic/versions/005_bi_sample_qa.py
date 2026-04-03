"""新增 bi_sample_qa：依 tenant_id, user_id, agent_id 儲存使用者範例問題

Revision ID: 005
Revises: 004
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bi_sample_qa",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bi_sample_qa_tenant_id", "bi_sample_qa", ["tenant_id"])
    op.create_index("ix_bi_sample_qa_user_id", "bi_sample_qa", ["user_id"])
    op.create_index("ix_bi_sample_qa_agent_id", "bi_sample_qa", ["agent_id"])
    op.create_index(
        "ix_bi_sample_qa_tenant_user_agent",
        "bi_sample_qa",
        ["tenant_id", "user_id", "agent_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_bi_sample_qa_tenant_user_agent", table_name="bi_sample_qa")
    op.drop_index("ix_bi_sample_qa_agent_id", table_name="bi_sample_qa")
    op.drop_index("ix_bi_sample_qa_user_id", table_name="bi_sample_qa")
    op.drop_index("ix_bi_sample_qa_tenant_id", table_name="bi_sample_qa")
    op.drop_table("bi_sample_qa")
