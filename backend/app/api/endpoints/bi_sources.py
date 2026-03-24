"""BiSources API：專案來源檔案（商務分析用，含 is_selected）"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bi_project import BiProject
from app.models.bi_source import BiSource
from app.models.user import User
from app.schemas.bi_source import BiSourceCreate, BiSourceResponse, BiSourceUpdate

router = APIRouter()

# 注意：勿在 bi_sources CRUD 自動寫 DuckDB。sync_project_csv_to_duckdb 使用「合併後原始 CSV 表頭」，
# 會覆蓋 import-csv（依 bi_schemas 轉成 col_1…）的結果。需要以 bi_sources 合併內容更新 DuckDB 時，
# 請改呼叫 bi_projects 的 POST /{project_id}/sync-duckdb。

SOURCE_TYPE_DATA = "DATA"


def _check_project_access(db: Session, user: User, project_id: str) -> BiProject:
    """驗證專案屬於該使用者"""
    try:
        pid = UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")
    proj = db.query(BiProject).filter(BiProject.project_id == pid).first()
    if not proj:
        raise HTTPException(status_code=404, detail="專案不存在")
    if proj.user_id != str(user.id):
        raise HTTPException(status_code=403, detail="無權限存取此專案")
    return proj


@router.post("/", response_model=BiSourceResponse)
def create_bi_source(
    body: BiSourceCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增專案來源（商務分析用）"""
    _check_project_access(db, current, body.project_id)

    if body.source_type != SOURCE_TYPE_DATA:
        raise HTTPException(status_code=400, detail=f"source_type 須為 {SOURCE_TYPE_DATA}")

    src = BiSource(
        project_id=UUID(body.project_id),
        source_type=body.source_type,
        file_name=body.file_name.strip(),
        content=body.content,
        is_selected=body.is_selected,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    return BiSourceResponse(
        source_id=str(src.source_id),
        project_id=str(src.project_id),
        source_type=src.source_type,
        file_name=src.file_name,
        content=src.content,
        is_selected=src.is_selected,
        created_at=src.created_at,
    )


@router.get("/", response_model=list[BiSourceResponse])
def list_bi_sources(
    project_id: str = Query(..., description="專案 UUID"),
    source_type: str | None = Query(None, description=f"篩選 {SOURCE_TYPE_DATA}"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得專案的來源列表"""
    _check_project_access(db, current, project_id)

    q = db.query(BiSource).filter(BiSource.project_id == UUID(project_id))
    if source_type:
        if source_type != SOURCE_TYPE_DATA:
            raise HTTPException(status_code=400, detail=f"source_type 須為 {SOURCE_TYPE_DATA}")
        q = q.filter(BiSource.source_type == source_type)
    sources = q.order_by(BiSource.created_at).all()

    return [
        BiSourceResponse(
            source_id=str(s.source_id),
            project_id=str(s.project_id),
            source_type=s.source_type,
            file_name=s.file_name,
            content=s.content,
            is_selected=s.is_selected,
            created_at=s.created_at,
        )
        for s in sources
    ]


@router.patch("/{source_id}", response_model=BiSourceResponse)
def update_bi_source(
    source_id: str,
    body: BiSourceUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新專案來源（檔名、內容、is_selected）"""
    try:
        sid = UUID(source_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="source_id 格式錯誤")

    src = db.query(BiSource).filter(BiSource.source_id == sid).first()
    if not src:
        raise HTTPException(status_code=404, detail="來源不存在")
    _check_project_access(db, current, str(src.project_id))

    if body.file_name is not None:
        name = body.file_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="檔名不可為空")
        if name != src.file_name:
            existing = (
                db.query(BiSource)
                .filter(
                    BiSource.project_id == src.project_id,
                    BiSource.source_type == src.source_type,
                    BiSource.file_name == name,
                )
                .first()
            )
            if existing:
                raise HTTPException(status_code=400, detail="檔名重複")
            src.file_name = name

    if body.content is not None:
        src.content = body.content

    if body.is_selected is not None:
        src.is_selected = body.is_selected

    db.commit()
    db.refresh(src)
    return BiSourceResponse(
        source_id=str(src.source_id),
        project_id=str(src.project_id),
        source_type=src.source_type,
        file_name=src.file_name,
        content=src.content,
        is_selected=src.is_selected,
        created_at=src.created_at,
    )


@router.delete("/{source_id}")
def delete_bi_source(
    source_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除專案來源"""
    try:
        sid = UUID(source_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="source_id 格式錯誤")

    src = db.query(BiSource).filter(BiSource.source_id == sid).first()
    if not src:
        raise HTTPException(status_code=404, detail="來源不存在")
    _check_project_access(db, current, str(src.project_id))

    project_id = str(src.project_id)
    db.delete(src)
    db.commit()
    return None
