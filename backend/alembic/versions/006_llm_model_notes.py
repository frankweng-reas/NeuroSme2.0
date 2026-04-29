"""migrate available_models from string[] to {model, note}[] format

Revision ID: 006_llm_model_notes
Revises: 005_user_profile
Create Date: 2026-04-27
"""
from alembic import op
import sqlalchemy as sa

revision = '006_llm_model_notes'
down_revision = '005_user_profile'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 將舊格式 ["model-id", ...] 轉成新格式 [{"model": "model-id", "note": ""}, ...]
    op.execute("""
        UPDATE llm_provider_configs
        SET available_models = (
            SELECT jsonb_agg(jsonb_build_object('model', m, 'note', ''))
            FROM jsonb_array_elements_text(available_models) AS m
        )
        WHERE available_models IS NOT NULL
          AND jsonb_typeof(available_models) = 'array'
          AND available_models != '[]'::jsonb
          AND jsonb_typeof(available_models -> 0) = 'string'
    """)


def downgrade() -> None:
    # 新格式 [{"model": "model-id", ...}, ...] 退回舊格式 ["model-id", ...]
    op.execute("""
        UPDATE llm_provider_configs
        SET available_models = (
            SELECT jsonb_agg(entry->>'model')
            FROM jsonb_array_elements(available_models) AS entry
        )
        WHERE available_models IS NOT NULL
          AND jsonb_typeof(available_models) = 'array'
          AND jsonb_array_length(available_models) > 0
          AND (available_models -> 0) IS NOT NULL
          AND jsonb_typeof(available_models -> 0) = 'object'
    """)
