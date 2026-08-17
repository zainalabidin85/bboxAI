from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    secret_hash: Mapped[str] = mapped_column(String(128))
    pairing_code: Mapped[str | None] = mapped_column(String(6), nullable=True, index=True)
    pairing_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
