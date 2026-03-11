"""Company API 結構"""
from pydantic import BaseModel, Field, field_validator


class CompanyCreate(BaseModel):
    legal_name: str | None = None
    tax_id: str | None = None
    logo_url: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    contact: str | None = None
    sort_order: str | None = None
    quotation_terms: str | None = None


class CompanyUpdate(BaseModel):
    legal_name: str | None = None
    tax_id: str | None = None
    logo_url: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    contact: str | None = None
    sort_order: str | None = None
    quotation_terms: str | None = None


class CompanyResponse(BaseModel):
    id: str
    legal_name: str | None
    tax_id: str | None
    logo_url: str | None
    address: str | None
    phone: str | None
    email: str | None
    contact: str | None
    sort_order: str | None
    quotation_terms: str | None

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v):
        return str(v) if v is not None else v

    class Config:
        from_attributes = True
