"""遷移：qtn_projects.status 從 PARSING/DRAFT/GENERATING/FINAL 改為 STEP1/STEP2/STEP3/STEP4"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 更新既有資料
    op.execute("UPDATE qtn_projects SET status = 'STEP1' WHERE status = 'PARSING'")
    op.execute("UPDATE qtn_projects SET status = 'STEP2' WHERE status = 'DRAFT'")
    op.execute("UPDATE qtn_projects SET status = 'STEP3' WHERE status = 'GENERATING'")
    op.execute("UPDATE qtn_projects SET status = 'STEP4' WHERE status = 'FINAL'")
    # 更新 server_default（新建立的專案）
    op.alter_column(
        "qtn_projects",
        "status",
        existing_type=sa.String(50),
        existing_server_default=sa.text("'PARSING'"),
        server_default=sa.text("'STEP1'"),
    )


def downgrade() -> None:
    # 還原既有資料
    op.execute("UPDATE qtn_projects SET status = 'PARSING' WHERE status = 'STEP1'")
    op.execute("UPDATE qtn_projects SET status = 'DRAFT' WHERE status = 'STEP2'")
    op.execute("UPDATE qtn_projects SET status = 'GENERATING' WHERE status = 'STEP3'")
    op.execute("UPDATE qtn_projects SET status = 'FINAL' WHERE status = 'STEP4'")
    op.alter_column(
        "qtn_projects",
        "status",
        existing_type=sa.String(50),
        existing_server_default=sa.text("'STEP1'"),
        server_default=sa.text("'PARSING'"),
    )
