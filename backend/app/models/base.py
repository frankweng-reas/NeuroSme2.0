"""Mixin：為 model 提供 created_at、updated_at 欄位"""
from datetime import datetime
from sqlalchemy import Column, DateTime


class TimestampMixin:
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
