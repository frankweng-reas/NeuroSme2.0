"""BiProjects API：建立、列表、更新、刪除商務分析專案"""
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.bi_project import BiProject
from app.models.user import User
from app.models.user_schema_mapping import UserSchemaMapping
from app.schemas.bi_project import BiProjectCreate, BiProjectResponse, BiProjectUpdate
from app.services.bi_sources_utils import get_merged_csv_for_project
from app.services.csv_transform import transform_csv_to_schema
from app.services.duckdb_store import delete_project_duckdb, get_project_duckdb_path, get_project_duckdb_row_count, sync_project_csv_to_duckdb, sync_transformed_rows_to_duckdb
from app.services.permission import get_agent_ids_for_user
from app.services.schema_loader import load_bi_sales_schema

SCHEMA_ID = "bi_sales_table"


class ImportCsvFileItem(BaseModel):
    file_name: str
    content: str


class ImportCsvBlockItem(BaseModel):
    template_name: str
    files: list[ImportCsvFileItem]


class ImportCsvRequest(BaseModel):
    blocks: list[ImportCsvBlockItem]

router = APIRouter()


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


def _check_agent_access(db: Session, user: User, agent_id: str) -> tuple[str, str]:
    """驗證使用者有權限存取該 agent"""
    tenant_id, aid = _parse_agent_id(agent_id, user.tenant_id)
    if tenant_id != user.tenant_id:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    catalog = db.query(AgentCatalog).filter(AgentCatalog.id == aid).first()
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed = get_agent_ids_for_user(db, user.id)
    if catalog.id not in allowed:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return tenant_id, aid


@router.post("/", response_model=BiProjectResponse)
def create_bi_project(
    body: BiProjectCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增商務分析專案"""
    tenant_id, agent_id = _check_agent_access(db, current, body.agent_id)

    name = (body.project_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="專案名稱不可為空")

    proj = BiProject(
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=agent_id,
        project_name=name,
        project_desc=(body.project_desc or "").strip() or None,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return BiProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        conversation_data=proj.conversation_data,
    )


@router.get("/", response_model=list[BiProjectResponse])
def list_bi_projects(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 agent 的商務分析專案列表"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    projects = (
        db.query(BiProject)
        .filter(
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .order_by(BiProject.created_at.desc())
        .all()
    )
    return [
        BiProjectResponse(
            project_id=p.project_id,
            project_name=p.project_name,
            project_desc=p.project_desc,
            created_at=p.created_at,
            conversation_data=p.conversation_data,
        )
        for p in projects
    ]


@router.patch("/{project_id}", response_model=BiProjectResponse)
def update_bi_project(
    project_id: str,
    body: BiProjectUpdate,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新商務分析專案（名稱、描述、對話紀錄）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.project_name is not None:
        name = (body.project_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="專案名稱不可為空")
        proj.project_name = name
    if body.project_desc is not None:
        proj.project_desc = (body.project_desc or "").strip() or None
    if body.conversation_data is not None:
        proj.conversation_data = body.conversation_data

    db.commit()
    db.refresh(proj)
    return BiProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        conversation_data=proj.conversation_data,
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bi_project(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> None:
    """刪除商務分析專案（bi_sources 會因 CASCADE 一併刪除）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    pid = str(proj.project_id)
    db.delete(proj)
    db.commit()
    delete_project_duckdb(pid)


@router.post("/{project_id}/sync-duckdb", status_code=status.HTTP_200_OK)
def sync_duckdb(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """手動同步專案 CSV 至 DuckDB（若已啟用長存）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    db.expire_all()  # 強制從 DB 重讀，避免 session 快取舊資料
    merged = get_merged_csv_for_project(db, project_id)
    ok, row_count = sync_project_csv_to_duckdb(project_id, merged)
    msg = f"DuckDB 已同步 ({row_count} 筆)" if ok else "DuckDB 未啟用或同步失敗"
    path = get_project_duckdb_path(project_id)
    return {"ok": ok, "message": msg, "row_count": row_count, "path": str(path) if path else None}


def _reverse_mapping(m: dict[str, str]) -> dict[str, str]:
    """schema_field -> csv_header 轉為 csv_header -> schema_field（供 transform_csv_to_schema 使用）"""
    return {v: k for k, v in m.items() if k and v}


@router.post("/{project_id}/import-csv", status_code=status.HTTP_200_OK)
def import_csv_to_duckdb(
    project_id: str,
    body: ImportCsvRequest,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """依 mapping template 將 CSV 轉換為 Standard Schema 後匯入 DuckDB"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    schema = load_bi_sales_schema()
    if not schema:
        raise HTTPException(status_code=500, detail="Schema 載入失敗")

    all_rows: list[dict[str, Any]] = []
    for block in body.blocks:
        if not block.template_name or not block.files:
            continue
        row = (
            db.query(UserSchemaMapping)
            .filter(
                UserSchemaMapping.user_id == current.id,
                UserSchemaMapping.schema_id == SCHEMA_ID,
                UserSchemaMapping.template_name == block.template_name,
            )
            .first()
        )
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Mapping 範本「{block.template_name}」不存在",
            )
        mapping_schema_to_csv = json.loads(row.mapping)
        mapping_csv_to_schema = _reverse_mapping(mapping_schema_to_csv)
        for f in block.files:
            if not f.content or not f.content.strip():
                continue
            rows = transform_csv_to_schema(f.content, mapping_csv_to_schema, schema)
            all_rows.extend(rows)

    if not all_rows:
        return {"ok": True, "message": "無有效資料可匯入", "row_count": 0}

    ok, row_count, err_detail = sync_transformed_rows_to_duckdb(project_id, all_rows)
    msg = f"DuckDB 已匯入 ({row_count} 筆)" if ok else f"DuckDB 匯入失敗：{err_detail}" if err_detail else "DuckDB 匯入失敗"
    return {"ok": ok, "message": msg, "row_count": row_count}


@router.get("/{project_id}/duckdb-status", status_code=status.HTTP_200_OK)
def get_duckdb_status(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """取得專案 DuckDB 資料筆數"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    row_count = get_project_duckdb_row_count(project_id)
    return {"row_count": row_count if row_count is not None else 0, "has_data": row_count is not None and row_count > 0}
