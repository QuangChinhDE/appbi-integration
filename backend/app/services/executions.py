"""Execution service: the run saga (SRS 16, 27.3).

The order of operations is the whole design:

1. write the execution row and commit it, *then* dispatch. A run that exists in
   the engine but not in the database is unattributable; a run in the database
   that never reached the engine is recoverable (FAILED_TO_START, retry).
2. freeze the graph into the execution row at creation time. A draft run must be
   reproducible even after the user keeps editing.
3. resolve credentials at dispatch, in the worker, and never store them.

The browser never waits for a workflow. Creation answers 202 and the FE polls
(SRS 82).
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.errors import (
    AppError, EngineUnavailableError, NotFoundError, QuotaExceededError,
    ValidationError, error_from_matrix, remediation_for,
)
from app.core.logging import log_event
from app.core.permissions import Action, Module
from app.core import payload_vault
from app.core.redaction import preview as make_preview, redact
from app.engine.dto import EngineExecutionRequest, EngineExecutionStatus, RuntimeCredential
from app.engine.registry import get_adapter
from app.models.enums import (
    ACTIVE_EXECUTION_STATUSES, ExecutionStatus, NodeRunStatus, TriggerType, VersionKind,
)
from app.models.execution import Execution, ExecutionLogLine, ExecutionNodeResult
from app.models.identity import Workspace
from app.models.workflow import Workflow, WorkflowVersion
from app.services import audit, catalog, credentials
from app.services.graph import collect_credential_ids, validate_graph

logger = logging.getLogger(__name__)


def _short_id() -> str:
    """A six-character handle people can read out loud (SRS 76).

    Not a truncated UUID: the alphabet excludes the characters that get misread
    over a phone call. Six of them rather than four -- four would be a million
    values, and a workspace that runs a workflow every minute would start
    seeing two runs with the same handle inside a year.
    """
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


async def _by_idempotency_key(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    workflow_id: uuid.UUID,
    key: str,
) -> Execution | None:
    """The run a given key already produced, if any.

    The three columns are exactly the unique index's, so a hit here and a
    violation there always describe the same row.
    """
    return await session.scalar(
        select(Execution).where(
            Execution.workspace_id == workspace_id,
            Execution.workflow_id == workflow_id,
            Execution.idempotency_key == key,
        )
    )


# ── creation ───────────────────────────────────────────────────────────────
async def create(
    session: AsyncSession,
    ctx: RequestContext,
    workflow_id: uuid.UUID,
    *,
    kind: VersionKind,
    trigger_type: TriggerType,
    start_payload: Any = None,
    idempotency_key: str | None = None,
    retry_of: uuid.UUID | None = None,
    version_id: uuid.UUID | None = None,
) -> Execution:
    """Create a QUEUED execution against an exact artefact.

    Does not call the engine. The worker does that, which is what keeps the API
    responsive and makes a dispatch failure retryable rather than fatal.
    """
    from app.services import workflows as workflow_service

    ctx.require(Module.WORKFLOWS, Action.EXECUTE)
    workflow = await workflow_service.get_workflow(session, ctx, workflow_id)

    if idempotency_key:
        existing = await _by_idempotency_key(
            session, ctx.workspace_id, workflow.id, idempotency_key)
        if existing is not None:
            # Same key, same answer. A double-submitted Run button or a retried
            # webhook must not produce two runs (SRS 27.4). This is the common
            # case -- the second request arrives after the first committed. The
            # simultaneous case is settled by the unique index, below.
            return existing

    # Serialise the count-then-insert for this workspace.
    #
    # `_check_concurrency` counts active runs and the insert happens several
    # lines later. Two requests arriving together both counted `ceiling - 1`
    # and both inserted, so a workspace capped at 10 could reach 12 -- the
    # quota was a number the product displayed rather than one it kept. Two
    # clicks of the same key were already handled by the unique index; two
    # *different* keys were not, and nothing tested that case.
    #
    # A transaction-scoped advisory lock rather than `SELECT ... FOR UPDATE`:
    # there is no row to lock. The thing being protected is the *absence* of
    # rows, which is exactly what a predicate lock is for and exactly what row
    # locking cannot express. Released when the transaction ends, however it
    # ends.
    #
    # Scoped to the workspace, so tenants never wait on each other; within a
    # workspace the serialised section is two counts and an insert.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, hashtext(:key))"),
        {"namespace": _CONCURRENCY_LOCK_NAMESPACE, "key": str(ctx.workspace_id)},
    )

    try:
        await _check_concurrency(session, ctx, workflow)
    except AppError:
        # A replay must never be refused for concurrency.
        #
        # There is a window between the lookup above and this check: the first
        # request can commit inside it, so the lookup finds nothing and the
        # ceiling then sees the run the lookup was looking for. Without this,
        # a retry storm on one key returns nine copies of the same execution
        # and one WORKFLOW_ALREADY_RUNNING -- and the caller that got the error
        # cannot tell "your request was ignored because it already ran" from
        # "your request was rejected", which is the entire point of a key.
        #
        # The winner is committed by definition here: it is the row the
        # ceiling just counted.
        if not idempotency_key:
            raise
        winner = await _by_idempotency_key(
            session, ctx.workspace_id, workflow.id, idempotency_key)
        if winner is None:
            # The workflow really is busy with a *different* run. The refusal
            # stands.
            raise
        log_event(logger, logging.INFO, "execution.idempotent_replay",
                  execution_id=str(winner.id), workflow_id=str(workflow.id),
                  detail="returned in place of a concurrency refusal")
        return winner

    if kind is VersionKind.DRAFT:
        draft = workflow.draft
        if draft is None:
            raise NotFoundError("Workflow chưa có draft để chạy.")
        graph = draft.graph_json or {}
        version_number = None
        draft_revision = draft.revision
        resolved_version_id = None
    else:
        version = None
        if version_id is not None:
            version = await session.get(WorkflowVersion, version_id)
        elif workflow.active_version_id:
            version = await session.get(WorkflowVersion, workflow.active_version_id)
        elif workflow.published_version_id:
            version = await session.get(WorkflowVersion, workflow.published_version_id)
        if version is None or version.workflow_id != workflow.id:
            raise error_from_matrix("WORKFLOW_NOT_PUBLISHED")
        graph = version.graph_json or {}
        version_number = version.version_number
        draft_revision = None
        resolved_version_id = version.id

    definitions = await catalog.definitions_map(session)
    validation = validate_graph(graph, definitions)
    if not validation.ok:
        raise error_from_matrix(
            "WORKFLOW_INVALID",
            details={"issues": [i.as_dict() for i in validation.issues]},
        )

    from app.services.graph import graph_hash

    execution = Execution(
        short_id=_short_id(),
        workspace_id=ctx.workspace_id,
        workflow_id=workflow.id,
        version_kind=kind,
        workflow_version_id=resolved_version_id,
        version_number=version_number,
        draft_revision=draft_revision,
        # Frozen here, deliberately. Reading the draft again at dispatch would
        # mean a run that cannot be reproduced from its own record.
        graph_snapshot=graph,
        graph_hash=graph_hash(graph),
        trigger_type=trigger_type,
        triggered_by=ctx.user_id,
        retry_of_execution_id=retry_of,
        idempotency_key=idempotency_key,
        status=ExecutionStatus.QUEUED,
        queued_at=utcnow(),
        input_metadata=_input_metadata(start_payload),
        # Two values, two jobs. The preview is what every execution screen
        # reads; the sealed one is what actually runs. They used to be the same
        # column, holding the redacted value, so the engine executed
        # `********` in place of whatever the caller sent.
        start_payload=_sanitize_payload(start_payload),
        start_payload_sealed=payload_vault.seal(start_payload),
        trace_id=ctx.trace_id,
        engine_instance_id=None,
    )
    if idempotency_key:
        # A savepoint, because a failed INSERT aborts the transaction it runs
        # in: without one, catching the IntegrityError would leave a session
        # that can no longer be used to read the row that caused it.
        try:
            async with session.begin_nested():
                session.add(execution)
                await session.flush()
        except IntegrityError:
            winner = await _by_idempotency_key(
                session, ctx.workspace_id, workflow.id, idempotency_key)
            if winner is None:
                # A unique violation on this table with this key can only be
                # the idempotency index. If the row is not there, something
                # else is wrong and guessing would hide it.
                raise
            log_event(logger, logging.INFO, "execution.idempotent_replay",
                      execution_id=str(winner.id), workflow_id=str(workflow.id))
            return winner
    else:
        session.add(execution)
        await session.flush()

    await audit.record(
        session, ctx,
        action="execution.queued" if not retry_of else "execution.retry_created",
        resource_type="EXECUTION", resource_id=execution.id,
        resource_label=f"{workflow.name} #{execution.short_id}",
        after={
            "trigger": trigger_type.value,
            "version_kind": kind.value,
            "version": version_number,
            "retry_of": str(retry_of) if retry_of else None,
        },
    )
    log_event(logger, logging.INFO, "execution.queued",
              execution_id=str(execution.id), workflow_id=str(workflow.id),
              trigger=trigger_type.value, version_kind=kind.value)
    return execution


#: Distinguishes this product's advisory locks from anybody else's on the same
#: database. Arbitrary but fixed -- two features picking the same key by
#: accident would block each other for reasons nobody could find.
_CONCURRENCY_LOCK_NAMESPACE = 0x41504249  # "APBI"


async def _check_concurrency(
    session: AsyncSession, ctx: RequestContext, workflow: Workflow
) -> None:
    """One active run per workflow by default (SRS 30.3).

    Two runs of the same automation overlapping is almost never what anyone
    wants: they write to the same external system. The workspace ceiling is the
    second guard, against one tenant starving the engine.
    """
    per_workflow = int(await session.scalar(
        select(func.count(Execution.id)).where(
            Execution.workspace_id == ctx.workspace_id,
            Execution.workflow_id == workflow.id,
            Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES)),
        )
    ) or 0)
    if per_workflow >= settings.max_concurrent_executions_per_workflow:
        raise error_from_matrix("WORKFLOW_ALREADY_RUNNING")

    per_workspace = int(await session.scalar(
        select(func.count(Execution.id)).where(
            Execution.workspace_id == ctx.workspace_id,
            Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES)),
        )
    ) or 0)
    ceiling = await workspace_ceiling(session, ctx.workspace_id)
    if per_workspace >= ceiling:
        raise QuotaExceededError(
            f"Workspace đang có {per_workspace} lần chạy chưa kết thúc "
            f"(giới hạn {ceiling}).",
            remediation={"action": "WAIT_OR_CANCEL"},
        )


async def workspace_ceiling(
    session: AsyncSession, workspace_id: uuid.UUID
) -> int:
    """How many runs this tenant may have in flight at once.

    The tenant's own quota when provisioning set one, otherwise the
    deployment-wide default. Enforced here rather than only stored, because a
    quota that is displayed and not applied is worse than no quota: it is a
    number a customer is told and a limit nobody honours.

    A per-request query. It is one indexed primary-key lookup on the path that
    is about to write an execution row and call an engine, and reading it live
    is what makes `python -m app.provision quota ...` take effect immediately
    rather than at the next restart.
    """
    workspace = await session.get(Workspace, workspace_id)
    configured = workspace.max_concurrent_executions if workspace else None
    if configured is not None and configured > 0:
        return int(configured)
    return settings.max_concurrent_executions_per_workspace


def _input_metadata(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {"kind": "EMPTY", "item_count": 0}
    if isinstance(payload, list):
        return {"kind": "LIST", "item_count": len(payload)}
    return {"kind": "OBJECT", "item_count": 1}


def _sanitize_payload(payload: Any) -> Any:
    """The version the screens read.

    A webhook body is the most likely place in the product for a token to
    arrive, and this row is read by every execution detail screen -- so it is
    redacted, arrays are capped and long strings cut. None of that reaches the
    engine: see `_payload_for_engine`.
    """
    if payload is None:
        return None
    return redact(payload)


def _payload_for_engine(execution: Execution) -> Any:
    """What the workflow actually receives.

    The sealed payload, which is the caller's own. Falling back to the redacted
    preview only for rows written before sealing existed, or whose ciphertext
    will not open under the current key -- and saying so, loudly, because a run
    quietly receiving a truncated and masked version of its input is the defect
    this function was written to end.
    """
    if execution.start_payload_sealed:
        opened = payload_vault.unseal(execution.start_payload_sealed)
        if opened is not None:
            return opened
        log_event(
            logger, logging.ERROR, "execution.payload_fell_back_to_preview",
            execution_id=str(execution.id),
            workspace_id=str(execution.workspace_id),
        )
    return execution.start_payload if execution.start_payload is not None else {}


# ── dispatch (worker) ──────────────────────────────────────────────────────
async def dispatch(session: AsyncSession, execution: Execution) -> None:
    """Hand a queued execution to the engine.

    Called by the worker, never by a request. Failure modes are distinguished:
    an unavailable engine leaves the run QUEUED for another attempt, while a
    graph the engine refuses is FAILED_TO_START because retrying will not help.
    """
    adapter = get_adapter()
    definitions = await catalog.definitions_map(session)
    graph = execution.graph_snapshot or {}

    credential_ids = collect_credential_ids(graph, definitions)
    resolved = await credentials.resolve_for_execution(
        session, execution.workspace_id, credential_ids)

    execution.status = ExecutionStatus.DISPATCHING
    execution.last_seen_at = utcnow()
    await session.flush()
    await session.commit()

    request = EngineExecutionRequest(
        execution_id=str(execution.id),
        workspace_ref=str(execution.workspace_id),
        graph=graph,
        registry=catalog.registry_snapshot(definitions),
        start_payload=_payload_for_engine(execution),
        credentials=[
            RuntimeCredential(
                credential_id=item["credential_id"],
                credential_type=item["credential_type"],
                data=item["data"],
            )
            for item in resolved
        ],
        trace_id=execution.trace_id,
        # The execution id is the idempotency key on the engine side: a retried
        # dispatch of the same row must not start a second engine run.
        idempotency_key=str(execution.id),
        timeout_seconds=settings.execution_max_runtime_seconds,
        egress_policy={
            "allow_private_networks": settings.egress_allow_private_networks,
            "allowed_hosts": settings.egress_allowed_host_list,
            "blocked_hosts": settings.egress_blocked_host_list,
            "max_redirects": settings.egress_max_redirects,
            "max_response_bytes": settings.egress_max_response_bytes,
            "request_timeout_seconds": settings.egress_request_timeout_seconds,
        },
    )

    try:
        ref = await adapter.execute(request)
    except EngineUnavailableError as exc:
        # Recoverable, but not forever (Wave 0D, D-W0-11).
        #
        # Requeueing alone retried indefinitely: every attempt re-enters this
        # function, which sets `last_seen_at = utcnow()` before calling the
        # engine, so the reconciler's staleness reference was refreshed on each
        # pass and `_interrupt_if_stale` could never fire. With the engine
        # stopped, a run sat active for as long as anyone watched -- observed
        # still DISPATCHING after 200s against a 120s window. ADR-010 exists to
        # prevent exactly that, and its "never dispatched" branch was
        # unreachable for this path.
        #
        # Giving up is decided here rather than in the reconciler on purpose.
        # Widening `active_executions` to include QUEUED would let the
        # reconciler fail *legitimately queued* work during a backlog, because
        # a queued run older than the window is indistinguishable from a
        # stranded one from the outside. Here we already know why it is queued.
        waited = utcnow() - execution.queued_at
        if waited > timedelta(seconds=settings.execution_stale_after_seconds):
            execution.status = ExecutionStatus.FAILED_TO_START
            execution.error_code = "ENGINE_UNAVAILABLE"
            execution.error_category = exc.category.value
            execution.error_summary = exc.message
            execution.ended_at = utcnow()
            await session.flush()
            log_event(logger, logging.ERROR, "execution.failed_to_start",
                      execution_id=str(execution.id), code=exc.code,
                      waited_seconds=int(waited.total_seconds()))
            await _on_terminal(session, execution)
            return

        # The engine's own idempotency on execution_id makes a duplicate
        # dispatch safe if the call actually landed.
        execution.status = ExecutionStatus.QUEUED
        execution.error_code = "ENGINE_UNAVAILABLE"
        execution.error_summary = exc.message
        await session.flush()
        log_event(logger, logging.WARNING, "execution.dispatch_deferred",
                  execution_id=str(execution.id), reason=exc.code)
        return
    except AppError as exc:
        execution.status = ExecutionStatus.FAILED_TO_START
        execution.error_code = exc.code
        execution.error_category = exc.category.value
        execution.error_summary = exc.message
        execution.ended_at = utcnow()
        execution.technical_metadata = {
            **(execution.technical_metadata or {}),
            "dispatch_error": exc.technical_message,
        }
        await session.flush()
        log_event(logger, logging.ERROR, "execution.failed_to_start",
                  execution_id=str(execution.id), code=exc.code)
        await _on_terminal(session, execution)
        return

    execution.engine_ref = ref.ref
    execution.status = ExecutionStatus.RUNNING
    execution.started_at = execution.started_at or utcnow()
    execution.last_seen_at = utcnow()
    await session.flush()
    log_event(logger, logging.INFO, "execution.dispatched",
              execution_id=str(execution.id), engine_ref=ref.ref)


async def poll(session: AsyncSession, execution: Execution) -> None:
    """Ask the engine how a running execution is doing, and ingest the answer."""
    if not execution.engine_ref:
        return
    adapter = get_adapter()
    try:
        status = await adapter.get_execution(execution.engine_ref)
    except EngineUnavailableError:
        # Leave it alone. The reconciler decides when silence has lasted long
        # enough to call the run interrupted; one failed poll is not that.
        return
    except AppError as exc:
        if exc.code == "ENGINE_EXECUTION_UNKNOWN":
            # A positive answer: the engine does not have this run. That is the
            # crash case (ADR-010), not a transport problem.
            await mark_interrupted(session, execution, "Engine không còn thông tin lần chạy này.")
            return
        raise

    await ingest(session, execution, status)


async def ingest(
    session: AsyncSession, execution: Execution, status: EngineExecutionStatus
) -> None:
    """Write a normalized engine status onto the execution row.

    Idempotent: polling twice must not duplicate node results, which is why the
    existing rows are replaced rather than appended to.
    """
    execution.last_seen_at = utcnow()

    if status.status == ExecutionStatus.RUNNING.value:
        if execution.status is ExecutionStatus.DISPATCHING:
            execution.status = ExecutionStatus.RUNNING
            execution.started_at = execution.started_at or utcnow()
        await session.flush()
        return

    previous = list((await session.scalars(
        select(ExecutionNodeResult).where(ExecutionNodeResult.execution_id == execution.id)
    )).all())
    for row in previous:
        await session.delete(row)

    for result in status.node_results:
        session.add(ExecutionNodeResult(
            execution_id=execution.id,
            node_id=result.node_id,
            node_key=_node_key_for(execution, result.node_id),
            node_name=result.node_name,
            status=NodeRunStatus(result.status),
            execution_index=result.execution_index,
            started_at=_parse(result.started_at),
            ended_at=_parse(result.ended_at),
            duration_ms=result.duration_ms,
            item_count=result.item_count,
            # Redacted a second time on the way in. The engine already did it;
            # doing it here too means neither side is the single point of
            # failure for a leaked token (SRS 21.3).
            input_preview=_bounded_preview(result.input_preview),
            output_preview=_bounded_preview(result.output_preview),
            truncated=result.truncated,
            error_json=redact(result.error) if result.error else None,
            branch_metadata=result.branch_metadata or {},
        ))

    existing_logs = list((await session.scalars(
        select(ExecutionLogLine).where(ExecutionLogLine.execution_id == execution.id)
    )).all())
    for row in existing_logs:
        await session.delete(row)

    for index, line in enumerate(status.logs):
        session.add(ExecutionLogLine(
            execution_id=execution.id,
            sequence=index,
            at=_parse(line.at) or utcnow(),
            level=line.level,
            node_name=line.node_name,
            message=line.message[:4000],
        ))

    execution.status = ExecutionStatus(status.status)
    execution.started_at = _parse(status.started_at) or execution.started_at
    execution.ended_at = _parse(status.ended_at) or utcnow()
    execution.duration_ms = status.duration_ms
    execution.error_code = status.error_code
    execution.error_category = status.error_category
    execution.error_summary = status.error_message
    execution.failed_node_name = status.failed_node_name
    execution.output_summary = status.output_summary or {}
    execution.technical_metadata = {
        **(execution.technical_metadata or {}),
        **(status.technical or {}),
    }
    await session.flush()

    log_event(logger, logging.INFO, "execution.terminal",
              execution_id=str(execution.id), status=execution.status.value,
              duration_ms=execution.duration_ms, error_code=execution.error_code)
    await _on_terminal(session, execution)


def _node_key_for(execution: Execution, node_id: str) -> str:
    for node in (execution.graph_snapshot or {}).get("nodes") or []:
        if str(node.get("id")) == node_id:
            return str(node.get("node_key") or "unknown")
    return "unknown"


def _bounded_preview(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not payload:
        return None
    items = payload.get("items") if isinstance(payload, dict) else None
    if items is None:
        return redact(payload)
    bounded, truncated = make_preview(
        items, max_bytes=settings.execution_payload_preview_bytes)
    if payload.get("item_count") is not None:
        bounded["item_count"] = payload["item_count"]
    if truncated:
        bounded["note"] = "PREVIEW_TRUNCATED_BY_SIZE"
    return bounded


def _parse(value: str | None):
    if not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def mark_interrupted(
    session: AsyncSession, execution: Execution, reason: str
) -> None:
    """The engine lost the run (ADR-010).

    Never left as RUNNING: an execution that shows "running" for three days is
    worse than one that says it was interrupted, because only the second tells
    the operator to look.
    """
    execution.status = ExecutionStatus.ENGINE_INTERRUPTED
    execution.error_code = "ENGINE_INTERRUPTED"
    execution.error_category = "ENGINE"
    execution.error_summary = reason
    execution.ended_at = utcnow()
    if execution.started_at:
        execution.duration_ms = int(
            (execution.ended_at - execution.started_at).total_seconds() * 1000)
    await session.flush()
    log_event(logger, logging.ERROR, "execution.engine_interrupted",
              execution_id=str(execution.id))
    await _on_terminal(session, execution)


async def _on_terminal(session: AsyncSession, execution: Execution) -> None:
    """Side effects of a run finishing: alerts, and credential health."""
    from app.services import alerts

    if execution.error_code in {"NODE_AUTHENTICATION_FAILED", "CREDENTIAL_INVALID"}:
        # The run told us something the credential itself does not know yet.
        # Marking it is what turns a repeating mystery failure into an
        # ACTION_REQUIRED badge with an Update credential button (journey D).
        definitions = await catalog.definitions_map(session)
        for raw in collect_credential_ids(execution.graph_snapshot or {}, definitions):
            try:
                await credentials.mark_invalid(
                    session, uuid.UUID(raw),
                    execution.error_summary or "Xác thực thất bại khi chạy workflow.")
            except ValueError:
                continue

    await alerts.evaluate_execution(session, execution)


# ── control ────────────────────────────────────────────────────────────────
async def cancel(
    session: AsyncSession, ctx: RequestContext, execution_id: uuid.UUID
) -> Execution:
    """Idempotent (SRS 16.7). Cancelling a finished run reports its state."""
    ctx.require(Module.EXECUTIONS, Action.EXECUTE)
    execution = await get(session, ctx, execution_id)

    if execution.status.is_terminal:
        return execution

    execution.status = ExecutionStatus.CANCEL_REQUESTED
    await session.flush()

    if execution.engine_ref:
        adapter = get_adapter()
        try:
            status = await adapter.cancel(execution.engine_ref)
            await ingest(session, execution, status)
        except EngineUnavailableError:
            # The request is recorded; the reconciler resolves the run when the
            # engine comes back. The UI shows "cancelling", not "cancelled" --
            # claiming a cancel that did not land is worse than showing the
            # intermediate state (SRS 16.7).
            log_event(logger, logging.WARNING, "execution.cancel_deferred",
                      execution_id=str(execution.id))
    else:
        # Never dispatched: the product owns the whole answer.
        execution.status = ExecutionStatus.CANCELLED
        execution.ended_at = utcnow()
        await session.flush()

    await audit.record(
        session, ctx, action="execution.cancel_requested", resource_type="EXECUTION",
        resource_id=execution.id, resource_label=execution.short_id)
    return execution


async def retry(
    session: AsyncSession, ctx: RequestContext, execution_id: uuid.UUID
) -> Execution:
    """A new execution, linked to the old one. The old row is never mutated."""
    ctx.require(Module.EXECUTIONS, Action.EXECUTE)
    original = await get(session, ctx, execution_id)
    if not original.status.is_terminal:
        raise ValidationError(
            "Chỉ có thể chạy lại một lần chạy đã kết thúc.",
            code="EXECUTION_NOT_TERMINAL")

    return await create(
        session, ctx, original.workflow_id,
        kind=original.version_kind,
        trigger_type=original.trigger_type,
        # The caller's payload, not the redacted preview. A retry that re-ran
        # `********` and the first fifty items was not a retry of anything the
        # user did; it re-ran the screen's version of it.
        start_payload=_payload_for_engine(original),
        retry_of=original.id,
        version_id=original.workflow_version_id,
    )


# ── reads ──────────────────────────────────────────────────────────────────
async def get(
    session: AsyncSession, ctx: RequestContext, execution_id: uuid.UUID
) -> Execution:
    row = await session.scalar(
        select(Execution).where(
            Execution.id == execution_id,
            Execution.workspace_id == ctx.workspace_id,
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy lần chạy.")
    return row


def summary_view(execution: Execution, workflow_name: str | None = None) -> dict[str, Any]:
    return {
        "id": execution.id,
        "short_id": execution.short_id,
        "workflow_id": execution.workflow_id,
        "workflow_name": workflow_name,
        "version": {
            "kind": execution.version_kind.value,
            "number": execution.version_number,
            "draft_revision": execution.draft_revision,
        },
        "status": execution.status.value,
        "trigger_type": execution.trigger_type.value,
        "queued_at": execution.queued_at,
        "started_at": execution.started_at,
        "ended_at": execution.ended_at,
        "duration_ms": execution.duration_ms,
        "error_code": execution.error_code,
        "error_category": execution.error_category,
        "error_summary": execution.error_summary,
        "failed_node_name": execution.failed_node_name,
        "retry_of_execution_id": execution.retry_of_execution_id,
        "actions": {
            "can_cancel": execution.status.is_active,
            "can_retry": execution.status.is_terminal,
        },
        "trace_id": execution.trace_id,
    }


def _error_with_remediation(error: dict[str, Any] | None) -> dict[str, Any] | None:
    """A stored node error, plus the next action its code implies.

    The engine records code, category and message; what to *do* about a code is
    a product rule and lives in the UX matrix. Joining them here means the run
    panel reads an answer instead of recomputing one (Wave 0C, D-W0-10).
    """
    if not error:
        return error
    action = remediation_for(error.get("code"))
    if action is None:
        return error
    return {**error, "remediation": action}


async def detail_view(
    session: AsyncSession, ctx: RequestContext, execution: Execution
) -> dict[str, Any]:
    # The node results and log lines below are keyed on the execution id alone,
    # because they carry no workspace column of their own. That makes this
    # function's tenant safety depend entirely on where its `execution`
    # argument came from -- so it is checked here rather than assumed. Every
    # current caller fetches through `get()`, which filters; this is what keeps
    # the next one honest (SRS 4.1).
    if execution.workspace_id != ctx.workspace_id:
        raise NotFoundError("Không tìm thấy lần chạy.")

    workflow = await session.scalar(
        select(Workflow).where(
            Workflow.id == execution.workflow_id,
            Workflow.workspace_id == ctx.workspace_id,
        )
    )
    results = list((await session.scalars(
        select(ExecutionNodeResult)
        .where(ExecutionNodeResult.execution_id == execution.id)
        .order_by(ExecutionNodeResult.execution_index)
    )).all())

    # Payload previews are a separate permission from seeing that a run failed
    # (SRS 4.2): an Auditor reviews the configuration, not the customer records
    # that passed through it.
    may_see_payloads = ctx.can(Module.EXECUTIONS, Action.VIEW_DATA)

    body = summary_view(execution, workflow.name if workflow else None)
    body["nodes"] = [
        {
            "node_id": row.node_id,
            "node_key": row.node_key,
            "node_name": row.node_name,
            "status": row.status.value,
            "execution_index": row.execution_index,
            "started_at": row.started_at,
            "ended_at": row.ended_at,
            "duration_ms": row.duration_ms,
            "item_count": row.item_count,
            "truncated": row.truncated,
            "error": _error_with_remediation(row.error_json),
            "branch_metadata": row.branch_metadata,
            "has_payload": bool(row.output_preview),
        }
        for row in results
    ]
    body["graph"] = execution.graph_snapshot
    body["input_metadata"] = execution.input_metadata
    body["output_summary"] = execution.output_summary
    body["payload_access"] = may_see_payloads
    if ctx.is_platform_admin:
        # Engine instance, compiler version, adapter timings. Admin-only, and
        # the endpoint that serves it writes an audit row (SRS 61).
        body["technical"] = execution.technical_metadata
    return body


async def node_payload(
    session: AsyncSession,
    ctx: RequestContext,
    execution_id: uuid.UUID,
    node_id: str,
    *,
    direction: str,
) -> dict[str, Any]:
    ctx.require(Module.EXECUTIONS, Action.VIEW_DATA)
    execution = await get(session, ctx, execution_id)
    row = await session.scalar(
        select(ExecutionNodeResult).where(
            ExecutionNodeResult.execution_id == execution.id,
            ExecutionNodeResult.node_id == node_id,
        ).order_by(ExecutionNodeResult.execution_index)
    )
    if row is None:
        raise NotFoundError("Không tìm thấy kết quả của bước này.")
    payload = row.input_preview if direction == "input" else row.output_preview
    return {
        "node_id": row.node_id,
        "node_name": row.node_name,
        "direction": direction,
        "preview": payload or {"items": [], "item_count": 0},
        "truncated": row.truncated,
    }


async def logs(
    session: AsyncSession,
    ctx: RequestContext,
    execution_id: uuid.UUID,
    *,
    cursor: int = 0,
    limit: int = 200,
) -> dict[str, Any]:
    ctx.require(Module.EXECUTIONS, Action.VIEW)
    execution = await get(session, ctx, execution_id)
    rows = list((await session.scalars(
        select(ExecutionLogLine)
        .where(
            ExecutionLogLine.execution_id == execution.id,
            ExecutionLogLine.sequence >= cursor,
        )
        .order_by(ExecutionLogLine.sequence)
        .limit(limit)
    )).all())
    return {
        "items": [
            {
                "sequence": row.sequence,
                "at": row.at,
                "level": row.level,
                "node_name": row.node_name,
                "message": row.message,
            }
            for row in rows
        ],
        "page": {
            "next_cursor": rows[-1].sequence + 1 if rows else cursor,
            "has_more": len(rows) == limit,
        },
    }


async def list_executions(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    workflow_id: uuid.UUID | None = None,
    status: str | None = None,
    trigger_type: str | None = None,
    version_kind: str | None = None,
    error_code: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    ctx.require(Module.EXECUTIONS, Action.VIEW)

    statement = select(Execution).where(Execution.workspace_id == ctx.workspace_id)
    if workflow_id:
        statement = statement.where(Execution.workflow_id == workflow_id)
    if status:
        statement = statement.where(Execution.status == ExecutionStatus(status.upper()))
    if trigger_type:
        statement = statement.where(Execution.trigger_type == TriggerType(trigger_type.upper()))
    if version_kind:
        statement = statement.where(Execution.version_kind == VersionKind(version_kind.upper()))
    if error_code:
        statement = statement.where(Execution.error_code == error_code)

    total = int(await session.scalar(
        select(func.count()).select_from(statement.subquery())) or 0)
    rows = list((await session.scalars(
        statement.order_by(Execution.queued_at.desc()).limit(limit).offset(offset)
    )).all())

    names: dict[uuid.UUID, str] = {}
    if rows:
        workflow_rows = list((await session.scalars(
            select(Workflow).where(
                Workflow.workspace_id == ctx.workspace_id,
                Workflow.id.in_({r.workflow_id for r in rows}),
            )
        )).all())
        names = {w.id: w.name for w in workflow_rows}

    running = int(await session.scalar(
        select(func.count(Execution.id)).where(
            Execution.workspace_id == ctx.workspace_id,
            Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES)),
        )
    ) or 0)
    failed_24h = int(await session.scalar(
        select(func.count(Execution.id)).where(
            Execution.workspace_id == ctx.workspace_id,
            Execution.status == ExecutionStatus.FAILED,
            Execution.queued_at >= utcnow() - timedelta(hours=24),
        )
    ) or 0)

    return {
        "items": [summary_view(row, names.get(row.workflow_id)) for row in rows],
        "page": {"total": total, "limit": limit, "offset": offset,
                 "has_more": offset + len(rows) < total},
        "summary": {"total": total, "running": running, "failed_24h": failed_24h},
    }


# ── worker queries ─────────────────────────────────────────────────────────
async def claim_queued(session: AsyncSession, limit: int) -> list[Execution]:
    """Claim queued executions for dispatch.

    `FOR UPDATE SKIP LOCKED` is what makes two workers safe without a broker
    (ADR-011): each claims different rows instead of both dispatching the same
    execution.
    """
    rows = list((await session.scalars(
        select(Execution)
        .where(Execution.status == ExecutionStatus.QUEUED)
        .order_by(Execution.queued_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )).all())
    return rows


async def active_executions(session: AsyncSession, limit: int = 200) -> list[Execution]:
    return list((await session.scalars(
        select(Execution)
        .where(Execution.status.in_([
            ExecutionStatus.DISPATCHING,
            ExecutionStatus.RUNNING,
            ExecutionStatus.CANCEL_REQUESTED,
        ]))
        .order_by(Execution.queued_at)
        .limit(limit)
    )).all())
