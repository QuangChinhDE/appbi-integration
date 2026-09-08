"""Product worker (SRS 28).

Four loops, each with its own interval, in one process:

* dispatch      — hand queued executions to the engine;
* reconcile     — poll active runs, and interrupt the ones the engine lost;
* schedule tick — fire due schedules;
* housekeeping  — retention, missed-schedule alerts, engine health.

Runs alongside the API rather than inside it: a long dispatch must not sit in a
request, and the worker has to keep working while the API is being redeployed.
Safe to run more than one — every claim uses FOR UPDATE SKIP LOCKED (ADR-011).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from datetime import timedelta

from sqlalchemy import delete, select

from app.core import rate_limit
from app.core.config import settings
from app.core.db import SessionLocal, utcnow
from app.core.logging import configure_logging, log_event, new_trace_id, trace_id_var
from app.engine.registry import close_adapter, get_adapter
from app.models.enums import (
    AlertEventType, EngineStatus, ExecutionStatus,
)
from app.models.catalog import EngineInstance
from app.models.execution import Execution, ExecutionLogLine, ExecutionNodeResult
from app.models.identity import Workspace
from app.services import alerts, executions as execution_service, triggers

logger = logging.getLogger(__name__)

_stop = asyncio.Event()


async def dispatch_loop() -> None:
    while not _stop.is_set():
        try:
            async with SessionLocal() as session:
                async with session.begin():
                    claimed = await execution_service.claim_queued(
                        session, settings.worker_batch_size)
                    # Claimed inside the transaction, dispatched outside it: the
                    # engine call must not hold a row lock for its duration.
                    for execution in claimed:
                        execution.status = ExecutionStatus.DISPATCHING

                for execution in claimed:
                    trace_id_var.set(execution.trace_id or new_trace_id())
                    try:
                        await execution_service.dispatch(session, execution)
                        await session.commit()
                    except Exception as exc:  # noqa: BLE001
                        await session.rollback()
                        log_event(logger, logging.ERROR, "worker.dispatch_error",
                                  execution_id=str(execution.id),
                                  error=f"{type(exc).__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            log_event(logger, logging.ERROR, "worker.dispatch_loop_error",
                      error=f"{type(exc).__name__}: {exc}")

        await _sleep(settings.worker_poll_interval_seconds)


async def reconcile_loop() -> None:
    while not _stop.is_set():
        try:
            async with SessionLocal() as session:
                active = await execution_service.active_executions(session)
                for execution in active:
                    trace_id_var.set(execution.trace_id or new_trace_id())
                    try:
                        if execution.engine_ref:
                            await execution_service.poll(session, execution)
                        await _interrupt_if_stale(session, execution)
                        await session.commit()
                    except Exception as exc:  # noqa: BLE001
                        await session.rollback()
                        log_event(logger, logging.ERROR, "worker.reconcile_error",
                                  execution_id=str(execution.id),
                                  error=f"{type(exc).__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            log_event(logger, logging.ERROR, "worker.reconcile_loop_error",
                      error=f"{type(exc).__name__}: {exc}")

        await _sleep(settings.worker_reconcile_interval_seconds)


async def _interrupt_if_stale(session, execution: Execution) -> None:
    """A run the engine has not confirmed for too long (ADR-010).

    The stale window is generous compared with the poll interval, because the
    cost of being wrong in one direction (a healthy run marked interrupted) is
    much higher than in the other (an interrupted run noticed a minute late).
    """
    if execution.status.is_terminal:
        return
    reference = execution.last_seen_at or execution.queued_at
    if utcnow() - reference <= timedelta(seconds=settings.execution_stale_after_seconds):
        return

    if not execution.engine_ref:
        # Never dispatched and long past its queue time: the engine cannot know
        # about it, so this is a failure to start rather than an interruption.
        execution.status = ExecutionStatus.FAILED_TO_START
        execution.error_code = "ENGINE_UNAVAILABLE"
        execution.error_category = "ENGINE"
        execution.error_summary = "Không dispatch được tới engine trong thời gian cho phép."
        execution.ended_at = utcnow()
        await session.flush()
        await alerts.evaluate_execution(session, execution)
        return

    await execution_service.mark_interrupted(
        session, execution,
        "Engine không xác nhận lần chạy này trong thời gian cho phép.")


async def schedule_loop() -> None:
    while not _stop.is_set():
        try:
            async with SessionLocal() as session:
                async with session.begin():
                    due = await triggers.due_schedules(session)
                    for binding in due:
                        trace_id_var.set(new_trace_id())
                        await triggers.fire_schedule(session, binding)
        except Exception as exc:  # noqa: BLE001
            log_event(logger, logging.ERROR, "worker.schedule_loop_error",
                      error=f"{type(exc).__name__}: {exc}")

        await _sleep(settings.worker_schedule_interval_seconds)


async def housekeeping_loop() -> None:
    """Slow loop: engine health, missed schedules, retention (SRS 57)."""
    while not _stop.is_set():
        try:
            async with SessionLocal() as session:
                await _probe_engine(session)
                await _alert_missed_schedules(session)
                await _prune_previews(session)
                # One row per distinct webhook key, otherwise forever.
                pruned = await rate_limit.prune(session)
                if pruned:
                    log_event(logger, logging.DEBUG, "worker.rate_limit_pruned",
                              rows=pruned)
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            log_event(logger, logging.ERROR, "worker.housekeeping_error",
                      error=f"{type(exc).__name__}: {exc}")

        await _sleep(60.0)


async def _probe_engine(session) -> None:
    health = await get_adapter().health()
    instance = await session.scalar(
        select(EngineInstance).where(EngineInstance.is_default.is_(True)))
    if instance is None:
        return

    previous = instance.status
    instance.status = (
        EngineStatus.HEALTHY if health.status == "HEALTHY"
        else EngineStatus.DEGRADED if health.reachable
        else EngineStatus.OFFLINE
    )
    instance.engine_version = health.engine_version or instance.engine_version
    instance.last_probe_at = utcnow()
    # The worker's own heartbeat. `last_probe_at` says when anybody last asked
    # the engine how it was; this says when the worker last ran, which is the
    # only thing that reveals a stopped worker.
    instance.last_worker_beat_at = utcnow()
    instance.last_probe_message = health.message
    await session.flush()

    if instance.status is not EngineStatus.HEALTHY and previous is EngineStatus.HEALTHY:
        # Alerted once per transition, not once per probe: a one-minute loop
        # would otherwise produce sixty notifications an hour during an outage.
        workspaces = list((await session.scalars(select(Workspace))).all())
        for workspace in workspaces:
            await alerts.raise_alert(
                session, workspace.id,
                event_type=AlertEventType.ENGINE_DEGRADED,
                title="Dịch vụ thực thi đang gián đoạn",
                body=health.message,
                severity="CRITICAL",
                remediation={"action": "CONTACT_ADMIN"},
                fingerprint_parts=(instance.status.value,),
            )


async def _alert_missed_schedules(session) -> None:
    for binding in await triggers.detect_missed(session):
        await alerts.raise_alert(
            session, binding.workspace_id,
            event_type=AlertEventType.SCHEDULE_MISSED,
            title="Lịch chạy bị trễ",
            body="Một workflow theo lịch chưa được chạy đúng giờ.",
            workflow_id=binding.workflow_id,
            severity="WARNING",
            remediation={"action": "OPEN_WORKFLOW",
                         "resource_id": str(binding.workflow_id)},
            fingerprint_parts=(binding.id,),
        )


async def _prune_previews(session) -> None:
    """Drop node payload previews and logs past their retention window.

    Execution *summaries* are kept for far longer (SRS 57): the record that a
    run happened is cheap and useful; the customer data that passed through it
    is neither.
    """
    cutoff = utcnow() - timedelta(days=settings.execution_preview_retention_days)
    stale = list((await session.scalars(
        select(Execution.id).where(
            Execution.ended_at.isnot(None), Execution.ended_at < cutoff
        ).limit(500)
    )).all())
    if not stale:
        return

    await session.execute(
        delete(ExecutionNodeResult).where(ExecutionNodeResult.execution_id.in_(stale)))
    await session.execute(
        delete(ExecutionLogLine).where(ExecutionLogLine.execution_id.in_(stale)))
    log_event(logger, logging.INFO, "worker.previews_pruned", executions=len(stale))


async def _sleep(seconds: float) -> None:
    """Sleep, but wake immediately on shutdown.

    A plain `asyncio.sleep` would make SIGTERM take up to a full interval to be
    noticed, which turns a rolling deploy into a minute of dropped ticks.
    """
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(_stop.wait(), timeout=seconds)


async def main() -> None:
    configure_logging()
    log_event(logger, logging.INFO, "worker.startup",
              product_version=settings.product_version)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, _stop.set)

    await asyncio.gather(
        dispatch_loop(),
        reconcile_loop(),
        schedule_loop(),
        housekeeping_loop(),
    )
    await close_adapter()
    log_event(logger, logging.INFO, "worker.shutdown")


if __name__ == "__main__":
    asyncio.run(main())
