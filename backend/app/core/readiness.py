"""Startup configuration checks and readiness probes.

Two separate questions, deliberately not merged:

* *is this deployment configured coherently* — checked once at boot, and fatal
  in production. A control plane with a development JWT secret should refuse to
  start rather than run and be found later.
* *should this instance receive traffic right now* — the readiness probe. An
  engine outage does not make the API unready, because the product is designed
  to stay readable without it (SRS 9.6).
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

from app.core.config import settings
from app.core.logging import log_event

logger = logging.getLogger(__name__)

DEV_PLACEHOLDERS = {"dev-only-change-me", "dev-engine-token", "change-me", ""}


def configuration_problems() -> list[str]:
    """Everything wrong with this deployment's configuration, in one list.

    Returned rather than raised one at a time so an operator fixes them in one
    pass instead of restarting five times.
    """
    problems: list[str] = []

    if settings.jwt_secret.strip() in DEV_PLACEHOLDERS:
        problems.append("JWT_SECRET is unset or still the development placeholder.")
    if len(settings.jwt_secret) < 32:
        problems.append("JWT_SECRET should be at least 32 characters.")
    if not settings.secret_encryption_key.strip():
        problems.append(
            "SECRET_ENCRYPTION_KEY is unset. Generate one with: python -c "
            '"import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"'
        )
    if settings.engine_internal_token.strip() in DEV_PLACEHOLDERS:
        problems.append("ENGINE_INTERNAL_TOKEN is unset or the development placeholder.")

    if settings.is_production:
        if settings.allow_derived_encryption_key:
            problems.append(
                "ALLOW_DERIVED_ENCRYPTION_KEY must be false in production: it lets a "
                "passphrase stand in for a real key.")
        if not settings.session_cookie_secure:
            problems.append("SESSION_COOKIE_SECURE must be true in production.")
        if settings.public_base_url.startswith("http://"):
            problems.append(
                "PUBLIC_BASE_URL is http:// -- webhook URLs handed to third parties "
                "would not be encrypted.")
        if settings.egress_allow_private_networks:
            problems.append(
                "EGRESS_ALLOW_PRIVATE_NETWORKS is true: workflows could reach internal "
                "services. Set an explicit allowlist instead.")

    return problems


async def enforce_at_startup() -> None:
    problems = configuration_problems()
    if not problems:
        return
    for problem in problems:
        log_event(logger, logging.ERROR, "startup.configuration_problem", problem=problem)
    if settings.is_production:
        raise RuntimeError(
            "Refusing to start with an unsafe configuration:\n- " + "\n- ".join(problems)
        )
    log_event(logger, logging.WARNING, "startup.configuration_warnings",
              count=len(problems),
              note="development environment: continuing despite the problems above")


async def probe_engine_at_startup() -> None:
    from app.engine.registry import get_adapter

    health = await get_adapter().health()
    log_event(
        logger,
        logging.INFO if health.reachable else logging.WARNING,
        "startup.engine_probe",
        reachable=health.reachable, status=health.status,
        engine_version=health.engine_version,
        # `detail`, not `message`: `log_event` takes the log message
        # positionally, so a field of that name collides with it.
        detail=health.message,
    )
    if not health.reachable and settings.startup_require_engine:
        raise RuntimeError(f"Engine is not reachable: {health.message}")


async def probe(deep: bool = False) -> tuple[bool, dict[str, Any]]:
    """Readiness. `deep` additionally requires a healthy engine."""
    report: dict[str, Any] = {
        "service": settings.service_name,
        "version": settings.product_version,
        "environment": settings.app_env,
        "checks": {},
    }
    ok = True

    from app.core.db import SessionLocal

    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        report["checks"]["database"] = {"ok": True}
    except Exception as exc:  # noqa: BLE001
        ok = False
        report["checks"]["database"] = {"ok": False, "error": str(exc)[:200]}

    problems = configuration_problems()
    report["checks"]["configuration"] = {"ok": not problems, "problems": problems}
    if problems and settings.is_production:
        ok = False

    from app.engine.registry import get_adapter

    health = await get_adapter().health()
    report["checks"]["engine"] = {
        "ok": health.reachable and health.status == "HEALTHY",
        "status": health.status,
        "engine_version": health.engine_version,
        "message": health.message,
    }
    # Only a deep probe fails on the engine. The shallow one is what a load
    # balancer watches, and taking every API instance out of rotation because
    # the engine restarted would turn a degraded product into an outage.
    if deep and not report["checks"]["engine"]["ok"]:
        ok = False

    report["ready"] = ok
    return ok, report
