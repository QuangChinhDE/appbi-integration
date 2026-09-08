"""Executions and per-node results (SRS 22.7, 22.8).

An execution row is written before anything is dispatched, and it names the
exact artefact it ran: `workflow_version_id` for a published run, or
`draft_snapshot` for a draft test. That is what lets history stay true while
the draft keeps moving (UAT-005).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, DateTime, Enum as SAEnum, ForeignKey, ForeignKeyConstraint,
    Index, Integer, String, Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.enums import ExecutionStatus, NodeRunStatus, TriggerType, VersionKind


class Execution(Base):
    __tablename__ = "executions"
    __table_args__ = (
        # The workspace on this row and the workspace of its workflow are the
        # same workspace, enforced by the database. Both columns are here and
        # nothing stopped them disagreeing: a bug anywhere in the write path
        # could file tenant A's run against tenant B's workflow, and every
        # later read -- correctly filtered by `workspace_id` -- would then hide
        # the row from the tenant it belonged to.
        ForeignKeyConstraint(
            ["workspace_id", "workflow_id"],
            ["workflows.workspace_id", "workflows.id"],
            name="fk_executions_workflow_same_workspace",
            ondelete="CASCADE",
        ),
        Index("ix_executions_ws_workflow_started", "workspace_id", "workflow_id", "started_at"),
        Index("ix_executions_ws_status_queued", "workspace_id", "status", "queued_at"),
        # The worker's claim query. Deliberately not workspace-scoped: the
        # dispatcher works across tenants and orders by queue time.
        Index("ix_executions_dispatch", "status", "queued_at"),
        # Partial *unique*, not just an index. The service checks for an
        # existing row before inserting, but a read followed by a write is not
        # a claim: two clicks of Run arriving together both read nothing and
        # both insert. Only the database can settle that, and the loser of the
        # race is caught and answered with the winner's row (SRS 27.4).
        #
        # Partial because `idempotency_key` is null for most runs -- a plain
        # unique constraint would allow exactly one keyless execution per
        # workflow, since Postgres treats nulls as distinct only outside a
        # NULLS NOT DISTINCT declaration.
        Index(
            "uq_executions_idempotency",
            "workspace_id", "workflow_id", "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    #: Short, human-quotable handle for support ("Execution #A17F"). Product
    #: UUIDs are for APIs; nobody reads one over the phone (SRS 76).
    short_id: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True)
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False, index=True)
    version_kind: Mapped[VersionKind] = mapped_column(
        SAEnum(VersionKind, name="version_kind"), nullable=False)
    workflow_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workflow_versions.id", ondelete="SET NULL"),
        nullable=True)
    version_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    draft_revision: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: The frozen graph this run executed. A draft run cannot re-read the draft
    #: at dispatch time -- by then the user may have changed it, and the run
    #: would not be reproducible.
    graph_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    graph_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    trigger_type: Mapped[TriggerType] = mapped_column(
        SAEnum(TriggerType, name="trigger_type"), nullable=False)
    triggered_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    retry_of_execution_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("executions.id", ondelete="SET NULL"), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)

    status: Mapped[ExecutionStatus] = mapped_column(
        SAEnum(ExecutionStatus, name="execution_status"),
        default=ExecutionStatus.QUEUED, nullable=False)
    error_category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Which node failed, so the list screen can name it without loading every
    #: node result.
    failed_node_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: Last time the engine confirmed this run exists. The reconciler compares
    #: it against `execution_stale_after_seconds` (ADR-010).
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    #: Sanitized. What arrived (size, content type, source), not the body.
    input_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    #: What the *screen* shows: redacted, arrays capped, long strings cut.
    #: Never handed to the engine -- that is what `start_payload_sealed` is
    #: for. These were one column, and the redacted value was the one that
    #: ran, so a workflow received `********` where the caller sent a token
    #: and fifty items where they sent sixty.
    start_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    #: What the *engine* receives: the caller's payload, exactly, Fernet-sealed
    #: with the credential key. This is the one place a webhook body is
    #: retained (SRS 57 says do not persist raw bodies by default) and it is
    #: retained because a retry has to re-send what was originally sent.
    start_payload_sealed: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    #: Admin-only. Engine instance, compiler version, adapter timings. Never
    #: serialised on the public execution endpoint (SRS 61).
    technical_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    #: Opaque engine handle, backend-only. Never leaves the adapter layer.
    engine_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    engine_instance_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("engine_instances.id"), nullable=True)
    trace_id: Mapped[str] = mapped_column(String(48), nullable=False, default="")

    node_results: Mapped[list["ExecutionNodeResult"]] = relationship(
        back_populates="execution", cascade="all, delete-orphan",
        order_by="ExecutionNodeResult.execution_index")


class ExecutionNodeResult(Base):
    """One node run inside an execution (SRS 16.6).

    `input_preview` / `output_preview` are truncated and redacted at write
    time, not at read time: a preview that has to be sanitized on every request
    is a preview that will eventually be served raw by a new endpoint.
    """

    __tablename__ = "execution_node_results"
    __table_args__ = (
        Index("ix_node_results_execution", "execution_id", "node_id", "execution_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    execution_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("executions.id", ondelete="CASCADE"),
        nullable=False, index=True)
    #: The product node id from the graph, not an engine index.
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    node_key: Mapped[str] = mapped_column(String(64), nullable=False)
    node_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[NodeRunStatus] = mapped_column(
        SAEnum(NodeRunStatus, name="node_run_status"), nullable=False)
    execution_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    item_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_preview: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    output_preview: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    truncated: Mapped[bool] = mapped_column(default=False, nullable=False)
    error_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    #: Which output port produced items, so the canvas can show that an IF went
    #: down its false branch.
    branch_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    execution: Mapped[Execution] = relationship(back_populates="node_results")


class ExecutionLogLine(Base):
    """Sanitized, product-owned execution log.

    Not the engine's stdout: the engine normalizes its lifecycle into these
    lines so a log page can be paginated and served without ever handing a raw
    stack trace to a browser.
    """

    __tablename__ = "execution_logs"
    __table_args__ = (Index("ix_execution_logs_exec_seq", "execution_id", "sequence"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    execution_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("executions.id", ondelete="CASCADE"),
        nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="INFO")
    node_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
