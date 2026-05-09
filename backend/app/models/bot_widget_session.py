from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class BotWidgetSession(Base):
    __tablename__ = "bot_widget_sessions"

    id = Column(String(64), primary_key=True, comment="Session UUID（前端 localStorage）")
    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="CASCADE"), nullable=False, index=True)
    visitor_name = Column(String(100), nullable=True)
    visitor_email = Column(String(200), nullable=True)
    visitor_phone = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_active_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    messages = relationship(
        "BotWidgetMessage",
        back_populates="session",
        order_by="BotWidgetMessage.created_at",
        cascade="all, delete-orphan",
    )


class BotWidgetMessage(Base):
    __tablename__ = "bot_widget_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(
        String(64),
        ForeignKey("bot_widget_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(20), nullable=False, comment="user | assistant")
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("BotWidgetSession", back_populates="messages")
