"""遷移：建立 user_agents 表

Revision ID: 005
Revises: 004
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_agents",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "agent_id"),
    )
    op.create_index(op.f("ix_user_agents_user_id"), "user_agents", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_agents_agent_id"), "user_agents", ["agent_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_agents_agent_id"), table_name="user_agents")
    op.drop_index(op.f("ix_user_agents_user_id"), table_name="user_agents")
    op.drop_table("user_agents")
