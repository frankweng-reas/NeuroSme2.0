"""遷移：bi_schemas 新增 desc 欄位"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bi_schemas", sa.Column("desc", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("bi_schemas", "desc")
