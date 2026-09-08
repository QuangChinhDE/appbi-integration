"""Overview and monitoring (SRS 18).

Read-only aggregates over the product database. Deliberately does not call the
engine: the overview screen has to render during an engine outage, and the one
piece of engine state it shows (health) is fetched separately so its failure
degrades one card rather than the page (SRS 9.6).
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.permissions import Action, Module
from app.engine.registry import get_adapter
from app.models.catalog import EngineInstance
from app.models.enums import (
    ACTIVE_EXECUTION_STATUSES, CredentialStatus, EngineStatus, ExecutionStatus,
    TriggerType, WorkflowStatus,
)
from app.models.execution import Execution, ExecutionNodeResult
from app.models.ops import Notification
from app.models.workflow import Credential, TriggerBinding, Workflow


async def overview(session: AsyncSession, ctx: RequestContext) -> dict[str, Any]:
    ctx.require(Module.MONITORING, Action.VIEW)
    workspace = ctx.workspace_id
    now = utcnow()

    total_workflows = await _count(
        session, select(func.count(Workflow.id)).where(
            Workflow.workspace_id == workspace, Workflow.deleted_at.is_(None)))
    active_workflows = await _count(
        session, select(func.count(Workflow.id)).where(
            Workflow.workspace_id == workspace,
            Workflow.deleted_at.is_(None),
            Workflow.status == WorkflowStatus.ACTIVE))
    draft_only = await _count(
        session, select(func.count(Workflow.id)).where(
            Workflow.workspace_id == workspace,
            Workflow.deleted_at.is_(None),
            Workflow.published_version_id.is_(None)))
    running_now = await _count(
        session, select(func.count(Execution.id)).where(
            Execution.workspace_id == workspace,
            Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES))))
    failed_24h = await _count(
        session, select(func.count(Execution.id)).where(
            Execution.workspace_id == workspace,
            Execution.status.in_([
                ExecutionStatus.FAILED, ExecutionStatus.TIMED_OUT,
                ExecutionStatus.ENGINE_INTERRUPTED, ExecutionStatus.FAILED_TO_START]),
            Execution.queued_at >= now - timedelta(hours=24)))
    credentials_attention = await _count(
        session, select(func.count(Credential.id)).where(
            Credential.workspace_id == workspace,
            Credential.deleted_at.is_(None),
            Credential.status.in_([CredentialStatus.INVALID, CredentialStatus.REVOKED])))
    unread_alerts = await _count(
        session, select(func.count(Notification.id)).where(
            Notification.workspace_id == workspace,
            Notification.status == "UNREAD"))

    success_rate = await _success_rate(session, workspace, days=7)

    recent_failures = list((await session.scalars(
        select(Execution)
        .where(
            Execution.workspace_id == workspace,
            Execution.status.in_([
                ExecutionStatus.FAILED, ExecutionStatus.TIMED_OUT,
                ExecutionStatus.ENGINE_INTERRUPTED]),
        )
        .order_by(Execution.queued_at.desc())
        .limit(5)
    )).all())
    running = list((await session.scalars(
        select(Execution)
        .where(
            Execution.workspace_id == workspace,
            Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES)),
        )
        .order_by(Execution.queued_at.desc())
        .limit(5)
    )).all())
    upcoming = list((await session.scalars(
        select(TriggerBinding)
        .where(
            TriggerBinding.workspace_id == workspace,
            TriggerBinding.enabled.is_(True),
            TriggerBinding.trigger_type == TriggerType.SCHEDULE,
            TriggerBinding.next_run_at.isnot(None),
        )
        .order_by(TriggerBinding.next_run_at)
        .limit(5)
    )).all())

    names = await _workflow_names(
        session,
        workspace,
        {row.workflow_id for row in recent_failures}
        | {row.workflow_id for row in running}
        | {row.workflow_id for row in upcoming},
    )

    return {
        "stats": {
            "total_workflows": total_workflows,
            "active_workflows": active_workflows,
            "draft_only": draft_only,
            "running_now": running_now,
            "failed_24h": failed_24h,
            "success_rate_7d": success_rate,
            "credentials_needing_attention": credentials_attention,
            "unread_alerts": unread_alerts,
        },
        "recent_failures": [
            {
                "execution_id": row.id,
                "short_id": row.short_id,
                "workflow_id": row.workflow_id,
                "workflow_name": names.get(row.workflow_id),
                "status": row.status.value,
                "error_code": row.error_code,
                "failed_node_name": row.failed_node_name,
                "ended_at": row.ended_at,
            }
            for row in recent_failures
        ],
        "running": [
            {
                "execution_id": row.id,
                "short_id": row.short_id,
                "workflow_id": row.workflow_id,
                "workflow_name": names.get(row.workflow_id),
                "status": row.status.value,
                "started_at": row.started_at,
                "queued_at": row.queued_at,
            }
            for row in running
        ],
        "upcoming_schedules": [
            {
                "workflow_id": row.workflow_id,
                "workflow_name": names.get(row.workflow_id),
                "next_run_at": row.next_run_at,
            }
            for row in upcoming
        ],
    }


async def monitoring(session: AsyncSession, ctx: RequestContext) -> dict[str, Any]:
    """The operational dimensions from SRS 18.2."""
    ctx.require(Module.MONITORING, Action.VIEW)
    workspace = ctx.workspace_id
    now = utcnow()
    window_start = now - timedelta(days=7)

    durations = list((await session.scalars(
        select(Execution.duration_ms).where(
            Execution.workspace_id == workspace,
            Execution.duration_ms.isnot(None),
            Execution.queued_at >= window_start,
        )
    )).all())
    durations = sorted(d for d in durations if d is not None)

    queue_waits = list((await session.scalars(
        select(
            func.extract("epoch", Execution.started_at - Execution.queued_at) * 1000
        ).where(
            Execution.workspace_id == workspace,
            Execution.started_at.isnot(None),
            Execution.queued_at >= window_start,
        )
    )).all())
    queue_waits = sorted(int(w) for w in queue_waits if w is not None)

    by_category = list((await session.execute(
        select(Execution.error_category, func.count(Execution.id))
        .where(
            Execution.workspace_id == workspace,
            Execution.error_category.isnot(None),
            Execution.queued_at >= window_start,
        )
        .group_by(Execution.error_category)
        .order_by(func.count(Execution.id).desc())
    )).all())

    failing_nodes = list((await session.execute(
        select(
            ExecutionNodeResult.node_key,
            ExecutionNodeResult.node_name,
            func.count(ExecutionNodeResult.id),
        )
        .join(Execution, Execution.id == ExecutionNodeResult.execution_id)
        .where(
            Execution.workspace_id == workspace,
            ExecutionNodeResult.status == "FAILED",
            Execution.queued_at >= window_start,
        )
        .group_by(ExecutionNodeResult.node_key, ExecutionNodeResult.node_name)
        .order_by(func.count(ExecutionNodeResult.id).desc())
        .limit(10)
    )).all())

    webhook_runs = await _count(
        session, select(func.count(Execution.id)).where(
            Execution.workspace_id == workspace,
            Execution.trigger_type == TriggerType.WEBHOOK,
            Execution.queued_at >= window_start))
    schedule_runs = await _count(
        session, select(func.count(Execution.id)).where(
            Execution.workspace_id == workspace,
            Execution.trigger_type == TriggerType.SCHEDULE,
            Execution.queued_at >= window_start))
    manual_runs = await _count(
        session, select(func.count(Execution.id)).where(
            Execution.workspace_id == workspace,
            Execution.trigger_type == TriggerType.MANUAL,
            Execution.queued_at >= window_start))

    missed = await _count(
        session, select(func.count(TriggerBinding.id)).where(
            TriggerBinding.workspace_id == workspace,
            TriggerBinding.enabled.is_(True),
            TriggerBinding.next_run_at.isnot(None),
            TriggerBinding.next_run_at < now - timedelta(minutes=5)))

    return {
        "window_days": 7,
        "success_rate_7d": await _success_rate(session, workspace, days=7),
        "duration_ms": {
            "p50": _percentile(durations, 0.5),
            "p95": _percentile(durations, 0.95),
            "count": len(durations),
        },
        "queue_wait_ms": {
            "p50": _percentile(queue_waits, 0.5),
            "p95": _percentile(queue_waits, 0.95),
        },
        "failures_by_category": [
            {"category": category, "count": count} for category, count in by_category
        ],
        "failing_nodes": [
            {"node_key": key, "node_name": name, "count": count}
            for key, name, count in failing_nodes
        ],
        "runs_by_trigger": {
            "WEBHOOK": webhook_runs,
            "SCHEDULE": schedule_runs,
            "MANUAL": manual_runs,
        },
        "schedules_late": missed,
    }


async def _workflow_names(
    session: AsyncSession, workspace_id: uuid.UUID, ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Names for a set of workflow ids, within one tenant.

    Takes the workspace even though the ids come from rows that were already
    filtered by it: a lookup that accepts an arbitrary id set and answers with
    a name is exactly the shape that leaks one tenant's labels into another's
    dashboard the first time a caller forgets.
    """
    if not ids:
        return {}
    rows = list((await session.scalars(
        select(Workflow).where(
            Workflow.workspace_id == workspace_id,
            Workflow.id.in_(ids),
        )
    )).all())
    return {row.id: row.name for row in rows}


async def _count(session: AsyncSession, statement) -> int:
    return int(await session.scalar(statement) or 0)


async def _success_rate(
    session: AsyncSession, workspace_id: uuid.UUID, *, days: int
) -> float | None:
    """Share of finished runs that succeeded.

    Cancelled runs are excluded from both sides: a person stopping a run is not
    a reliability event, and counting cancellations as failures makes the number
    lie during a debugging session.
    """
    row = (await session.execute(
        select(
            func.count(Execution.id),
            func.sum(case((Execution.status == ExecutionStatus.SUCCEEDED, 1), else_=0)),
        ).where(
            Execution.workspace_id == workspace_id,
            Execution.queued_at >= utcnow() - timedelta(days=days),
            Execution.status.in_([
                ExecutionStatus.SUCCEEDED, ExecutionStatus.FAILED,
                ExecutionStatus.TIMED_OUT, ExecutionStatus.ENGINE_INTERRUPTED,
                ExecutionStatus.FAILED_TO_START,
            ]),
        )
    )).first()
    total, succeeded = int(row[0] or 0), int(row[1] or 0)
    if total == 0:
        # None, not 100%: "no runs yet" and "everything worked" are different
        # answers and the UI shows them differently.
        return None
    return round(succeeded * 100.0 / total, 1)


def _percentile(sorted_values: list[int], fraction: float) -> int | None:
    if not sorted_values:
        return None
    index = min(len(sorted_values) - 1, int(round(fraction * (len(sorted_values) - 1))))
    return sorted_values[index]


# ── engine health / compatibility ──────────────────────────────────────────
async def engine_status(session: AsyncSession, ctx: RequestContext) -> dict[str, Any]:
    """Engine health for the banner and the admin screen.

    Never raises: the adapter answers "offline" instead, because this endpoint
    is polled from every page and an outage must not turn into an error toast on
    every screen.
    """
    ctx.require(Module.SETTINGS, Action.VIEW)
    adapter = get_adapter()
    health = await adapter.health()

    instance = await session.scalar(
        select(EngineInstance).where(EngineInstance.is_default.is_(True)))
    if instance is not None:
        instance.status = (
            EngineStatus.HEALTHY if health.status == "HEALTHY"
            else EngineStatus.DEGRADED if health.reachable
            else EngineStatus.OFFLINE
        )
        instance.engine_version = health.engine_version or instance.engine_version
        instance.adapter_contract_version = (
            health.adapter_contract_version or instance.adapter_contract_version)
        instance.compiler_version = health.compiler_version or instance.compiler_version
        instance.last_probe_at = utcnow()
        instance.last_probe_message = health.message
        await session.flush()

    return {
        "operational": health.reachable and health.status == "HEALTHY",
        "status": health.status,
        "message": health.message,
        # Engine *versions* are operational facts an admin needs; the engine's
        # address is not, and never appears here (SRS 61).
        "engine_version": health.engine_version,
        "adapter_contract_version": health.adapter_contract_version
        or settings.adapter_contract_version,
        "compiler_version": health.compiler_version,
        "product_version": settings.product_version,
        "latency_ms": health.latency_ms,
        "loaded_nodes": health.loaded_nodes if ctx.is_platform_admin else [],
    }


async def compatibility(session: AsyncSession, ctx: RequestContext) -> dict[str, Any]:
    """Registry vs runtime (SRS 35.9).

    The interesting output is drift: a node the product offers that the engine
    cannot compile is a workflow somebody will build and then fail to publish.
    """
    ctx.require(Module.SETTINGS, Action.VIEW)
    from app.services import catalog

    adapter = get_adapter()
    definitions = await catalog.definitions_map(session)
    product_keys = sorted(definitions)

    engine_keys: list[str] = []
    reachable = True
    try:
        capabilities = await adapter.capabilities()
        engine_keys = sorted(capabilities.supported_node_keys)
        features = capabilities.features
        engine_version = capabilities.engine_version
        contract = capabilities.contract_version
        compiler = capabilities.compiler_version
    except Exception:  # noqa: BLE001 - reported as a state, not raised
        reachable = False
        features, engine_version, contract, compiler = {}, None, None, None

    return {
        "product_version": settings.product_version,
        "engine": {
            "reachable": reachable,
            "engine_version": engine_version,
            "contract_version": contract,
            "compiler_version": compiler,
            "features": features,
        },
        "nodes": [
            {
                "node_key": key,
                "display_name": definitions[key]["display_name"],
                "certification": definitions[key]["certification"],
                "status": definitions[key]["status"],
                "engine_supported": (not reachable) or key in engine_keys,
                "engine_binding": definitions[key]["engine_binding"]
                if ctx.is_platform_admin else None,
            }
            for key in product_keys
        ],
        "drift": {
            "product_only": [k for k in product_keys if reachable and k not in engine_keys],
            "engine_only": [k for k in engine_keys if k not in product_keys],
        },
    }
