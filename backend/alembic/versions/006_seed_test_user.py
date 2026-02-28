"""遷移：若無則新增固定測試使用者 test01@test.com

Revision ID: 006
Revises: 005
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(sa.text("SELECT 1 FROM users WHERE email = 'test01@test.com' LIMIT 1"))
    if result.fetchone() is None:
        op.execute(
            sa.text(
                "INSERT INTO users (email, username, hashed_password, created_at, updated_at) "
                "VALUES ('test01@test.com', 'test01', 'placeholder', NOW(), NOW())"
            )
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM users WHERE email = 'test01@test.com'"))
