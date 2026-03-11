"""遷移：companies 表新增 quotation_terms 欄位（報價預設條款）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("quotation_terms", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("companies", "quotation_terms")
