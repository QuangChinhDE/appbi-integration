"""Envelope-encrypted secret payloads (SRS 21.1).

Separate module so `app.core.secrets` can import the table without pulling in
the whole model package -- the same cycle-avoidance the pipeline app needed.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin


class SecretRecord(Base, TimestampMixin):
    """Never joined into an API response. Read only at execution time."""

    __tablename__ = "secrets"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ref: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The data key, wrapped with the KEK. Rotating the KEK rewraps these few
    #: dozen bytes and never touches the ciphertext.
    wrapped_data_key: Mapped[str] = mapped_column(Text, nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    #: Field names only, so the UI can show which fields are configured
    #: without the store ever handing back a value.
    field_names: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
