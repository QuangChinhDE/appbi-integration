"""Prometheus-format metrics (SRS 29.3).

Deliberately not under `/api/v1` and not tenant-scoped: these describe the
deployment, not a workspace, and they are not part of the product's versioned
contract. No workspace name or workflow name appears in a label — an unbounded
label set is how a metrics backend falls over, and names are user data.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Response
from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import SessionLocal, utcnow
from app.models.catalog import EngineInstance
from app.models.enums import (
    ACTIVE_EXECUTION_STATUSES, EngineStatus, ExecutionStatus, TriggerType,
)
from app.models.execution import Execution
from app.models.workflow import TriggerBinding, Workflow

router = APIRouter(tags=["system"])


def _line(name: str, value: float | int, labels: dict[str, str] | None = None) -> str:
    if labels:
        rendered = ",".join(f'{key}="{val}"' for key, val in labels.items())
        return f"{name}{{{rendered}}} {value}"
    return f"{name} {value}"


@router.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    lines: list[str] = [
        "# HELP appbi_workflow_build_info Product build information.",
        "# TYPE appbi_workflow_build_info gauge",
        _line("appbi_workflow_build_info", 1, {
            "version": settings.product_version,
            "environment": settings.app_env,
            "engine_type": settings.engine_type,
        }),
    ]

    async with SessionLocal() as session:
        workflows = int(await session.scalar(
            select(func.count(Workflow.id)).where(Workflow.deleted_at.is_(None))) or 0)
        active = int(await session.scalar(
            select(func.count(Workflow.id)).where(
                Workflow.deleted_at.is_(None), Workflow.status == "ACTIVE")) or 0)
        in_flight = int(await session.scalar(
            select(func.count(Execution.id)).where(
                Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES)))) or 0)

        by_status = list((await session.execute(
            select(Execution.status, func.count(Execution.id)).group_by(Execution.status)
        )).all())

        # ── the four numbers an alert can actually fire on ─────────────────
        #
        # The counters above say what exists. These say whether the deployment
        # is *working*, which is a different question and the one a page at
        # 3am is about.

        # How long the oldest queued execution has been waiting. The single
        # best indicator that the worker is wedged: a queue that is deep but
        # moving is fine, a queue whose head is five minutes old is not.
        oldest_queued = await session.scalar(
            select(func.min(Execution.queued_at)).where(
                Execution.status == ExecutionStatus.QUEUED))
        queue_lag = (
            (utcnow() - oldest_queued).total_seconds() if oldest_queued else 0.0)

        # Schedules that should have fired and have not. The product raises its
        # own alert for these (SRS 19.1); this is the same fact for an external
        # monitor, which is what notices when the product itself is down.
        overdue = int(await session.scalar(
            select(func.count(TriggerBinding.id)).where(
                TriggerBinding.enabled.is_(True),
                TriggerBinding.trigger_type == TriggerType.SCHEDULE,
                TriggerBinding.next_run_at.isnot(None),
                TriggerBinding.next_run_at < utcnow() - timedelta(minutes=5),
            )) or 0)

        # Runs the reconciler had to give up on. Nonzero means the engine is
        # losing executions -- restarts, OOM kills, a node draining
        # (ADR-010) -- and it is invisible in a plain success/failure rate.
        interrupted_hour = int(await session.scalar(
            select(func.count(Execution.id)).where(
                Execution.status == ExecutionStatus.ENGINE_INTERRUPTED,
                Execution.queued_at >= utcnow() - timedelta(hours=1),
            )) or 0)

        failed_hour = int(await session.scalar(
            select(func.count(Execution.id)).where(
                Execution.status.in_([
                    ExecutionStatus.FAILED, ExecutionStatus.TIMED_OUT,
                    ExecutionStatus.FAILED_TO_START,
                ]),
                Execution.queued_at >= utcnow() - timedelta(hours=1),
            )) or 0)
        succeeded_hour = int(await session.scalar(
            select(func.count(Execution.id)).where(
                Execution.status == ExecutionStatus.SUCCEEDED,
                Execution.queued_at >= utcnow() - timedelta(hours=1),
            )) or 0)

        # The engine's last probe, as recorded by the worker's housekeeping
        # loop. Read from the database rather than probed here: /metrics is
        # scraped every fifteen seconds and must not become a load generator
        # against the engine.
        engine = await session.scalar(
            select(EngineInstance).where(EngineInstance.is_default.is_(True)))

    lines += [
        "# HELP appbi_workflows_total Workflows that exist.",
        "# TYPE appbi_workflows_total gauge",
        _line("appbi_workflows_total", workflows),
        "# HELP appbi_workflows_active Workflows with an enabled trigger.",
        "# TYPE appbi_workflows_active gauge",
        _line("appbi_workflows_active", active),
        "# HELP appbi_executions_in_flight Executions not yet in a terminal state.",
        "# TYPE appbi_executions_in_flight gauge",
        _line("appbi_executions_in_flight", in_flight),
        "# HELP appbi_executions_total Executions by product status.",
        "# TYPE appbi_executions_total counter",
    ]
    seen = {status.value for status, _ in by_status}
    for status, count in by_status:
        lines.append(_line("appbi_executions_total", int(count),
                           {"status": status.value}))
    # Zero-fill the rest: a status that has never occurred should read 0 rather
    # than be absent, or a dashboard panel shows "no data" for a healthy system.
    for status in ExecutionStatus:
        if status.value not in seen:
            lines.append(_line("appbi_executions_total", 0, {"status": status.value}))

    lines += [
        "# HELP appbi_execution_queue_lag_seconds Age of the oldest queued execution.",
        "# TYPE appbi_execution_queue_lag_seconds gauge",
        _line("appbi_execution_queue_lag_seconds", round(queue_lag, 1)),
        "# HELP appbi_schedules_overdue Enabled schedules more than five minutes late.",
        "# TYPE appbi_schedules_overdue gauge",
        _line("appbi_schedules_overdue", overdue),
        "# HELP appbi_executions_interrupted_1h Runs the reconciler gave up on in the last hour.",
        "# TYPE appbi_executions_interrupted_1h gauge",
        _line("appbi_executions_interrupted_1h", interrupted_hour),
        "# HELP appbi_executions_failed_1h Failed runs in the last hour.",
        "# TYPE appbi_executions_failed_1h gauge",
        _line("appbi_executions_failed_1h", failed_hour),
        "# HELP appbi_executions_succeeded_1h Successful runs in the last hour.",
        "# TYPE appbi_executions_succeeded_1h gauge",
        _line("appbi_executions_succeeded_1h", succeeded_hour),
        # 1 healthy, 0 anything else. A single gauge rather than a label per
        # state: an alert wants "is it up", and the detail is in the product's
        # own engine page.
        "# HELP appbi_engine_healthy Whether the engine's last probe was healthy.",
        "# TYPE appbi_engine_healthy gauge",
        _line("appbi_engine_healthy",
              1 if engine and engine.status is EngineStatus.HEALTHY else 0),
        "# HELP appbi_engine_probe_age_seconds Age of the engine's last probe.",
        "# TYPE appbi_engine_probe_age_seconds gauge",
        _line("appbi_engine_probe_age_seconds",
              round((utcnow() - engine.last_probe_at).total_seconds(), 1)
              if engine and engine.last_probe_at else -1),
        "# HELP appbi_worker_beat_age_seconds Age of the worker's last "
        "housekeeping pass.",
        "# TYPE appbi_worker_beat_age_seconds gauge",
        # The signal that reveals a stopped worker, and the reason it is a
        # separate field: `appbi_engine_probe_age_seconds` is refreshed by the
        # API whenever anyone loads a page that polls engine status, so it
        # stayed fresh with the worker dead and the alert on it could not
        # fire. Only `app.worker` writes this one.
        _line("appbi_worker_beat_age_seconds",
              round((utcnow() - engine.last_worker_beat_at).total_seconds(), 1)
              if engine and engine.last_worker_beat_at else -1),
    ]

    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
