"""km_chunks 加 content_tsv（全文搜尋）與 GIN index

Revision ID: 011
Revises: 010
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TSVECTOR

revision = '011_km_chunks_tsvector'
down_revision = '010_widget_voice_prompt'
branch_labels = None
depends_on = None


def upgrade():
    # 建立 pg_cjk_parser extension（若不存在）
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_cjk_parser")

    # 建立 cjk text search configuration（若不存在）
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_ts_parser WHERE prsname = 'pg_cjk_parser'
            ) THEN
                CREATE TEXT SEARCH PARSER public.pg_cjk_parser (
                    START    = public.prsd2_cjk_start,
                    GETTOKEN = public.prsd2_cjk_nexttoken,
                    END      = public.prsd2_cjk_end,
                    LEXTYPES = public.prsd2_cjk_lextype,
                    HEADLINE = public.prsd2_cjk_headline
                );
            END IF;
        END
        $$;
    """)

    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_ts_config WHERE cfgname = 'cjk'
            ) THEN
                CREATE TEXT SEARCH CONFIGURATION public.cjk (PARSER = public.pg_cjk_parser);
                ALTER TEXT SEARCH CONFIGURATION public.cjk
                    ADD MAPPING FOR asciiword, word, numword, cjk, int, uint, float, sfloat, version
                    WITH simple;
            END IF;
        END
        $$;
    """)

    # 加 content_tsv 欄位
    op.add_column(
        'km_chunks',
        sa.Column('content_tsv', TSVECTOR, nullable=True),
    )

    # 用現有 content 填入 content_tsv（backfill）
    op.execute("""
        UPDATE km_chunks
        SET content_tsv = to_tsvector('public.cjk', content)
        WHERE content IS NOT NULL
    """)

    # 建立 GIN index
    op.execute("""
        CREATE INDEX ix_km_chunks_content_tsv
        ON km_chunks
        USING GIN (content_tsv)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_km_chunks_content_tsv")
    op.drop_column('km_chunks', 'content_tsv')
