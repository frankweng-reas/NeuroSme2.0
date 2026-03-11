"""Companies API：公司資訊維護（admin 權限）"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.company import Company
from app.models.user import User
from app.schemas.company import CompanyCreate, CompanyResponse, CompanyUpdate

router = APIRouter()


def _is_admin_or_super(user: User) -> bool:
    return user.role in ("admin", "super_admin")


@router.get("/", response_model=list[CompanyResponse])
def list_companies(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得公司列表（需 admin 權限）"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    companies = (
        db.query(Company)
        .order_by(Company.sort_order.asc().nulls_last(), Company.legal_name.asc().nulls_last())
        .all()
    )
    return [CompanyResponse.model_validate(c) for c in companies]


def _to_response(c: Company) -> CompanyResponse:
    return CompanyResponse(
        id=str(c.id), legal_name=c.legal_name, tax_id=c.tax_id, logo_url=c.logo_url,
        address=c.address, phone=c.phone, email=c.email, contact=c.contact, sort_order=c.sort_order,
        quotation_terms=c.quotation_terms,
    )


@router.post("/", response_model=CompanyResponse)
def create_company(
    body: CompanyCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增公司（需 admin 權限）"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    company = Company(
        legal_name=body.legal_name,
        tax_id=body.tax_id,
        logo_url=body.logo_url,
        address=body.address,
        phone=body.phone,
        email=body.email,
        contact=body.contact,
        sort_order=body.sort_order,
        quotation_terms=body.quotation_terms,
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return _to_response(company)


@router.patch("/{company_id}", response_model=CompanyResponse)
def update_company(
    company_id: UUID,
    body: CompanyUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新公司（需 admin 權限）"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(company, k, v)
    db.commit()
    db.refresh(company)
    return _to_response(company)


@router.delete("/{company_id}")
def delete_company(
    company_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除公司（需 admin 權限）"""
    if not _is_admin_or_super(current):
        raise HTTPException(status_code=403, detail="需 admin 權限")
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()
    return {"ok": True}
