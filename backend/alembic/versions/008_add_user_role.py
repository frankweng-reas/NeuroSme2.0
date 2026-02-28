"""遷移：users 表新增 role 欄位 (admin | member)

Revision ID: 008
Revises: 007
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
    )
    op.execute(
        sa.text("UPDATE users SET role = 'admin' WHERE email = 'test01@test.com'")
    )


def downgrade() -> None:
    op.drop_column("users", "role")
