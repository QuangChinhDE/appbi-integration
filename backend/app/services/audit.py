"""Audit trail (SRS 20).

One function, called from every mutating service. It never raises: an audit
write failing must not roll back the business action the user just completed --
the event is logged loudly instead, and the reconciliation is an operator
concern rather than a 500 for the user.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.logging import log_event
from app.core.redaction import redact
from app.models.enums import ActorType, AuditResult
from app.models.ops import AuditEvent

logger = logging.getLogger(__name__)


async def record(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID | str | None = None,
    resource_label: str | None = None,
    result: AuditResult = AuditResult.SUCCESS,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    actor_type: ActorType | None = None,
) -> None:
    """Append one event. `before`/`after` are redacted here, not by callers.

    Callers pass whatever summary is useful; the redaction pass is central so a
    new call site cannot be the one that writes a token into the audit log.
    """
    try:
        if isinstance(resource_id, str):
            try:
                resource_id = uuid.UUID(resource_id)
            except ValueError:
                resource_label = resource_label or resource_id
                resource_id = None

        session.add(AuditEvent(
            workspace_id=ctx.workspace_id,
            actor_type=actor_type or (
                ActorType.USER if ctx.user_id else ActorType.SYSTEM),
            actor_id=ctx.user_id,
            actor_label=ctx.email or ctx.full_name,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_label=(resource_label or "")[:255] or None,
            result=result,
            before_summary=redact(before) if before else None,
            after_summary=redact(after) if after else None,
            trace_id=ctx.trace_id,
            ip_address=ctx.ip_address,
            user_agent=(ctx.user_agent or "")[:255] or None,
            created_at=utcnow(),
        ))
        await session.flush()
    except Exception as exc:  # noqa: BLE001 - never break the caller
        log_event(logger, logging.ERROR, "audit.write_failed",
                  action=action, error=f"{type(exc).__name__}: {exc}")
