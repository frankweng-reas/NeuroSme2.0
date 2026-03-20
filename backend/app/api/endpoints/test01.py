"""Test01 Agent POC：CSV → Schema Mapping → DuckDB"""
import json
import logging
import re
from typing import Annotated, Any

import litellm
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.endpoints.chat import _get_llm_params, _parse_response
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.user_schema_mapping import UserSchemaMapping
from app.services.csv_transform import transform_csv_to_schema
from app.services.duckdb_store import sync_transformed_rows_to_duckdb
from app.services.schema_loader import load_bi_sales_schema
from pydantic import BaseModel

router = APIRouter(tags=["test01"])
logger = logging.getLogger(__name__)

SCHEMA_ID = "bi_sales_table"


class TransformRequest(BaseModel):
    csv_content: str
    mapping: dict[str, str]  # csv_column -> schema_field


class TransformResponse(BaseModel):
    rows: list[dict[str, Any]]
    row_count: int


class SyncRequest(BaseModel):
    csv_content: str
    mapping: dict[str, str]
    template_name: str | None = None  # 同步成功時儲存到此範本
    csv_headers: list[str] | None = None  # 儲存時一併寫入，供 auto-match


class SyncResponse(BaseModel):
    ok: bool
    message: str
    row_count: int
    error_detail: str = ""


class SuggestMappingRequest(BaseModel):
    csv_headers: list[str]
    model: str = "gpt-4o-mini"


class SuggestMappingResponse(BaseModel):
    mapping: dict[str, str]  # schema_field -> csv_header
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class MappingTemplateItem(BaseModel):
    template_name: str
    csv_headers: list[str] | None


class MappingTemplateDetail(BaseModel):
    template_name: str
    mapping: dict[str, str]  # schema_field -> csv_header
    csv_headers: list[str] | None


class SaveMappingRequest(BaseModel):
    template_name: str
    mapping: dict[str, str]  # schema_field -> csv_header
    csv_headers: list[str] | None = None


def _reverse_mapping(m: dict[str, str]) -> dict[str, str]:
    """csv_col -> schema_field 轉為 schema_field -> csv_col"""
    return {v: k for k, v in m.items() if k and v}


def _extract_mapping_from_llm(text: str) -> dict[str, str]:
    """從 LLM 回覆中解析 JSON mapping"""
    text = text.strip()
    # 嘗試找 ```json ... ``` 區塊
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if m:
        text = m.group(1).strip()
    else:
        # 找 { ... }
        brace = text.find("{")
        if brace >= 0:
            depth = 0
            end = -1
            for i in range(brace, len(text)):
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            if end >= 0:
                text = text[brace : end + 1]
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return {k: str(v) for k, v in data.items() if v}
        return {}
    except json.JSONDecodeError:
        return {}


@router.post("/suggest-mapping", response_model=SuggestMappingResponse)
async def suggest_mapping(
    body: SuggestMappingRequest,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """使用 LLM 建議 CSV 欄位與 Standard Schema 的對應"""
    schema = load_bi_sales_schema()
    if not schema:
        raise HTTPException(status_code=500, detail="Schema 載入失敗")
    if not body.csv_headers:
        return SuggestMappingResponse(mapping={})

    model = (body.model or "").strip() or "gpt-4o-mini"
    litellm_model, api_key, api_base = _get_llm_params(model)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="LLM API Key 未設定，請在 .env 中設定 OPENAI_API_KEY 或 GEMINI_API_KEY",
        )

    schema_desc = "\n".join(
        f"- {f['field']}: {f.get('type', 'str')}, aliases: {f.get('aliases', [])}"
        for f in schema
    )
    csv_list = ", ".join(repr(h) for h in body.csv_headers)

    system = """你是資料對應專家。根據 CSV 欄位名稱與 Standard Schema 定義，輸出「schema 欄位 → CSV 欄位」的對應。
只輸出 JSON 物件，格式：{"schema_field": "csv_header"}。
不確定的對應可省略。每個 CSV 欄位最多對應一個 schema 欄位。"""

    user = f"""CSV 欄位：{csv_list}

Standard Schema：
{schema_desc}

請輸出 JSON 對應（schema 欄位名為 key，CSV 欄位名為 value）："""

    try:
        import os

        if model.startswith("gemini/"):
            os.environ["GEMINI_API_KEY"] = api_key
        else:
            os.environ["OPENAI_API_KEY"] = api_key

        completion_kwargs: dict = {
            "model": litellm_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "api_key": api_key,
            "timeout": 30,
        }
        if api_base:
            base = api_base.rstrip("/")
            completion_kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"
        resp = await litellm.acompletion(**completion_kwargs)
        content = _parse_response(resp).content or ""
        mapping = _extract_mapping_from_llm(content)

        # 驗證：只保留 schema 中存在的 field，且 csv_header 在 headers 中
        valid_headers = {h.strip() for h in body.csv_headers}
        schema_fields = {f["field"] for f in schema}
        filtered = {
            k: v
            for k, v in mapping.items()
            if k in schema_fields and v in valid_headers
        }

        # 取得 usage 與 model
        usage = getattr(resp, "usage", None)
        input_tokens = usage.prompt_tokens if usage else None
        output_tokens = usage.completion_tokens if usage else None
        resp_model = getattr(resp, "model", None) or model

        return SuggestMappingResponse(
            mapping=filtered,
            model=resp_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("suggest_mapping LLM 呼叫失敗: %s", e)
        raise HTTPException(status_code=500, detail=f"LLM 建議失敗：{e}")


@router.get("/schema", response_model=list[dict[str, Any]])
def get_bi_sales_schema(
    current: Annotated[User, Depends(get_current_user)],
):
    """取得 Standard Schema（bi_sales_table.yaml）"""
    schema = load_bi_sales_schema()
    return schema


@router.post("/transform", response_model=TransformResponse)
def transform_csv(
    body: TransformRequest,
    current: Annotated[User, Depends(get_current_user)],
):
    """將 CSV 依 mapping 轉換為 Standard Schema 格式（預覽用）"""
    schema = load_bi_sales_schema()
    if not schema:
        raise HTTPException(status_code=500, detail="Schema 載入失敗")
    rows = transform_csv_to_schema(body.csv_content, body.mapping, schema)
    return TransformResponse(rows=rows, row_count=len(rows))


@router.get("/mapping-templates", response_model=list[MappingTemplateItem])
def list_mapping_templates(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出使用者的 mapping 範本（bi_sales_table）"""
    rows = (
        db.query(UserSchemaMapping)
        .filter(
            UserSchemaMapping.user_id == current.id,
            UserSchemaMapping.schema_id == SCHEMA_ID,
        )
        .order_by(UserSchemaMapping.updated_at.desc())
        .all()
    )
    return [
        MappingTemplateItem(
            template_name=r.template_name,
            csv_headers=json.loads(r.csv_headers) if r.csv_headers else None,
        )
        for r in rows
    ]


@router.get("/mapping-templates/{template_name}", response_model=MappingTemplateDetail)
def get_mapping_template(
    template_name: str,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得指定範本的 mapping"""
    row = (
        db.query(UserSchemaMapping)
        .filter(
            UserSchemaMapping.user_id == current.id,
            UserSchemaMapping.schema_id == SCHEMA_ID,
            UserSchemaMapping.template_name == template_name,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="範本不存在")
    return MappingTemplateDetail(
        template_name=row.template_name,
        mapping=json.loads(row.mapping),
        csv_headers=json.loads(row.csv_headers) if row.csv_headers else None,
    )


@router.post("/mapping-templates", response_model=MappingTemplateDetail)
def save_mapping_template(
    body: SaveMappingRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """儲存 mapping 範本（upsert）"""
    template_name = (body.template_name or "").strip()
    if not template_name:
        raise HTTPException(status_code=400, detail="範本名稱不可為空")
    if not body.mapping:
        raise HTTPException(status_code=400, detail="mapping 不可為空，請先設定欄位對應")
    mapping_json = json.dumps(body.mapping)
    csv_headers_json = json.dumps(body.csv_headers) if body.csv_headers else None

    row = (
        db.query(UserSchemaMapping)
        .filter(
            UserSchemaMapping.user_id == current.id,
            UserSchemaMapping.schema_id == SCHEMA_ID,
            UserSchemaMapping.template_name == template_name,
        )
        .first()
    )
    if row:
        row.mapping = mapping_json
        row.csv_headers = csv_headers_json
        db.commit()
        db.refresh(row)
    else:
        row = UserSchemaMapping(
            user_id=current.id,
            schema_id=SCHEMA_ID,
            template_name=template_name,
            mapping=mapping_json,
            csv_headers=csv_headers_json,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return MappingTemplateDetail(
        template_name=row.template_name,
        mapping=json.loads(row.mapping),
        csv_headers=json.loads(row.csv_headers) if row.csv_headers else None,
    )


@router.delete("/mapping-templates/{template_name}", status_code=204)
def delete_mapping_template(
    template_name: str,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除 mapping 範本"""
    row = (
        db.query(UserSchemaMapping)
        .filter(
            UserSchemaMapping.user_id == current.id,
            UserSchemaMapping.schema_id == SCHEMA_ID,
            UserSchemaMapping.template_name == template_name,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="範本不存在")
    db.delete(row)
    db.commit()


@router.post("/sync-duckdb", response_model=SyncResponse)
def sync_to_duckdb(
    body: SyncRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    """轉換 CSV 並同步至 DuckDB（Test01 POC 使用 test01_{user_id} 作為 project_id）"""
    schema = load_bi_sales_schema()
    if not schema:
        raise HTTPException(status_code=500, detail="Schema 載入失敗")
    rows = transform_csv_to_schema(body.csv_content, body.mapping, schema)
    project_id = f"test01_{current.id}"
    ok, row_count, err_detail = sync_transformed_rows_to_duckdb(project_id, rows)
    msg = f"DuckDB 已同步 ({row_count} 筆)" if ok else f"DuckDB 同步失敗：{err_detail}" if err_detail else "DuckDB 同步失敗"

    # 同步成功且提供 template_name 時，儲存 mapping 到範本
    if ok and body.template_name and body.template_name.strip():
        template_name = body.template_name.strip()
        schema_mapping = _reverse_mapping(body.mapping)  # csv_col->schema 轉 schema->csv_col
        mapping_json = json.dumps(schema_mapping)
        csv_headers_json = json.dumps(body.csv_headers) if body.csv_headers else None
        row = (
            db.query(UserSchemaMapping)
            .filter(
                UserSchemaMapping.user_id == current.id,
                UserSchemaMapping.schema_id == SCHEMA_ID,
                UserSchemaMapping.template_name == template_name,
            )
            .first()
        )
        if row:
            row.mapping = mapping_json
            row.csv_headers = csv_headers_json
            db.commit()
        else:
            row = UserSchemaMapping(
                user_id=current.id,
                schema_id=SCHEMA_ID,
                template_name=template_name,
                mapping=mapping_json,
                csv_headers=csv_headers_json,
            )
            db.add(row)
            db.commit()

    return SyncResponse(ok=ok, message=msg, row_count=row_count, error_detail=err_detail)
