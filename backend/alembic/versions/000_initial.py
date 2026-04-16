"""squash：所有初始 tables（base / chat / bi）

Revision ID: initial001
Revises: (none)
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "initial001"
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

    # ── source_files ──────────────────────────────────────────────────────
    op.create_table(
        "source_files",
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
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("is_selected", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── stored_files ──────────────────────────────────────────────────────
    op.create_table(
        "stored_files",
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
        sa.Column(
            "uploaded_by_user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("storage_backend", sa.String(32), nullable=False, server_default="local"),
        sa.Column("storage_rel_path", sa.Text, nullable=False, unique=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("sha256_hex", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── chat_threads ──────────────────────────────────────────────────────
    op.create_table(
        "chat_threads",
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
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extra", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── chat_llm_requests ─────────────────────────────────────────────────
    op.create_table(
        "chat_llm_requests",
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
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "thread_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_threads.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("model", sa.String(255), nullable=True),
        sa.Column("provider", sa.String(64), nullable=True),
        sa.Column("prompt_tokens", sa.Integer, nullable=True),
        sa.Column("completion_tokens", sa.Integer, nullable=True),
        sa.Column("total_tokens", sa.Integer, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("trace_id", sa.String(128), nullable=True, index=True),
        sa.Column("extra", JSONB, nullable=True),
    )

    # ── chat_messages ─────────────────────────────────────────────────────
    op.create_table(
        "chat_messages",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "thread_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_threads.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("sequence", sa.Integer, nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column(
            "llm_request_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_llm_requests.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("context_file_ids", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── chat_message_attachments ──────────────────────────────────────────
    op.create_table(
        "chat_message_attachments",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "file_id",
            UUID(as_uuid=True),
            sa.ForeignKey("stored_files.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("message_id", "file_id", name="uq_chat_message_attachments_message_file"),
    )

    # ── notebooks ─────────────────────────────────────────────────────────
    op.create_table(
        "notebooks",
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
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("agent_id", sa.String(100), nullable=True, index=True),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("extra", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── notebook_sources ──────────────────────────────────────────────────
    op.create_table(
        "notebook_sources",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "notebook_id",
            UUID(as_uuid=True),
            sa.ForeignKey("notebooks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "file_id",
            UUID(as_uuid=True),
            sa.ForeignKey("stored_files.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("notebook_id", "file_id", name="uq_notebook_sources_notebook_file"),
    )

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
    op.drop_table("notebook_sources")
    op.drop_table("notebooks")
    op.drop_table("chat_message_attachments")
    op.drop_table("chat_messages")
    op.drop_table("chat_llm_requests")
    op.drop_table("chat_threads")
    op.drop_table("stored_files")
    op.drop_table("source_files")
    op.drop_table("activation_codes")
    op.drop_table("llm_provider_configs")
    op.drop_table("prompt_templates")
    op.drop_table("companies")
    op.drop_table("user_agents")
    op.drop_table("tenant_agents")
    op.drop_table("users")
    op.drop_table("agent_catalog")
    op.drop_table("tenants")
