"""squash：核心基礎 tables（tenants / users / agent_catalog / companies 等）

Revision ID: base0001
Revises: (none)
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "base0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── tenants ──────────────────────────────────────────────────────────
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(100), primary_key=True, index=True),
        sa.Column("name", sa.String(255), nullable=False),
    )

    # ── agent_catalog ─────────────────────────────────────────────────────
    op.create_table(
        "agent_catalog",
        sa.Column("agent_id", sa.String(100), primary_key=True, index=True),
        sa.Column("sort_id", sa.String(100), nullable=True, index=True),
        sa.Column("group_id", sa.String(100), nullable=False, index=True),
        sa.Column("group_name", sa.String(255), nullable=False),
        sa.Column("agent_name", sa.String(255), nullable=False),
        sa.Column("icon_name", sa.String(100), nullable=True),
        sa.Column("backend_router", sa.String(255), nullable=True),
        sa.Column("frontend_key", sa.String(100), nullable=True),
    )

    # ── users ─────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True, index=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("username", sa.String(100), nullable=False, unique=True, index=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── tenant_agents ─────────────────────────────────────────────────────
    op.create_table(
        "tenant_agents",
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "agent_id",
            sa.String(100),
            sa.ForeignKey("agent_catalog.agent_id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # ── user_agents ───────────────────────────────────────────────────────
    op.create_table(
        "user_agents",
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            primary_key=True,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "agent_id",
            sa.String(100),
            sa.ForeignKey("agent_catalog.agent_id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # ── companies ─────────────────────────────────────────────────────────
    op.create_table(
        "companies",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("legal_name", sa.String(255), nullable=True),
        sa.Column("tax_id", sa.String(50), nullable=True),
        sa.Column("logo_url", sa.Text, nullable=True),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("contact", sa.String(255), nullable=True),
        sa.Column("sort_order", sa.String(50), nullable=True),
        sa.Column("quotation_terms", sa.Text, nullable=True),
    )

    # ── prompt_templates ─────────────────────────────────────────────────
    op.create_table(
        "prompt_templates",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True, index=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── llm_provider_configs ──────────────────────────────────────────────
    op.create_table(
        "llm_provider_configs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(50), nullable=False, index=True),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("api_key_encrypted", sa.Text, nullable=True),
        sa.Column("api_base_url", sa.Text, nullable=True),
        sa.Column("default_model", sa.String(255), nullable=True),
        sa.Column("available_models", JSONB, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true", index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── activation_codes ─────────────────────────────────────────────────
    op.create_table(
        "activation_codes",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("code_hash", sa.Text, nullable=False, unique=True, index=True),
        sa.Column("customer_name", sa.String(255), nullable=False),
        sa.Column("agent_ids", sa.Text, nullable=False),
        sa.Column("expires_at", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "tenant_id",
            sa.String(100),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("activation_codes")
    op.drop_table("llm_provider_configs")
    op.drop_table("prompt_templates")
    op.drop_table("companies")
    op.drop_table("user_agents")
    op.drop_table("tenant_agents")
    op.drop_table("users")
    op.drop_table("agent_catalog")
    op.drop_table("tenants")
