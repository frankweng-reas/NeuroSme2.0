"""遷移：建立 bi_schemas 表，並將 fact_business_operations 作為系統範本寫入"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# fact_business_operations 種子（歷史上與舊 YAML 範本同結構；正式來源為 bi_schemas 表）
SCHEMA_JSON = {
    "id": "fact_business_operations",
    "name": "Sales Analytics",
    "columns": {
        "order_id": {"type": "str", "attr": "dim", "aliases": ["訂單編號"]},
        "timestamp": {"type": "time", "attr": "dim_time", "aliases": ["日期", "時間", "月份", "月"]},
        "store_name": {"type": "str", "attr": "dim", "aliases": ["通路", "平台", "各平台", "店"]},
        "item_name": {"type": "str", "attr": "dim", "aliases": ["品名", "產品", "商品", "產品名稱"]},
        "category_l1": {"type": "str", "attr": "dim", "aliases": ["大類", "主分類", "品類", "類別"]},
        "category_l2": {"type": "str", "attr": "dim", "aliases": ["中類", "子分類", "品類", "類別"]},
        "quantity": {"type": "num", "attr": "val", "aliases": ["數量", "銷售數量"]},
        "sales_amount": {"type": "num", "attr": "val_denom", "aliases": ["營收", "售價總額", "revenue", "銷售金額", "銷售額", "金額", "摳摳"]},
        "gross_profit": {"type": "num", "attr": "val_num", "aliases": ["毛利", "獲利"]},
        "cost_amount": {"type": "num", "attr": "val_denom", "aliases": ["成本", "預估成本"]},
        "guest_count": {"type": "num", "attr": "val_denom", "aliases": ["來客數", "人數"]},
        "discount_amount": {"type": "num", "attr": "val", "aliases": ["折扣金額", "讓利金額"]},
        "is_member": {"type": "str", "attr": "dim", "aliases": ["是否會員", "會員身份"]},
    },
    "dimension_hierarchy": {
        "通路層級": ["channel", "store_name"],
        "產品層級": ["category_l1", "category_l2", "item_name"],
    },
    "aggregation": {"default": "sum"},
    "indicators": {
        "margin_rate": {"type": "ratio", "display_label": "毛利率", "value_components": ["gross_profit", "sales_amount"], "as_percent": True},
        "roi": {"type": "ratio", "display_label": "ROI", "value_components": ["gross_profit", "cost_amount"], "as_percent": False},
        "arpu": {"type": "ratio", "display_label": "客單價", "value_components": ["sales_amount", "guest_count"], "as_percent": False},
        "sales_yoy_growth": {"type": "compare_period", "display_label": "YoY成長率", "value_components": ["sales_amount"]},
        "discount_rate": {"type": "ratio", "display_label": "折扣率", "value_components": ["discount_amount", "sales_amount"], "as_percent": True},
    },
}


def upgrade() -> None:
    op.create_table(
        "bi_schemas",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("schema_json", JSONB(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("is_template", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # 寫入系統範本（fact_business_operations）
    conn = op.get_bind()
    conn.execute(
        sa.text("""
            INSERT INTO bi_schemas (id, name, schema_json, user_id, is_template)
            VALUES (:id, :name, CAST(:schema_json AS jsonb), NULL, true)
        """),
        {"id": "fact_business_operations", "name": "Sales Analytics", "schema_json": json.dumps(SCHEMA_JSON, ensure_ascii=False)},
    )


def downgrade() -> None:
    op.drop_table("bi_schemas")
