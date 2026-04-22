"""012 ordering_sessions

Revision ID: 012_ordering_sessions
Down revision: 011_add_api_keys
Branch labels: None
Depends on: None
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "012_ordering_sessions"
down_revision = "011_add_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ordering_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Column(
            "api_key_id",
            sa.Integer(),
            sa.ForeignKey("api_keys.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kb_id", sa.Integer(), nullable=False),
        sa.Column("messages", JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_unique_constraint(
        "uq_ordering_session_api_key",
        "ordering_sessions",
        ["session_id", "api_key_id"],
    )
    op.create_index("ix_ordering_sessions_session_id", "ordering_sessions", ["session_id"])
    op.create_index("ix_ordering_sessions_api_key_id", "ordering_sessions", ["api_key_id"])


def downgrade() -> None:
    op.drop_table("ordering_sessions")
