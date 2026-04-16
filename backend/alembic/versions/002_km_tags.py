"""KM: add tags column to km_documents

Revision ID: 002_km_tags
Revises: 001_km_tables
Create Date: 2026-04-16
"""
import sqlalchemy as sa
from alembic import op

revision = "002_km_tags"
down_revision = "001_km_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "km_documents",
        sa.Column("tags", sa.JSON, nullable=True, server_default=None),
    )


def downgrade() -> None:
    op.drop_column("km_documents", "tags")
