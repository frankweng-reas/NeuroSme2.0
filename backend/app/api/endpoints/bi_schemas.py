"""BI Schema API：列出、新增、修改、刪除 bi_schemas"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlalchemy import or_
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.security import get_current_user
from app.core.database import get_db
from app.models import BiSchema
from app.models.user import User

router = APIRouter()

SCHEMA_EDITOR_ROLES = {"manager", "admin", "super_admin"}


def _require_editor(current: User) -> None:
    """manager 以上才可異動 schema；否則拋 403。"""
    if current.role not in SCHEMA_EDITOR_ROLES:
        raise HTTPException(status_code=403, detail="權限不足，需要 manager 以上角色")


@router.get("/", response_model=list[dict])
async def list_bi_schemas(
    agent_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """取得 bi_schemas 清單（供下拉選單使用）。agent_id 傳入時只回傳該 agent 的 schema。"""
    q = db.query(BiSchema)
    if agent_id:
        q = q.filter(or_(BiSchema.agent_id == agent_id, BiSchema.agent_id.is_(None)))
    rows = q.order_by(BiSchema.name).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "desc": r.desc,
            "is_template": r.is_template,
            "agent_id": r.agent_id,
        }
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
        "agent_id": row.agent_id,
        "schema_json": data,
    }


@router.post("/", status_code=201)
async def create_bi_schema(
    body: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """新增 bi_schema。body: { id?, name, desc?, agent_id?, schema_json }；id 省略時自動產生 UUID。"""
    _require_editor(current)
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
        agent_id=body.get("agent_id") or None,
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
    _require_editor(current)
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
        flag_modified(row, "schema_json")
    db.commit()
    return {"id": schema_id}


@router.delete("/{schema_id}", status_code=204)
async def delete_bi_schema(
    schema_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """刪除 bi_schema"""
    _require_editor(current)
    row = db.query(BiSchema).filter(BiSchema.id == schema_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schema 不存在")
    if row.is_template:
        raise HTTPException(status_code=403, detail="系統範本無法刪除")
    db.delete(row)
    db.commit()
