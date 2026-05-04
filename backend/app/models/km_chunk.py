"""KmChunk ORM：km_chunks 表，文件切片與向量 Embedding"""
from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSON, TSVECTOR
from sqlalchemy.orm import backref, relationship

from app.core.database import Base


class KmChunk(Base):
    __tablename__ = "km_chunks"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    document_id = Column(
        Integer,
        ForeignKey("km_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(768), nullable=True)
    content_tsv = Column(TSVECTOR, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)

    document = relationship("KmDocument", backref=backref("chunks", passive_deletes=True), lazy="select")
