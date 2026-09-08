"""Audit, alerts and notifications (SRS 19, 20)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Integer,
    String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin
from app.models.enums import (
    ActorType, AlertEventType, AuditResult, NotificationStatus,
)


class AuditEvent(Base):
    """Append-only. Never updated, never deleted by product code.

    `before_summary` / `after_summary` are sanitized on write. A credential
    change records that it happened and which fields moved, never a value
    (SRS 20.2: never log secret, header, token, password).
    """

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_ws_created", "workspace_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), nullable=False, index=True)
    actor_type: Mapped[ActorType] = mapped_column(
        SAEnum(ActorType, name="actor_type"), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    actor_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Dotted product action: `workflow.publish`, `credential.rotate`.
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    resource_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result: Mapped[AuditResult] = mapped_column(
        SAEnum(AuditResult, name="audit_result"), default=AuditResult.SUCCESS, nullable=False)
    before_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    trace_id: Mapped[str] = mapped_column(String(48), nullable=False, default="")
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True)


class AlertRule(Base, TimestampMixin):
    __tablename__ = "alert_rules"
    __table_args__ = (Index("ix_alert_rules_ws_event", "workspace_id", "event_type"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True)
    event_type: Mapped[AlertEventType] = mapped_column(
        SAEnum(AlertEventType, name="alert_event_type"), nullable=False)
    #: Null means every workflow in the workspace.
    workflow_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=True)
    threshold: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    channel: Mapped[str] = mapped_column(String(32), default="IN_APP", nullable=False)
    #: Dedup window. Without one, a workflow failing every minute on a schedule
    #: produces 1,440 identical notifications a day and the feature becomes
    #: something people mute (SRS 19.3).
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=900, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_ws_status_created", "workspace_id", "status", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), nullable=False, index=True)
    event_type: Mapped[AlertEventType] = mapped_column(
        SAEnum(AlertEventType, name="alert_event_type"), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default="ERROR", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    workflow_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    execution_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    #: `workspace + workflow + event_type + error fingerprint`, used to
    #: suppress duplicates inside the rule's cooldown window.
    dedup_key: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    status: Mapped[NotificationStatus] = mapped_column(
        SAEnum(NotificationStatus, name="notification_status"),
        default=NotificationStatus.UNREAD, nullable=False)
    remediation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RateLimitBucket(Base):
    """One fixed window of one rate-limited thing (SRS 68.2).

    In the database rather than in each process, because the limit has to mean
    the same thing however many API replicas are running. An in-process
    counter multiplies the configured limit by the replica count -- and the
    number it is multiplied by changes when somebody scales the deployment,
    which is the worst property a security control can have.

    A *fixed* window, not a sliding one. A sliding window needs the timestamp
    of every hit; a fixed window needs one row and one atomic statement, and
    the failure mode -- up to twice the rate across a window boundary -- is
    bounded and understood. Correct across replicas beats precise on one.
    """

    __tablename__ = "rate_limit_buckets"
    #: The prune predicate. A small table, but the prune runs every minute in
    #: every deployment.
    __table_args__ = (Index("ix_rate_limit_buckets_updated_at", "updated_at"),)

    #: `scope:subject`, e.g. `webhook:3f2a...`. Opaque to the database.
    bucket_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    #: Start of the window this count belongs to, as a whole number of seconds
    #: since the epoch. Comparing it is how a stale count is reset rather than
    #: continued.
    window_start: Mapped[int] = mapped_column(BigInteger, nullable=False)
    hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False)

