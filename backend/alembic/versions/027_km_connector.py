"""027_km_connector

Revision ID: 027
Revises: 026
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "km_connectors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("knowledge_base_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("credentials_enc", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("sync_interval_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("last_cursor", sa.String(255), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("force_full_sync", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["knowledge_base_id"], ["km_knowledge_bases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_km_connectors_id", "km_connectors", ["id"])
    op.create_index("ix_km_connectors_tenant_id", "km_connectors", ["tenant_id"])
    op.create_index("ix_km_connectors_knowledge_base_id", "km_connectors", ["knowledge_base_id"])
    op.create_index("ix_km_connectors_source_type", "km_connectors", ["source_type"])
    op.create_index("ix_km_connectors_status", "km_connectors", ["status"])


def downgrade():
    op.drop_index("ix_km_connectors_status", table_name="km_connectors")
    op.drop_index("ix_km_connectors_source_type", table_name="km_connectors")
    op.drop_index("ix_km_connectors_knowledge_base_id", table_name="km_connectors")
    op.drop_index("ix_km_connectors_tenant_id", table_name="km_connectors")
    op.drop_index("ix_km_connectors_id", table_name="km_connectors")
    op.drop_table("km_connectors")
