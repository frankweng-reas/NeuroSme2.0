"""agent_catalog: 將 BI agent 對應到 neurosme_agent_bi.router。

Revision ID: 004
Revises: 003
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None

ROUTER = "neurosme_agent_bi.router"
FRONTEND_KEY = "agent-bi"


def upgrade() -> None:
    # 以關鍵字對應商務/BI 型 agent；若環境 agent_id 不同，可手動 UPDATE 或於後台調整。
    op.execute(
        sa.text(
            """
            UPDATE agent_catalog
            SET backend_router = :router,
                frontend_key = :fk
            WHERE backend_router IS NULL
              AND (
                LOWER(agent_id) LIKE '%business%'
                OR LOWER(COALESCE(agent_name, '')) LIKE '%商務%'
                OR LOWER(COALESCE(agent_name, '')) LIKE '%business%'
                OR LOWER(COALESCE(group_name, '')) LIKE '%商務%'
              )
            """
        ).bindparams(router=ROUTER, fk=FRONTEND_KEY)
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE agent_catalog
            SET backend_router = NULL,
                frontend_key = NULL
            WHERE backend_router = :router
            """
        ).bindparams(router=ROUTER)
    )
