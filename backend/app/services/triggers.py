"""Trigger service: the webhook gateway and the scheduler (SRS 17, 67, 68).

Both live in the product (ADR-004, ADR-005). All three trigger types converge
on the same `executions.create` call — there is one execution path, not three
(SRS 8.4).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.errors import AppError, NotFoundError, error_from_matrix
from app.core.logging import log_event
from app.core.redaction import body_metadata, sanitize_headers
from app.core.secrets import secret_store
from app.models.enums import (
    ACTIVE_EXECUTION_STATUSES, ActorType, AuditResult, OverlapPolicy, TriggerType,
    VersionKind, WebhookAuthMode,
)
from app.models.execution import Execution
from app.models.identity import Workspace
from app.models.workflow import TriggerBinding, Workflow
from app.services import audit, executions, schedules

logger = logging.getLogger(__name__)

#: Header the gateway reads for HMAC mode. Named after the product, not after
#: whichever SaaS the caller happens to be.
SIGNATURE_HEADER = "X-AppBI-Signature"
TIMESTAMP_HEADER = "X-AppBI-Timestamp"
#: How far a signed request's timestamp may be from now. Bounds replay without
#: needing a nonce store, which V1 does not have.
SIGNATURE_TOLERANCE_SECONDS = 300


class WebhookRejected(AppError):
    """Refused at the gateway. Answered with a policy-safe body: a caller with
    the wrong secret learns that it was refused and nothing else."""

    status_code = 401
    code = "WEBHOOK_AUTH_FAILED"
    message = "Webhook không được xác thực."


# ── webhook gateway ────────────────────────────────────────────────────────
async def resolve_webhook(
    session: AsyncSession, public_key: str
) -> tuple[TriggerBinding, Workflow, Workspace]:
    binding = await session.scalar(
        select(TriggerBinding).where(
            TriggerBinding.public_key == public_key,
            TriggerBinding.trigger_type == TriggerType.WEBHOOK,
        )
    )
    if binding is None or not binding.enabled:
        # One answer for "no such hook" and "hook is off", so the endpoint
        # cannot be used to enumerate which workflows exist (SRS 32.3).
        raise NotFoundError("Không tìm thấy webhook.", code="WEBHOOK_NOT_FOUND")

    workflow = await session.get(Workflow, binding.workflow_id)
    if workflow is None or workflow.deleted_at is not None:
        raise NotFoundError("Không tìm thấy webhook.", code="WEBHOOK_NOT_FOUND")
    workspace = await session.get(Workspace, binding.workspace_id)
    if workspace is None:
        raise NotFoundError("Không tìm thấy webhook.", code="WEBHOOK_NOT_FOUND")
    return binding, workflow, workspace


async def authenticate_webhook(
    session: AsyncSession,
    binding: TriggerBinding,
    *,
    method: str,
    headers: dict[str, str],
    raw_body: bytes,
    content_type: str | None,
) -> None:
    """Method, content type, size and authentication, in that order.

    Cheap checks first on purpose: an abusive caller sending 10MB to a hook
    configured for POST/JSON should be refused before the body is parsed.
    """
    config = binding.config_json or {}

    expected_method = str(config.get("method") or "POST").upper()
    if method.upper() != expected_method:
        raise WebhookRejected(
            f"Webhook chỉ nhận {expected_method}.",
            code="WEBHOOK_METHOD_NOT_ALLOWED", status_code=405)

    allowed_type = str(config.get("allowed_content_type") or "application/json")
    if allowed_type != "*" and content_type:
        if not content_type.lower().startswith(allowed_type.lower()):
            raise WebhookRejected(
                f"Content-Type phải là {allowed_type}.",
                code="WEBHOOK_CONTENT_TYPE_INVALID", status_code=415)

    max_body = min(
        int(config.get("max_body_bytes") or settings.webhook_max_body_bytes),
        settings.webhook_max_body_bytes)
    if len(raw_body) > max_body:
        raise WebhookRejected(
            "Nội dung yêu cầu quá lớn.",
            code="WEBHOOK_BODY_TOO_LARGE", status_code=413)

    mode = WebhookAuthMode(str(config.get("auth_mode") or "NONE").upper())
    if mode is WebhookAuthMode.NONE:
        return

    secret = ""
    if binding.webhook_secret_ref:
        stored = await secret_store.read(session, binding.webhook_secret_ref)
        secret = str(stored.get("secret") or "")
    if not secret:
        # Configured to require auth but has no secret: refuse rather than fall
        # through to accepting everything.
        raise WebhookRejected(code="WEBHOOK_SECRET_MISSING")

    lowered = {key.lower(): value for key, value in headers.items()}

    if mode is WebhookAuthMode.BASIC:
        provided = lowered.get("authorization", "")
        if not provided.lower().startswith("basic "):
            raise WebhookRejected()
        try:
            decoded = base64.b64decode(provided[6:]).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            raise WebhookRejected() from None
        _, _, password = decoded.partition(":")
        if not hmac.compare_digest(password, secret):
            raise WebhookRejected()
        return

    # HEADER_SIGNATURE: HMAC-SHA256 over `timestamp.body`.
    signature = lowered.get(SIGNATURE_HEADER.lower(), "")
    timestamp = lowered.get(TIMESTAMP_HEADER.lower(), "")
    if not signature or not timestamp:
        raise WebhookRejected()

    try:
        sent_at = int(timestamp)
    except ValueError:
        raise WebhookRejected() from None
    if abs(int(utcnow().timestamp()) - sent_at) > SIGNATURE_TOLERANCE_SECONDS:
        # Bounded replay window. Without it a captured request is valid forever.
        raise WebhookRejected(code="WEBHOOK_SIGNATURE_EXPIRED")

    expected = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    provided = signature[7:] if signature.startswith("sha256=") else signature
    if not hmac.compare_digest(expected, provided):
        raise WebhookRejected()


async def handle_webhook(
    session: AsyncSession,
    public_key: str,
    *,
    method: str,
    headers: dict[str, str],
    raw_body: bytes,
    parsed_body: Any,
    content_type: str | None,
    client_ip: str | None,
    trace_id: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """The public entry point. Answers 202 with a safe reference (SRS 17.3).

    It does not wait for the workflow. Returning a result would mean holding a
    public connection open for the length of an automation, and `Respond to
    Webhook` is explicitly out of scope until it has its own design (ADR-005).
    """
    binding, workflow, workspace = await resolve_webhook(session, public_key)
    ctx = RequestContext.system(workspace.id, trace_id, workspace.timezone)
    ctx.ip_address = client_ip

    try:
        await authenticate_webhook(
            session, binding, method=method, headers=headers,
            raw_body=raw_body, content_type=content_type)
    except AppError as exc:
        await audit.record(
            session, ctx, action="webhook.rejected", resource_type="WORKFLOW",
            resource_id=workflow.id, resource_label=workflow.name,
            result=AuditResult.FAILURE, actor_type=ActorType.WEBHOOK,
            after={"code": exc.code, "method": method})
        log_event(logger, logging.WARNING, "webhook.rejected",
                  workflow_id=str(workflow.id), code=exc.code)
        raise

    if binding.workflow_version_id is None:
        raise error_from_matrix("WORKFLOW_NOT_PUBLISHED")

    execution = await executions.create(
        session, ctx, workflow.id,
        kind=VersionKind.PUBLISHED,
        trigger_type=TriggerType.WEBHOOK,
        start_payload=parsed_body,
        idempotency_key=idempotency_key,
        version_id=binding.workflow_version_id,
    )
    # What arrived, not the body itself (SRS 57): the payload the execution runs
    # on is already stored, redacted, on the execution row.
    execution.input_metadata = {
        **execution.input_metadata,
        **body_metadata(raw_body, content_type),
        "headers": sanitize_headers(headers),
        "source_ip": client_ip,
    }
    binding.last_fired_at = utcnow()
    await session.flush()

    await audit.record(
        session, ctx, action="webhook.received", resource_type="EXECUTION",
        resource_id=execution.id, resource_label=f"{workflow.name} #{execution.short_id}",
        actor_type=ActorType.WEBHOOK,
        after={"method": method, "size_bytes": len(raw_body)})

    return {
        "accepted": True,
        # A public-safe handle. Not the execution UUID: this response goes to
        # whoever called the hook.
        "reference": execution.short_id,
        "status": execution.status.value,
    }


# ── scheduler ──────────────────────────────────────────────────────────────
async def due_schedules(session: AsyncSession, limit: int = 50) -> list[TriggerBinding]:
    """Bindings whose next run has arrived.

    `FOR UPDATE SKIP LOCKED` per tick is the distributed lock (SRS 67): two
    workers ticking at the same second must not both fire the same schedule.
    """
    return list((await session.scalars(
        select(TriggerBinding)
        .where(
            TriggerBinding.enabled.is_(True),
            TriggerBinding.trigger_type == TriggerType.SCHEDULE,
            TriggerBinding.next_run_at.isnot(None),
            TriggerBinding.next_run_at <= utcnow(),
        )
        .order_by(TriggerBinding.next_run_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )).all())


async def fire_schedule(
    session: AsyncSession, binding: TriggerBinding
) -> Execution | None:
    """Run one due schedule, then compute the next fire time.

    The next time is advanced whatever happens — including when the run is
    skipped for overlap. A schedule that stopped advancing because a workflow
    was stuck would fire a burst the moment it recovered.
    """
    workflow = await session.get(Workflow, binding.workflow_id)
    workspace = await session.get(Workspace, binding.workspace_id)
    if workflow is None or workspace is None or workflow.deleted_at is not None:
        binding.enabled = False
        binding.next_run_at = None
        await session.flush()
        return None

    ctx = RequestContext.system(workspace.id, f"sched_{uuid.uuid4().hex[:16]}",
                                workspace.timezone)
    config = binding.config_json or {}
    fired: Execution | None = None

    try:
        if binding.overlap_policy is OverlapPolicy.SKIP_IF_RUNNING:
            from sqlalchemy import func

            active = int(await session.scalar(
                select(func.count(Execution.id)).where(
                    Execution.workflow_id == workflow.id,
                    Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES)),
                )
            ) or 0)
            if active:
                log_event(logger, logging.INFO, "schedule.skipped_overlap",
                          workflow_id=str(workflow.id))
                await audit.record(
                    session, ctx, action="schedule.skipped_overlap",
                    resource_type="WORKFLOW", resource_id=workflow.id,
                    resource_label=workflow.name, actor_type=ActorType.SYSTEM)
                return None

        if binding.workflow_version_id is None:
            binding.enabled = False
            binding.next_run_at = None
            await session.flush()
            log_event(logger, logging.WARNING, "schedule.disabled_no_version",
                      workflow_id=str(workflow.id))
            return None

        fired = await executions.create(
            session, ctx, workflow.id,
            kind=VersionKind.PUBLISHED,
            trigger_type=TriggerType.SCHEDULE,
            start_payload={},
            version_id=binding.workflow_version_id,
        )
        await audit.record(
            session, ctx, action="schedule.triggered", resource_type="EXECUTION",
            resource_id=fired.id, resource_label=f"{workflow.name} #{fired.short_id}",
            actor_type=ActorType.SYSTEM)
    except AppError as exc:
        # A schedule that cannot fire this minute must still be scheduled for
        # the next one, or one transient quota error silently stops the
        # automation for good.
        log_event(logger, logging.WARNING, "schedule.fire_failed",
                  workflow_id=str(workflow.id), code=exc.code)
    finally:
        binding.last_fired_at = utcnow()
        try:
            binding.next_run_at = schedules.next_run_at(config)
        except AppError:
            # The config itself is broken. Disable rather than retry forever,
            # and say so in the audit log.
            binding.enabled = False
            binding.next_run_at = None
            await audit.record(
                session, ctx, action="schedule.disabled_invalid",
                resource_type="WORKFLOW", resource_id=workflow.id,
                resource_label=workflow.name, result=AuditResult.FAILURE,
                actor_type=ActorType.SYSTEM)
        await session.flush()

    return fired


async def detect_missed(session: AsyncSession) -> list[TriggerBinding]:
    """Schedules whose fire time is far in the past.

    A tick that is a few seconds late is normal. One that is minutes late means
    the worker was down or the queue was saturated, which is an alert rather
    than something to fire quietly and pretend was on time (SRS 19.1).
    """
    threshold = utcnow() - timedelta(minutes=5)
    return list((await session.scalars(
        select(TriggerBinding).where(
            TriggerBinding.enabled.is_(True),
            TriggerBinding.trigger_type == TriggerType.SCHEDULE,
            TriggerBinding.next_run_at.isnot(None),
            TriggerBinding.next_run_at < threshold,
        )
    )).all())


def trigger_view(binding: TriggerBinding) -> dict[str, Any]:
    """What the editor shows about a trigger. Never the webhook secret."""
    body: dict[str, Any] = {
        "id": binding.id,
        "trigger_type": binding.trigger_type.value,
        "enabled": binding.enabled,
        "config": binding.config_json or {},
        "overlap_policy": binding.overlap_policy.value,
        "next_run_at": binding.next_run_at,
        "last_fired_at": binding.last_fired_at,
        "active_version_id": binding.workflow_version_id,
    }
    if binding.trigger_type is TriggerType.WEBHOOK and binding.public_key:
        body["webhook"] = {
            "url": f"{settings.public_base_url.rstrip('/')}/hooks/{binding.public_key}",
            "method": (binding.config_json or {}).get("method", "POST"),
            "auth_mode": (binding.config_json or {}).get("auth_mode", "NONE"),
            "secret_configured": bool(binding.webhook_secret_ref),
            "signature_header": SIGNATURE_HEADER,
            "timestamp_header": TIMESTAMP_HEADER,
        }
    if binding.trigger_type is TriggerType.SCHEDULE and binding.config_json:
        body["schedule"] = {
            "summary": schedules.describe(binding.config_json),
            # Three concrete times, because a cron expression nobody can read is
            # obviously wrong once you see when it would actually run.
            "next_runs": schedules.preview(binding.config_json, count=3),
        }
    return body


async def rotate_webhook_secret(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID
) -> dict[str, Any]:
    """Rotate the shared secret. Returns the new value exactly once.

    The only endpoint in the product that returns a secret in a response body,
    and it does so because there is no other way for the caller to configure
    their sender. It is never readable again.
    """
    import secrets as _secrets

    from app.core.permissions import Action, Module

    ctx.require(Module.WORKFLOWS, Action.PUBLISH)
    binding = await session.scalar(
        select(TriggerBinding).where(
            TriggerBinding.workflow_id == workflow_id,
            TriggerBinding.workspace_id == ctx.workspace_id,
        )
    )
    if binding is None or binding.trigger_type is not TriggerType.WEBHOOK:
        raise NotFoundError("Workflow này không dùng webhook trigger.")

    value = _secrets.token_urlsafe(32)
    binding.webhook_secret_ref = await secret_store.write(
        session, ctx.workspace_id, {"secret": value}, ref=binding.webhook_secret_ref)
    await session.flush()

    await audit.record(
        session, ctx, action="webhook.secret_rotated", resource_type="WORKFLOW",
        resource_id=workflow_id,
        after={"signature_header": SIGNATURE_HEADER})

    return {
        "secret": value,
        "signature_header": SIGNATURE_HEADER,
        "timestamp_header": TIMESTAMP_HEADER,
        "note": "Giá trị này chỉ hiển thị một lần.",
    }
