"""Alerts and in-app notifications (SRS 19).

The design constraint that matters is dedup. A workflow failing every minute on
a schedule produces 1,440 identical notifications a day, at which point people
mute the feature and it stops protecting anything. Every notification carries a
dedup key and every rule a cooldown.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import log_event
from app.core.permissions import Action, Module
from app.models.enums import (
    AlertEventType, ExecutionStatus, NotificationStatus,
)
from app.models.execution import Execution
from app.models.ops import AlertRule, Notification
from app.models.workflow import Workflow

logger = logging.getLogger(__name__)

DEFAULT_COOLDOWN_SECONDS = 900

#: Event types the product raises without a rule having to exist. A failed run
#: that nobody is told about is the failure mode this avoids on a fresh
#: workspace where no rules have been configured yet.
ALWAYS_ON: frozenset[AlertEventType] = frozenset({
    AlertEventType.EXECUTION_FAILED,
    AlertEventType.CREDENTIAL_INVALID,
})


def _fingerprint(*parts: Any) -> str:
    material = "|".join(str(p) for p in parts if p is not None)
    return hashlib.sha256(material.encode()).hexdigest()[:32]


async def raise_alert(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    event_type: AlertEventType,
    title: str,
    body: str | None = None,
    workflow_id: uuid.UUID | None = None,
    execution_id: uuid.UUID | None = None,
    severity: str = "ERROR",
    remediation: dict[str, Any] | None = None,
    fingerprint_parts: tuple[Any, ...] = (),
) -> Notification | None:
    """Create a notification unless an equivalent one is inside its cooldown.

    Returns None when suppressed, which callers can ignore: the point is that
    the caller does not have to know about dedup at all.
    """
    rule = await session.scalar(
        select(AlertRule).where(
            AlertRule.workspace_id == workspace_id,
            AlertRule.event_type == event_type,
            AlertRule.enabled.is_(True),
        ).order_by(AlertRule.workflow_id.is_(None))
    )
    if rule is None and event_type not in ALWAYS_ON:
        return None
    if rule is not None and rule.workflow_id and rule.workflow_id != workflow_id:
        return None

    cooldown = rule.cooldown_seconds if rule else DEFAULT_COOLDOWN_SECONDS
    dedup_key = _fingerprint(workspace_id, workflow_id, event_type.value, *fingerprint_parts)

    recent = await session.scalar(
        select(Notification).where(
            Notification.workspace_id == workspace_id,
            Notification.dedup_key == dedup_key,
            Notification.created_at >= utcnow() - timedelta(seconds=cooldown),
        ).limit(1)
    )
    if recent is not None:
        return None

    notification = Notification(
        workspace_id=workspace_id,
        event_type=event_type,
        severity=severity,
        title=title[:255],
        body=body,
        workflow_id=workflow_id,
        execution_id=execution_id,
        dedup_key=dedup_key,
        status=NotificationStatus.UNREAD,
        remediation=remediation,
        created_at=utcnow(),
    )
    session.add(notification)
    await session.flush()
    log_event(logger, logging.INFO, "alert.raised",
              event_type=event_type.value, workspace_id=str(workspace_id))
    return notification


async def evaluate_execution(session: AsyncSession, execution: Execution) -> None:
    """Called when a run reaches a terminal state.

    Two separate events, because they mean different things to an operator: one
    run failed, versus this workflow keeps failing.
    """
    if execution.status in (ExecutionStatus.SUCCEEDED, ExecutionStatus.CANCELLED):
        return

    workflow = await session.get(Workflow, execution.workflow_id)
    name = workflow.name if workflow else "Workflow"

    await raise_alert(
        session, execution.workspace_id,
        event_type=AlertEventType.EXECUTION_FAILED,
        title=f"{name} thất bại (#{execution.short_id})",
        body=execution.error_summary,
        workflow_id=execution.workflow_id,
        execution_id=execution.id,
        remediation={"action": "VIEW_EXECUTION", "resource_id": str(execution.id)},
        # The error code is part of the fingerprint so a workflow that starts
        # failing for a *new* reason alerts again inside the cooldown of the old
        # one.
        fingerprint_parts=(execution.error_code or "UNKNOWN",),
    )

    streak = await _failure_streak(
        session, execution.workspace_id, execution.workflow_id)
    rule = await session.scalar(
        select(AlertRule).where(
            AlertRule.workspace_id == execution.workspace_id,
            AlertRule.event_type == AlertEventType.CONSECUTIVE_FAILURES,
            AlertRule.enabled.is_(True),
        )
    )
    threshold = rule.threshold if rule else 3
    if streak >= threshold:
        await raise_alert(
            session, execution.workspace_id,
            event_type=AlertEventType.CONSECUTIVE_FAILURES,
            title=f"{name} thất bại {streak} lần liên tiếp",
            body="Workflow này cần được xem lại.",
            workflow_id=execution.workflow_id,
            execution_id=execution.id,
            severity="CRITICAL",
            remediation={"action": "OPEN_WORKFLOW",
                         "resource_id": str(execution.workflow_id)},
            fingerprint_parts=(streak // max(threshold, 1),),
        )

    if execution.error_code in {"NODE_AUTHENTICATION_FAILED", "CREDENTIAL_INVALID"}:
        await raise_alert(
            session, execution.workspace_id,
            event_type=AlertEventType.CREDENTIAL_INVALID,
            title=f"{name}: thông tin xác thực không còn hợp lệ",
            body=execution.error_summary,
            workflow_id=execution.workflow_id,
            execution_id=execution.id,
            remediation={"action": "UPDATE_CREDENTIAL"},
        )


async def _failure_streak(
    session: AsyncSession, workspace_id: uuid.UUID, workflow_id: uuid.UUID
) -> int:
    """How many of the most recent finished runs failed, consecutively."""
    rows = list((await session.scalars(
        select(Execution)
        .where(
            Execution.workspace_id == workspace_id,
            Execution.workflow_id == workflow_id,
        )
        .order_by(Execution.queued_at.desc())
        .limit(20)
    )).all())
    streak = 0
    for row in rows:
        if not row.status.is_terminal:
            continue
        if row.status is ExecutionStatus.SUCCEEDED:
            break
        if row.status is ExecutionStatus.CANCELLED:
            # A person cancelling a run is not the workflow failing, and
            # counting it would raise "keeps failing" on a workflow somebody is
            # actively debugging.
            break
        streak += 1
    return streak


# ── rules ──────────────────────────────────────────────────────────────────
async def list_rules(session: AsyncSession, ctx: RequestContext) -> list[dict[str, Any]]:
    ctx.require(Module.ALERTS, Action.VIEW)
    rows = list((await session.scalars(
        select(AlertRule).where(AlertRule.workspace_id == ctx.workspace_id)
        .order_by(AlertRule.event_type)
    )).all())
    return [
        {
            "id": row.id,
            "event_type": row.event_type.value,
            "workflow_id": row.workflow_id,
            "threshold": row.threshold,
            "channel": row.channel,
            "cooldown_seconds": row.cooldown_seconds,
            "enabled": row.enabled,
        }
        for row in rows
    ]


async def upsert_rule(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    event_type: str,
    workflow_id: uuid.UUID | None = None,
    threshold: int = 1,
    cooldown_seconds: int = DEFAULT_COOLDOWN_SECONDS,
    enabled: bool = True,
) -> dict[str, Any]:
    ctx.require(Module.ALERTS, Action.CREATE)
    try:
        kind = AlertEventType(event_type)
    except ValueError:
        raise ValidationError(f"Loại sự kiện '{event_type}' không hợp lệ.") from None
    if cooldown_seconds < 60:
        raise ValidationError("Thời gian chống trùng tối thiểu là 60 giây.")

    row = await session.scalar(
        select(AlertRule).where(
            AlertRule.workspace_id == ctx.workspace_id,
            AlertRule.event_type == kind,
            AlertRule.workflow_id == workflow_id,
        )
    )
    if row is None:
        row = AlertRule(
            workspace_id=ctx.workspace_id, event_type=kind, workflow_id=workflow_id)
        session.add(row)
    row.threshold = max(1, threshold)
    row.cooldown_seconds = cooldown_seconds
    row.enabled = enabled
    await session.flush()
    return {
        "id": row.id,
        "event_type": row.event_type.value,
        "workflow_id": row.workflow_id,
        "threshold": row.threshold,
        "cooldown_seconds": row.cooldown_seconds,
        "enabled": row.enabled,
    }


async def delete_rule(
    session: AsyncSession, ctx: RequestContext, rule_id: uuid.UUID
) -> None:
    ctx.require(Module.ALERTS, Action.DELETE)
    row = await session.scalar(
        select(AlertRule).where(
            AlertRule.id == rule_id, AlertRule.workspace_id == ctx.workspace_id)
    )
    if row is None:
        raise NotFoundError("Không tìm thấy quy tắc cảnh báo.")
    await session.delete(row)
    await session.flush()


# ── notifications ──────────────────────────────────────────────────────────
async def list_notifications(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    ctx.require(Module.ALERTS, Action.VIEW)
    statement = select(Notification).where(Notification.workspace_id == ctx.workspace_id)
    if status:
        statement = statement.where(Notification.status == NotificationStatus(status.upper()))

    total = int(await session.scalar(
        select(func.count()).select_from(statement.subquery())) or 0)
    rows = list((await session.scalars(
        statement.order_by(Notification.created_at.desc()).limit(limit).offset(offset)
    )).all())

    return {
        "items": [
            {
                "id": row.id,
                "event_type": row.event_type.value,
                "severity": row.severity,
                "title": row.title,
                "body": row.body,
                "workflow_id": row.workflow_id,
                "execution_id": row.execution_id,
                "status": row.status.value,
                "remediation": row.remediation,
                "created_at": row.created_at,
            }
            for row in rows
        ],
        "page": {"total": total, "limit": limit, "offset": offset,
                 "has_more": offset + len(rows) < total},
    }


async def unread_count(session: AsyncSession, ctx: RequestContext) -> dict[str, int]:
    ctx.require(Module.ALERTS, Action.VIEW)
    count = int(await session.scalar(
        select(func.count(Notification.id)).where(
            Notification.workspace_id == ctx.workspace_id,
            Notification.status == NotificationStatus.UNREAD,
        )
    ) or 0)
    return {"count": count}


async def acknowledge(
    session: AsyncSession, ctx: RequestContext, notification_id: uuid.UUID
) -> None:
    ctx.require(Module.ALERTS, Action.EXECUTE)
    row = await session.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.workspace_id == ctx.workspace_id,
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy thông báo.")
    row.status = NotificationStatus.ACKNOWLEDGED
    row.read_at = utcnow()
    await session.flush()


async def acknowledge_all(session: AsyncSession, ctx: RequestContext) -> int:
    ctx.require(Module.ALERTS, Action.EXECUTE)
    rows = list((await session.scalars(
        select(Notification).where(
            Notification.workspace_id == ctx.workspace_id,
            Notification.status == NotificationStatus.UNREAD,
        )
    )).all())
    for row in rows:
        row.status = NotificationStatus.ACKNOWLEDGED
        row.read_at = utcnow()
    await session.flush()
    return len(rows)
