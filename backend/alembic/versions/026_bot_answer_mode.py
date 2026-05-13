"""026_bot_answer_mode

Revision ID: 026
Revises: 025
Create Date: 2026-05-13
"""
from alembic import op
import sqlalchemy as sa

revision = '026'
down_revision = '025_api_key_label'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'km_bots',
        sa.Column(
            'answer_mode',
            sa.String(20),
            nullable=False,
            server_default='rag',
        ),
    )


def downgrade():
    op.drop_column('km_bots', 'answer_mode')
