"""遷移：bi_projects 新增 conversation_data 欄位（JSONB，儲存對話紀錄）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bi_projects",
        sa.Column("conversation_data", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bi_projects", "conversation_data")
