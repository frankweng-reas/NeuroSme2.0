"""遷移：將 ns-admin@reas.com.tw 設為 admin 角色"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text("UPDATE users SET role = 'admin' WHERE LOWER(email) = 'ns-admin@reas.com.tw'")
    )


def downgrade() -> None:
    op.execute(
        sa.text("UPDATE users SET role = 'member' WHERE LOWER(email) = 'ns-admin@reas.com.tw'")
    )
