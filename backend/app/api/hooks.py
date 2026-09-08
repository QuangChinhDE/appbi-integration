"""The public webhook gateway (SRS 23.7, 68).

Outside `/api/v1` on purpose: it is not part of the product's versioned API and
it is the only route on this service that an anonymous caller may reach.

Everything about it is deliberately unhelpful to an attacker. It answers the
same way for an unknown key and a disabled trigger, it never says which
workflow it belongs to, and it returns a short reference rather than an
execution UUID.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import JSONResponse

from app.core import rate_limit
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.logging import log_event, new_trace_id
from app.services import triggers

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hooks", tags=["webhooks"])


async def _rate_limited(public_key: str) -> bool:
    """Whether this key is over its per-minute limit.

    Counted in the database, so the limit is the limit however many API
    replicas are running -- see `app.core.rate_limit`.
    """
    allowed, _ = await rate_limit.check(
        f"webhook:{public_key}",
        limit=settings.webhook_rate_limit_per_minute,
        window_seconds=60,
    )
    return not allowed


@router.api_route(
    "/{public_key}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive(public_key: str, request: Request) -> Response:
    trace_id = request.headers.get("X-Trace-Id") or new_trace_id()
    client_ip = request.client.host if request.client else None

    if await _rate_limited(public_key):
        log_event(logger, logging.WARNING, "webhook.rate_limited", ip=client_ip)
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"error": {"code": "WEBHOOK_RATE_LIMITED",
                               "message": "Too many requests.",
                               "category": "RATE_LIMIT", "trace_id": trace_id}},
            headers={"Retry-After": "60"},
        )

    # Read with a hard cap before anything else touches it. `await request.body()`
    # on an unbounded stream is how a 2GB POST becomes an out-of-memory kill.
    raw = b""
    limit = settings.webhook_max_body_bytes
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > limit:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={"error": {"code": "WEBHOOK_BODY_TOO_LARGE",
                                   "message": "Payload too large.",
                                   "category": "VALIDATION", "trace_id": trace_id}},
            )

    content_type = request.headers.get("content-type")
    parsed: object
    if raw and (content_type or "").lower().startswith("application/json"):
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": {"code": "WEBHOOK_BODY_INVALID",
                                   "message": "Body is not valid JSON.",
                                   "category": "VALIDATION", "trace_id": trace_id}},
            )
    elif raw:
        # Not JSON but allowed by the trigger's content-type policy: hand the
        # workflow the text rather than refusing it.
        parsed = {"body": raw.decode("utf-8", "replace")}
    else:
        parsed = {}

    # Its own session: this route is not behind the authenticated dependency
    # chain, and it must not inherit a tenant context from anywhere.
    async with SessionLocal() as session:
        try:
            result = await triggers.handle_webhook(
                session, public_key,
                method=request.method,
                headers=dict(request.headers),
                raw_body=raw,
                parsed_body=parsed,
                content_type=content_type,
                client_ip=client_ip,
                trace_id=trace_id,
                idempotency_key=request.headers.get("Idempotency-Key"),
            )
            await session.commit()
        except AppError as exc:
            await session.commit()  # keep the audit row for the rejection
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.to_envelope(trace_id),
            )
        except Exception as exc:  # noqa: BLE001
            await session.rollback()
            log_event(logger, logging.ERROR, "webhook.unhandled",
                      error=f"{type(exc).__name__}: {exc}")
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"error": {"code": "INTERNAL_ERROR",
                                   "message": "Unexpected error.",
                                   "category": "UNKNOWN", "trace_id": trace_id}},
            )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content=result,
        headers={"X-Trace-Id": trace_id},
    )
