"""squash：BI Agent tables（bi_schemas / bi_projects / bi_sources / bi_sample_qa）

Revision ID: bi0001
Revises: chat0001
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "bi0001"
down_revision = "chat0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── bi_schemas ────────────────────────────────────────────────────────
    op.create_table(
        "bi_schemas",
        sa.Column("id", sa.String(100), primary_key=True, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("desc", sa.Text, nullable=True),
        sa.Column("schema_json", JSONB, nullable=False),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("agent_id", sa.String(100), nullable=True, index=True),
        sa.Column("is_template", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── bi_projects ───────────────────────────────────────────────────────
    op.create_table(
        "bi_projects",
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.String(100), nullable=False, index=True),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("project_name", sa.String(255), nullable=False),
        sa.Column("project_desc", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("conversation_data", JSONB, nullable=True),
        sa.Column("schema_id", sa.String(100), nullable=True),
    )

    # ── bi_sources ────────────────────────────────────────────────────────
    op.create_table(
        "bi_sources",
        sa.Column(
            "source_id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("bi_projects.project_id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("source_type", sa.String(50), nullable=False, index=True),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("is_selected", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── bi_sample_qa ──────────────────────────────────────────────────────
    op.create_table(
        "bi_sample_qa",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.String(100), nullable=False, index=True),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("bi_sample_qa")
    op.drop_table("bi_sources")
    op.drop_table("bi_projects")
    op.drop_table("bi_schemas")
