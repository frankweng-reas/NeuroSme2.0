"""Add agents table

Revision ID: 001
Revises: None
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.String(100), nullable=False),
        sa.Column("group_name", sa.String(255), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("agent_name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agents_group_id"), "agents", ["group_id"], unique=False)
    op.create_index(op.f("ix_agents_agent_id"), "agents", ["agent_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_agents_agent_id"), table_name="agents")
    op.drop_index(op.f("ix_agents_group_id"), table_name="agents")
    op.drop_table("agents")
