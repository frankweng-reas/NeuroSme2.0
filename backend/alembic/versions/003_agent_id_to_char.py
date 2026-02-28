"""遷移：agents 表 id 欄位改為 VARCHAR(100)

Revision ID: 003
Revises: 002
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL: 將 id 從 INTEGER 轉為 VARCHAR(100)，既有資料轉成字串
    op.execute("ALTER TABLE agents ALTER COLUMN id DROP DEFAULT")
    op.execute("ALTER TABLE agents ALTER COLUMN id TYPE VARCHAR(100) USING id::text")


def downgrade() -> None:
    # 還原為 INTEGER（僅當 id 皆為數字字串時可行）
    op.execute("ALTER TABLE agents ALTER COLUMN id TYPE INTEGER USING id::integer")
    op.execute(
        "ALTER TABLE agents ALTER COLUMN id SET DEFAULT nextval("
        "'agents_id_seq'::regclass)"
    )
