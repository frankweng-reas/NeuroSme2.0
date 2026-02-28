"""遷移：agents 表新增 icon_name 欄位

Revision ID: 002
Revises: 001
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("icon_name", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("agents", "icon_name")
