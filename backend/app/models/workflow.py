"""Workflow domain: identity, draft, immutable versions, trigger bindings.

Three tables for what a user calls "a workflow", because they are three
different things with three different lifetimes (ADR-009):

* `workflows` is the stable identity a URL points at;
* `workflow_drafts` is the mutable graph, guarded by an optimistic `revision`;
* `workflow_versions` are immutable snapshots, one per publish.

There is no `n8n_workflow_id` column here, and there must never be one
(guardrail 5). The engine holds no business identity.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String,
    Text, UniqueConstraint, text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, TimestampMixin
from app.models.enums import (
    CredentialStatus, CredentialType, OverlapPolicy, TriggerType, WorkflowStatus,
)


class Workflow(Base, TimestampMixin):
    __tablename__ = "workflows"
    __table_args__ = (
        Index("ix_workflows_ws_status_updated", "workspace_id", "status", "updated_at"),
        Index("ix_workflows_ws_active_version", "workspace_id", "active_version_id"),
        # Redundant on its own -- `id` is already the primary key -- and it
        # exists so `executions` can point a composite foreign key at it. That
        # is what makes an execution filed against another tenant's workflow
        # impossible to write, rather than merely something every query
        # remembers to filter out.
        UniqueConstraint("workspace_id", "id", name="uq_workflows_workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[WorkflowStatus] = mapped_column(
        SAEnum(WorkflowStatus, name="workflow_status"),
        default=WorkflowStatus.INACTIVE, nullable=False)

    # `use_alter` on both: workflows points at a version and a version points
    # back at its workflow, which is a genuine cycle. Without it neither
    # `create_all` nor Alembic can order the two CREATE TABLEs, and the
    # migration fails on a clean database with "relation workflows does not
    # exist". Declaring them as ALTERs lets the tables be created in any order
    # and the constraints added afterwards.
    #: Latest published version, whether or not it is the one running.
    published_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("workflow_versions.id", ondelete="SET NULL", use_alter=True),
        nullable=True)
    #: The exact version a trigger will fire. Publishing does not move this;
    #: activating does (SRS 69.3), which is what makes "edit an active
    #: workflow" safe.
    active_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("workflow_versions.id", ondelete="SET NULL", use_alter=True),
        nullable=True)
    #: Denormalized for the list screen so rendering 200 rows does not join
    #: through trigger bindings. Written by TriggerService, never by hand.
    trigger_type_cache: Mapped[TriggerType | None] = mapped_column(
        SAEnum(TriggerType, name="trigger_type"), nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    draft: Mapped["WorkflowDraft"] = relationship(
        back_populates="workflow", cascade="all, delete-orphan", uselist=False,
        lazy="selectin")
    versions: Mapped[list["WorkflowVersion"]] = relationship(
        back_populates="workflow", cascade="all, delete-orphan",
        foreign_keys="WorkflowVersion.workflow_id")
    triggers: Mapped[list["TriggerBinding"]] = relationship(
        back_populates="workflow", cascade="all, delete-orphan", lazy="selectin")


class WorkflowDraft(Base):
    """The graph the editor is writing to.

    `revision` is the whole concurrency story: every save states the revision
    it read, and a mismatch is a 409 rather than a silent overwrite of somebody
    else's canvas (SRS 14.6).
    """

    __tablename__ = "workflow_drafts"

    workflow_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"),
        primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), nullable=False, index=True)
    #: {"nodes": [...], "connections": [...]}. Never contains a plaintext
    #: secret -- a node references a credential by id (guardrail: SRS 22.3).
    graph_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    graph_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    product_schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    revision: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default=sa_text("0"), nullable=False)
    #: Last validation result, sanitized. Cached so the list screen can show
    #: "needs attention" without re-validating every row.
    validation_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    saved_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False)

    workflow: Mapped[Workflow] = relationship(back_populates="draft")


class WorkflowVersion(Base):
    """Immutable. Nothing updates a row in this table.

    A run binds to one of these by id, so execution history stays truthful
    after the draft has moved on ten revisions (UAT-005, UAT-006).
    """

    __tablename__ = "workflow_versions"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version_number", name="uq_version_workflow_number"),
        Index("ix_versions_workflow_number", "workflow_id", "version_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False, index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    graph_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    graph_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    product_schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    #: What compiled it and what it was certified against. Stored per version so
    #: a regression after an engine upgrade can be attributed rather than
    #: guessed at (SRS 25.6).
    compiler_version: Mapped[str] = mapped_column(String(32), nullable=False, default="1")
    engine_compatibility_set: Mapped[str] = mapped_column(
        String(64), nullable=False, default="")
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    workflow: Mapped[Workflow] = relationship(
        back_populates="versions", foreign_keys=[workflow_id])


class TriggerBinding(Base, TimestampMixin):
    """What makes a published version reachable from the outside world.

    One row per workflow in V1 (SRS 17.1): exactly one start trigger. The row
    survives deactivation so a webhook URL is stable across activate/deactivate
    cycles -- rotating it silently would break every caller.
    """

    __tablename__ = "trigger_bindings"
    __table_args__ = (
        Index("ix_triggers_due", "enabled", "next_run_at"),
        UniqueConstraint("public_key", name="uq_trigger_public_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False, index=True)
    #: The exact version this binding fires. Set at activate time.
    workflow_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflow_versions.id", ondelete="SET NULL"),
        nullable=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), nullable=False, index=True)
    trigger_type: Mapped[TriggerType] = mapped_column(
        SAEnum(TriggerType, name="trigger_type"), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    #: Sanitized trigger config: schedule shape, webhook method/auth mode. The
    #: webhook shared secret is not here -- it lives in the secret store.
    config_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    #: Random, not a product UUID: a guessable public path is an invitation to
    #: enumerate workflows (SRS 17.3).
    public_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    webhook_secret_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    last_fired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    overlap_policy: Mapped[OverlapPolicy] = mapped_column(
        SAEnum(OverlapPolicy, name="overlap_policy"),
        default=OverlapPolicy.SKIP_IF_RUNNING, nullable=False)
    activated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    workflow: Mapped[Workflow] = relationship(back_populates="triggers")


class Credential(Base, TimestampMixin):
    """Product-owned credential metadata. The secret is in the secret store.

    n8n has a credentials database; this product does not use it (ADR-006). The
    engine receives a resolved payload for one execution and keeps nothing.
    """

    __tablename__ = "credentials"
    __table_args__ = (
        Index("ix_credentials_ws_status", "workspace_id", "status"),
        UniqueConstraint("workspace_id", "name", name="uq_credential_ws_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    credential_type: Mapped[CredentialType] = mapped_column(
        SAEnum(CredentialType, name="credential_type"), nullable=False)
    #: Opaque handle into the secret store. Not a secret itself.
    secret_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Non-sensitive fields the UI may show: header name, query parameter name,
    #: username. Never a token, never a password.
    public_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[CredentialStatus] = mapped_column(
        SAEnum(CredentialStatus, name="credential_status"),
        default=CredentialStatus.ACTIVE, nullable=False)
    last_test_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_test_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rotated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
