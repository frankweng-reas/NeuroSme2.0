"""遷移：agent_catalog 新增 sort_id 欄位（文字型態）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_catalog",
        sa.Column("sort_id", sa.String(100), nullable=True),
    )
    op.execute(sa.text("UPDATE agent_catalog SET sort_id = id WHERE sort_id IS NULL"))


def downgrade() -> None:
    op.drop_column("agent_catalog", "sort_id")
