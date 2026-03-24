"""
Schema 載入：

- **正式來源（唯一）**：`load_schema_from_db()` → PostgreSQL `bi_schemas.schema_json`（chat / compute / 產品路徑皆然）。
- **檔案 YAML**：`load_schema()`、`load_bi_sales_table()` 等僅剩測試、舊 Test01／遷移過渡；**規劃刪除 repo 內 YAML 後改由測試改為寫入／查詢 DB 或 fixture**，勿在新功能依賴檔案。
"""
import logging
from pathlib import Path
from typing import Any

import yaml

from app.core.config import settings

logger = logging.getLogger(__name__)

_SCHEMA_FILENAME = "bi_sales_table.yaml"


def _get_schemas_dir() -> Path | None:
    """取得 config/schemas 目錄路徑"""
    if settings.SCHEMA_CONFIG_DIR:
        p = Path(settings.SCHEMA_CONFIG_DIR).resolve()
        if p.exists():
            return p
    candidates = [
        Path(__file__).resolve().parents[3] / "config" / "schemas",
        Path(__file__).resolve().parents[2] / ".." / "config" / "schemas",
        Path.cwd().parent / "config" / "schemas",
        Path.cwd() / "config" / "schemas",
    ]
    for c in candidates:
        resolved = c.resolve()
        if resolved.exists():
            return resolved
    return None


def load_schema_from_db(schema_id: str, db: Any) -> dict[str, Any] | None:
    """
    從 bi_schemas 表載入 schema（**唯一正式來源**）。
    回傳 dict（含 id, columns, indicators 等）或 None。
    """
    if not schema_id or not str(schema_id).strip():
        return None
    try:
        from app.models import BiSchema

        row = db.query(BiSchema).filter(BiSchema.id == schema_id.strip()).first()
        if not row or not row.schema_json:
            return None
        data = dict(row.schema_json)
        data.setdefault("id", schema_id.strip())
        return data
    except Exception:
        return None


def load_schema(schema_id: str) -> dict[str, Any] | None:
    """
    [過渡] 從 config/schemas/{schema_id}.yaml 讀取。僅測試／尚未遷移之程式使用。
    產品與 chat compute **必須**使用 load_schema_from_db()；YAML 檔將移除。
    """
    if not schema_id or not str(schema_id).strip():
        return None
    base = _get_schemas_dir()
    if not base:
        return None
    path = base / f"{schema_id.strip()}.yaml"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if isinstance(data, dict):
            data.setdefault("id", schema_id)
            return data
        return None
    except (yaml.YAMLError, OSError) as e:
        logger.warning("Schema %s 載入失敗: %s", schema_id, e)
        return None


def _find_schema_path() -> Path | None:
    """尋找 bi_sales_table.yaml 路徑，支援多種執行環境"""
    if settings.SCHEMA_CONFIG_DIR:
        custom = Path(settings.SCHEMA_CONFIG_DIR).resolve() / _SCHEMA_FILENAME
        if custom.exists():
            return custom
    candidates = [
        # 從 backend/app/services 往上到專案根目錄
        Path(__file__).resolve().parents[3] / "config" / "schemas" / _SCHEMA_FILENAME,
        # 從 backend 目錄的父層（專案根）
        Path(__file__).resolve().parents[2] / ".." / "config" / "schemas" / _SCHEMA_FILENAME,
        # 從 cwd（若從 backend/ 執行 uvicorn）
        Path.cwd().parent / "config" / "schemas" / _SCHEMA_FILENAME,
        # 從 cwd（若從專案根執行）
        Path.cwd() / "config" / "schemas" / _SCHEMA_FILENAME,
    ]
    for p in candidates:
        resolved = p.resolve()
        if resolved.exists():
            return resolved
    return None


def _parse_default(default_str: str, type_str: str) -> Any:
    """解析 default 字串為適當型別"""
    s = default_str.strip()
    if not s:
        return None
    if type_str == "num":
        try:
            return int(s) if "." not in s else float(s)
        except ValueError:
            return 0
    return s


def _normalize_bi_sales_item(item: Any) -> dict[str, Any] | None:
    """
    將 schema 項目正規化為 {field, type, attr, aliases, required?, default?}。
    支援兩種格式：
    - 舊格式：{"field": "x", "type": "str", "attr": "dim", "aliases": [...], ...}
    - 新格式：{"field_name": "type|attr|aliases|required|default"}
    """
    if not isinstance(item, dict):
        return None
    # 新格式：單一 key 為 field，value 為 "type|attr|aliases|required|default"
    if "field" not in item and len(item) == 1:
        field_name, value = next(iter(item.items()))
        if not isinstance(value, str):
            return None
        parts = [p.strip() for p in value.split("|")]
        type_str = parts[0] if len(parts) > 0 else "str"
        attr_str = parts[1] if len(parts) > 1 else "dim"
        aliases_str = parts[2] if len(parts) > 2 else ""
        required_str = parts[3].lower() if len(parts) > 3 else "false"
        default_str = parts[4] if len(parts) > 4 else ""

        aliases = [a.strip() for a in aliases_str.split(",") if a.strip()]
        required = required_str in ("true", "1", "yes")
        default_val = _parse_default(default_str, type_str)

        result: dict[str, Any] = {
            "field": field_name,
            "type": type_str,
            "attr": attr_str,
            "aliases": aliases,
            "required": required,
        }
        if default_val is not None:
            result["default"] = default_val
        elif type_str == "num":
            result["default"] = 1 if field_name == "quantity" else 0
        elif type_str == "timestamp":
            result["default"] = ""
        else:
            result["default"] = ""
        return result
    # 舊格式：已有 field 等欄位，直接回傳（確保 aliases 為 list）
    if "field" in item:
        out = dict(item)
        if "aliases" in out and isinstance(out["aliases"], str):
            out["aliases"] = [a.strip() for a in out["aliases"].split(",") if a.strip()]
        return out
    return None


def bi_schema_columns_to_fields(columns: dict[str, Any] | None) -> list[dict[str, Any]]:
    """
    將 bi_schema 的 columns（dict 格式）轉為 transform_csv_to_schema 所需的 schema_fields 列表。
    格式：{ field_name: { type, attr, aliases } } -> [ { field, type, attr, aliases, default } ]
    """
    if not columns or not isinstance(columns, dict):
        return []
    result: list[dict[str, Any]] = []
    for field_name, col in columns.items():
        if not isinstance(col, dict):
            continue
        aliases = col.get("aliases")
        if isinstance(aliases, str):
            aliases = [a.strip() for a in aliases.split(",") if a.strip()]
        elif isinstance(aliases, list):
            aliases = [str(a).strip() for a in aliases if str(a).strip()]
        else:
            aliases = []
        type_str = str(col.get("type", "str"))
        if type_str == "time":
            type_str = "timestamp"
        default: Any = None
        if type_str == "num":
            default = 0
        elif type_str == "timestamp":
            default = ""
        elif field_name == "quantity":
            default = 1
        result.append({
            "field": field_name,
            "type": type_str if type_str in ("str", "num", "timestamp") else "str",
            "attr": str(col.get("attr", "dim")),
            "aliases": aliases,
            "default": default,
        })
    return result


def build_csv_mapping_from_schema(
    csv_headers: list[str],
    schema_fields: list[dict[str, Any]],
) -> dict[str, str]:
    """
    依 schema 的 field 與 aliases，將 CSV headers 對應到 schema field。
    回傳 { "csv_header": "schema_field" }。
    無欄序 fallback：表頭須與欄位名或 aliases 完全一致。
    """
    mapping: dict[str, str] = {}
    header_set = {h.strip(): h for h in csv_headers if h and str(h).strip()}
    for f in schema_fields:
        field = f.get("field")
        if not field:
            continue
        aliases = f.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [a.strip() for a in aliases.split(",") if a.strip()]
        candidates = [field] + list(aliases)
        for c in candidates:
            c_trim = str(c).strip()
            if not c_trim:
                continue
            if c_trim in header_set:
                mapping[header_set[c_trim]] = field
                break
    return mapping


def load_bi_sales_schema() -> list[dict[str, Any]]:
    """載入 bi_sales_table.yaml，回傳欄位定義列表（支援新格式 type|attr|aliases）"""
    path = _find_schema_path()
    if not path:
        logger.warning("bi_sales_table.yaml 找不到，嘗試路徑: %s", Path(__file__).resolve().parents[3] / "config" / "schemas" / _SCHEMA_FILENAME)
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, list):
            return []
        result: list[dict[str, Any]] = []
        for item in data:
            normalized = _normalize_bi_sales_item(item)
            if normalized:
                result.append(normalized)
        return result
    except yaml.YAMLError as e:
        logger.exception("bi_sales_table.yaml 解析失敗: %s", e)
        return []
    except OSError as e:
        logger.exception("bi_sales_table.yaml 讀取失敗: %s", e)
        return []
