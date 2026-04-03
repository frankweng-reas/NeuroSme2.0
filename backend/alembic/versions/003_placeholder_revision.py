"""佔位 revision：銜接 002 → 004（無 schema 變更）。

先前 repo 缺少 003 檔案導致 alembic 無法解析 down_revision，現補上空白 revision。

Revision ID: 003
Revises: 002
Create Date: 2026-04-03
"""

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
