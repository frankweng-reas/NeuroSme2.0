"""遷移：建立 bi_projects、bi_sources 表（商務分析專案與來源檔案）

bi_projects：商務型 agent 專案，每個 user 可建立多個專案
bi_sources：每個專案用到的上傳檔案與內容，含 is_selected 控制是否納入 chat
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. bi_projects：商務分析專案
    op.create_table(
        "bi_projects",
        sa.Column("project_id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("user_id", sa.String(100), nullable=False, index=True),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("project_name", sa.String(255), nullable=False),
        sa.Column("project_desc", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 2. bi_sources：專案用到的上傳檔案與內容
    op.create_table(
        "bi_sources",
        sa.Column("source_id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("bi_projects.project_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_type", sa.String(50), nullable=False, index=True),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("bi_sources")
    op.drop_table("bi_projects")
