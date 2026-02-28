"""遷移：讓 test01 (user_id=1) 可存取所有 agents

Revision ID: 007
Revises: 006
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 將 test01@test.com 與所有 agents 建立關聯（若尚未存在）
    op.execute(
        sa.text("""
            INSERT INTO user_agents (user_id, agent_id)
            SELECT u.id, a.id FROM users u, agents a
            WHERE u.email = 'test01@test.com'
            AND NOT EXISTS (
                SELECT 1 FROM user_agents ua
                WHERE ua.user_id = u.id AND ua.agent_id = a.id
            )
        """)
    )


def downgrade() -> None:
    op.execute(
        sa.text("""
            DELETE FROM user_agents
            WHERE user_id = (SELECT id FROM users WHERE email = 'test01@test.com' LIMIT 1)
        """)
    )
