"""
DuckDB 長存：專案 CSV 同步至 .duckdb 檔

- sync_project_csv_to_duckdb：將 CSV 內容寫入專案對應的 DuckDB
- get_project_duckdb_path：取得專案 DuckDB 檔路徑（存在則回傳）
- get_project_data_as_csv：取得專案 DuckDB 資料為 CSV 字串（供 chat 參考用）
- delete_project_duckdb：刪除專案 DuckDB 檔
"""
import io
import logging
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from app.core.config import settings

logger = logging.getLogger(__name__)

_TABLE_NAME = "data"


def _get_base_dir() -> Path:
    """
    DuckDB 存放根目錄。
    以 backend 目錄為基準，避免 cwd 不同導致寫入與 CLI 讀取不同檔。
    """
    d = (settings.DUCKDB_DATA_DIR or "").strip()
    if not d:
        return Path()
    p = Path(d)
    if not p.is_absolute():
        # 相對於 backend/ 目錄（__file__ = backend/app/services/duckdb_store.py）
        backend_root = Path(__file__).resolve().parents[2]
        p = (backend_root / d).resolve()
    return p


def get_project_duckdb_path(project_id: str) -> Path | None:
    """
    取得專案 DuckDB 檔路徑。
    若 DUCKDB_DATA_DIR 為空或檔不存在，回傳 None。
    """
    base = _get_base_dir()
    if not base or not str(base).strip():
        logger.warning("get_project_duckdb_path: DUCKDB_DATA_DIR 未設定或為空")
        return None
    path = base / f"{project_id}.duckdb"
    if not path.exists():
        logger.warning("get_project_duckdb_path: 檔案不存在 project_id=%r path=%s", project_id, path)
        return None
    return path


def sync_transformed_rows_to_duckdb(
    project_id: str, rows: list[dict[str, Any]]
) -> tuple[bool, int, str]:
    """
    將已轉換的 rows（符合 Standard Schema）寫入 DuckDB。
    Test01 POC 使用 project_id = test01_{user_id}。
    回傳 (成功, 筆數, 錯誤訊息)。
    """
    base = _get_base_dir()
    if not base or not str(base).strip():
        return False, 0, "DUCKDB_DATA_DIR 未設定"
    base.mkdir(parents=True, exist_ok=True)
    path = base / f"{project_id}.duckdb"

    if not rows:
        if path.exists():
            path.unlink()
        return True, 0, ""

    try:
        df = pd.DataFrame(rows)
        conn = duckdb.connect(str(path))
        conn.execute(f"DROP TABLE IF EXISTS {_TABLE_NAME}")
        conn.register("_df", df)
        conn.execute(f"CREATE TABLE {_TABLE_NAME} AS SELECT * FROM _df")
        conn.unregister("_df")
        conn.close()
        row_count = len(df)
        logger.info("DuckDB 同步成功: %s (%d 列)", path, row_count)
        return True, row_count, ""
    except Exception as e:
        err_msg = str(e)
        logger.warning("DuckDB 同步失敗 %s: %s", project_id, err_msg)
        return False, 0, err_msg


def sync_project_csv_to_duckdb(project_id: str, csv_content: str) -> tuple[bool, int]:
    """
    將 CSV 內容同步至專案 DuckDB 檔。
    成功回傳 True，失敗回傳 False。
    """
    base = _get_base_dir()
    if not base or not str(base).strip():
        return False, 0
    base.mkdir(parents=True, exist_ok=True)
    path = base / f"{project_id}.duckdb"

    if not csv_content or not csv_content.strip():
        # 無內容時刪除既有檔
        if path.exists():
            path.unlink()
        return True, 0

    try:
        df = pd.read_csv(io.StringIO(csv_content.strip()), encoding="utf-8-sig")
        df.columns = [str(c).strip() for c in df.columns]
        # 數值欄位轉 numeric（支援 Sales Analytics: sales_amount, gross_profit, guest_count 等）
        _NUMERIC_KEYWORDS = ("金額", "銷售額", "數量", "amount", "sales", "quantity", "price", "value", "profit", "gross", "count")
        for col in df.columns:
            if any(kw in col for kw in _NUMERIC_KEYWORDS) and df[col].dtype == object:
                df[col] = pd.to_numeric(df[col].astype(str).str.replace(",", ""), errors="coerce")

        conn = duckdb.connect(str(path))
        conn.execute(f"DROP TABLE IF EXISTS {_TABLE_NAME}")
        conn.register("_df", df)
        conn.execute(f"CREATE TABLE {_TABLE_NAME} AS SELECT * FROM _df")
        conn.unregister("_df")
        conn.close()
        row_count = len(df)
        logger.info("DuckDB 同步成功: %s (%d 列)", path, row_count)
        return True, row_count
    except Exception as e:
        logger.warning("DuckDB 同步失敗 %s: %s", project_id, e)
        return False, 0


def delete_project_duckdb(project_id: str) -> bool:
    """刪除專案 DuckDB 檔。成功回傳 True。"""
    base = _get_base_dir()
    if not base:
        return False
    path = base / f"{project_id}.duckdb"
    try:
        if path.exists():
            path.unlink()
            logger.info("DuckDB 已刪除: %s", path)
        return True
    except Exception as e:
        logger.warning("DuckDB 刪除失敗 %s: %s", project_id, e)
        return False


def get_project_duckdb_row_count(project_id: str) -> int | None:
    """
    取得專案 DuckDB 的資料筆數。
    若無 DuckDB 或無資料則回傳 None。
    """
    path = get_project_duckdb_path(project_id)
    if not path:
        return None
    df = execute_sql_on_duckdb_file(path, "SELECT COUNT(*) as cnt FROM data")
    if df is None or df.empty:
        return None
    try:
        return int(df.iloc[0]["cnt"])
    except (KeyError, ValueError, IndexError):
        return None


def get_project_data_as_csv(project_id: str) -> str | None:
    """
    取得專案 DuckDB 資料為 CSV 字串。
    若無 DuckDB 或無資料則回傳 None。
    """
    path = get_project_duckdb_path(project_id)
    if not path:
        return None
    df = execute_sql_on_duckdb_file(path, "SELECT * FROM data")
    if df is None or df.empty:
        return None
    return df.to_csv(index=False)


def execute_sql_on_duckdb_file(path: Path, sql: str) -> pd.DataFrame | None:
    """
    在長存 DuckDB 檔上執行 SQL，回傳 DataFrame。
    表名為 data。
    """
    if not path or not path.exists() or not sql or not sql.strip():
        return None
    try:
        conn = duckdb.connect(str(path), read_only=True)
        result = conn.execute(sql.strip().rstrip(";").strip()).df()
        conn.close()
        return result
    except Exception as e:
        logger.warning("DuckDB 執行失敗 %s: %s", path, e)
        return None
