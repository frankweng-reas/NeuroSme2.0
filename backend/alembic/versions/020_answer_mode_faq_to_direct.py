"""rename answer_mode faq to direct

Revision ID: 020
Revises: 019
Create Date: 2026-05-11
"""
from alembic import op

revision = '020'
down_revision = '019_kb_answer_mode'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE km_knowledge_bases
        SET answer_mode = 'direct'
        WHERE answer_mode = 'faq'
    """)


def downgrade():
    op.execute("""
        UPDATE km_knowledge_bases
        SET answer_mode = 'faq'
        WHERE answer_mode = 'direct'
    """)
