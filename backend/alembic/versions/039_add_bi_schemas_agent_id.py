"""遷移：bi_schemas 加 agent_id 欄位（綁定特定 agent）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "039"
down_revision: Union[str, None] = "038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bi_schemas",
        sa.Column("agent_id", sa.String(100), nullable=True),
    )
    op.create_index("ix_bi_schemas_agent_id", "bi_schemas", ["agent_id"])


def downgrade() -> None:
    op.drop_index("ix_bi_schemas_agent_id", table_name="bi_schemas")
    op.drop_column("bi_schemas", "agent_id")
