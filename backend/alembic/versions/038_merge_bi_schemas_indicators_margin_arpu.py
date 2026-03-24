"""遷移：於含 col_9/col_8（及 col_11）之 bi_schemas 合併 margin_rate、arpu 指標定義"""
import json
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "038"
down_revision: Union[str, None] = "037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _merge_indicators(data: dict[str, Any]) -> bool:
    """
    若為餐飲 col_* 欄位模板（含 col_9、col_8），寫入 margin_rate、arpu。
    回傳是否曾修改。
    """
    cols = data.get("columns") or {}
    if not isinstance(cols, dict):
        return False
    if "col_9" not in cols or "col_8" not in cols:
        return False
    if "indicators" not in data or not isinstance(data["indicators"], dict):
        data["indicators"] = {}
    ind = data["indicators"]
    ind["margin_rate"] = {
        "type": "ratio",
        "display_label": "毛利率",
        "value_components": ["col_9", "col_8"],
        "as_percent": True,
    }
    if "col_11" in cols:
        ind["arpu"] = {
            "type": "ratio",
            "display_label": "客單價",
            "value_components": ["col_8", "col_11"],
            "as_percent": False,
        }
    return True


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, schema_json FROM bi_schemas")).fetchall()
    for row in rows:
        sid, sj = row[0], row[1]
        if sj is None:
            continue
        data = dict(sj) if isinstance(sj, dict) else json.loads(sj) if isinstance(sj, str) else {}
        if not _merge_indicators(data):
            continue
        conn.execute(
            sa.text(
                """
                UPDATE bi_schemas
                SET schema_json = CAST(:j AS jsonb), updated_at = NOW()
                WHERE id = :id
                """
            ),
            {"id": sid, "j": json.dumps(data, ensure_ascii=False)},
        )


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, schema_json FROM bi_schemas")).fetchall()
    for row in rows:
        sid, sj = row[0], row[1]
        if sj is None:
            continue
        data = dict(sj) if isinstance(sj, dict) else json.loads(sj) if isinstance(sj, str) else {}
        ind = data.get("indicators")
        if not isinstance(ind, dict):
            continue
        changed = False
        mr = ind.get("margin_rate") if isinstance(ind.get("margin_rate"), dict) else None
        if mr and mr.get("value_components") == ["col_9", "col_8"]:
            del ind["margin_rate"]
            changed = True
        ar = ind.get("arpu") if isinstance(ind.get("arpu"), dict) else None
        if ar and ar.get("value_components") == ["col_8", "col_11"]:
            del ind["arpu"]
            changed = True
        if changed:
            conn.execute(
                sa.text(
                    """
                    UPDATE bi_schemas
                    SET schema_json = CAST(:j AS jsonb), updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": sid, "j": json.dumps(data, ensure_ascii=False)},
            )
