"""BI Schema API：列出、新增、修改、刪除 bi_schemas"""
import uuid

from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.core.database import get_db
from app.models import BiSchema
from app.models.user import User

router = APIRouter()


@router.get("/", response_model=list[dict])
async def list_bi_schemas(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """取得所有 bi_schemas（供下拉選單使用）"""
    rows = db.query(BiSchema).order_by(BiSchema.id).all()
    return [
        {"id": r.id, "name": r.name, "desc": r.desc, "is_template": r.is_template}
        for r in rows
    ]


@router.get("/{schema_id}", response_model=dict)
async def get_bi_schema(
    schema_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """取得單一 bi_schema（供編輯使用）"""
    row = db.query(BiSchema).filter(BiSchema.id == schema_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schema 不存在")
    data = dict(row.schema_json) if row.schema_json else {}
    data.setdefault("id", row.id)
    data.setdefault("name", row.name)
    return {
        "id": row.id,
        "name": row.name,
        "desc": row.desc,
        "is_template": row.is_template,
        "schema_json": data,
    }


@router.post("/", status_code=201)
async def create_bi_schema(
    body: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """新增 bi_schema。body: { id?, name, desc?, schema_json }；id 省略時自動產生 UUID。"""
    sid_raw = body.get("id")
    sid = (sid_raw or "").strip() if sid_raw is not None else ""
    if not sid:
        sid = str(uuid.uuid4())
    name = (body.get("name") or "").strip()
    schema_json = body.get("schema_json")
    if not name:
        raise HTTPException(status_code=400, detail="name 必填")
    if not schema_json or not isinstance(schema_json, dict):
        raise HTTPException(status_code=400, detail="schema_json 必填且須為物件")
    if db.query(BiSchema).filter(BiSchema.id == sid).first():
        raise HTTPException(status_code=400, detail=f"Schema id 已存在：{sid}")
    schema_json["id"] = sid
    schema_json["name"] = name
    row = BiSchema(
        id=sid,
        name=name,
        desc=body.get("desc") or None,
        schema_json=schema_json,
        user_id=current.id,
        is_template=False,
    )
    db.add(row)
    db.commit()
    return {"id": sid, "name": name}


@router.put("/{schema_id}")
async def update_bi_schema(
    schema_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """修改 bi_schema。body: { name?, desc?, schema_json? }"""
    row = db.query(BiSchema).filter(BiSchema.id == schema_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schema 不存在")
    if row.is_template:
        raise HTTPException(status_code=403, detail="系統範本無法修改")
    if "name" in body and body["name"] is not None:
        row.name = str(body["name"]).strip() or row.name
    if "desc" in body:
        row.desc = str(body["desc"]).strip() if body["desc"] else None
    if "schema_json" in body and isinstance(body["schema_json"], dict):
        schema_json = dict(body["schema_json"])
        schema_json.setdefault("id", schema_id)
        schema_json.setdefault("name", row.name)
        row.schema_json = schema_json
    db.commit()
    return {"id": schema_id}


@router.delete("/{schema_id}", status_code=204)
async def delete_bi_schema(
    schema_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """刪除 bi_schema"""
    row = db.query(BiSchema).filter(BiSchema.id == schema_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schema 不存在")
    if row.is_template:
        raise HTTPException(status_code=403, detail="系統範本無法刪除")
    db.delete(row)
    db.commit()
