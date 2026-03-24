"""遷移：移除 bi_projects.schema_id 資料庫預設值（改由匯入或 API 明確設定）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "bi_projects",
        "schema_id",
        existing_type=sa.String(100),
        server_default=None,
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "bi_projects",
        "schema_id",
        existing_type=sa.String(100),
        server_default="fact_business_operations",
        existing_nullable=True,
    )
