"""遷移：種子 agents 資料，並讓 test01 可存取所有 agents

Revision ID: 009
Revises: 008
Create Date: 2025-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AGENTS = [
    ("agent-customer-1", "g1", "客戶服務", "customer_support", "客戶諮詢助理", "MessageCircle"),
    ("agent-business-1", "g2", "商務應用", "business_analyst", "商務分析助理", "ChartNoAxesCombined"),
    ("agent-default-1", "g3", "一般助理", "default_helper", "一般助理", "Bot"),
]


def upgrade() -> None:
    conn = op.get_bind()
    # 若 agents 表為空則插入種子資料
    result = conn.execute(sa.text("SELECT 1 FROM agents LIMIT 1"))
    if result.fetchone() is None:
        for aid, gid, gname, agent_id, agent_name, icon in AGENTS:
            conn.execute(
                sa.text("""
                    INSERT INTO agents (id, group_id, group_name, agent_id, agent_name, icon_name, created_at, updated_at)
                    VALUES (:id, :gid, :gname, :agent_id, :agent_name, :icon, NOW(), NOW())
                """),
                {"id": aid, "gid": gid, "gname": gname, "agent_id": agent_id, "agent_name": agent_name, "icon": icon},
            )
        # 讓 test01 可存取所有 agents
        conn.execute(
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
    conn = op.get_bind()
    # 移除 test01 的 agent 關聯
    conn.execute(
        sa.text("""
            DELETE FROM user_agents
            WHERE user_id = (SELECT id FROM users WHERE email = 'test01@test.com' LIMIT 1)
        """)
    )
    # 移除種子 agents
    for aid, *_ in AGENTS:
        conn.execute(sa.text("DELETE FROM agents WHERE id = :id"), {"id": aid})
