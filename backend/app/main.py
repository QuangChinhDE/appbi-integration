"""Product API / BFF.

The browser talks only to this service. It owns auth, RBAC, tenancy, business
rules, audit and the normalized error envelope; the engine sits behind
`WorkflowEngineAdapter` and is not addressable from outside (guardrail 1).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import hooks
from app.api.v1 import (
    auth, credentials, executions, nodes, ops, organization, platform, workflows,
)
from app.core.config import settings
from app.core.errors import AppError, ErrorCategory
from app.core.logging import configure_logging, log_event, new_trace_id, trace_id_var
from app.engine.registry import close_adapter

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    log_event(logger, logging.INFO, "api.startup",
              engine_type=settings.engine_type, product_version=settings.product_version)

    from app.core.readiness import enforce_at_startup, probe_engine_at_startup

    # One configuration check at boot, covering the values that must not carry a
    # development default in production. A misconfigured control plane otherwise
    # looks healthy until the first user action fails three layers from the
    # cause.
    await enforce_at_startup()
    # Configuration is right; is the engine answering? Reported, not enforced,
    # unless STARTUP_REQUIRE_ENGINE says otherwise -- the product must be
    # readable during an engine outage (SRS 9.6).
    await probe_engine_at_startup()

    yield
    await close_adapter()


app = FastAPI(
    title="AppBI Workflow Automation Platform API",
    version=settings.product_version,
    description=(
        "Product-owned control plane. n8n runs behind the WorkflowEngineAdapter; "
        "no engine identifier is ever part of this contract."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    trace_id = request.headers.get("X-Trace-Id") or new_trace_id()
    request.state.trace_id = trace_id
    trace_id_var.set(trace_id)
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response


def _envelope(request: Request, error: AppError) -> JSONResponse:
    trace_id = getattr(request.state, "trace_id", "")
    return JSONResponse(status_code=error.status_code, content=error.to_envelope(trace_id))


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    if exc.status_code >= 500:
        log_event(logger, logging.ERROR, "api.error", code=exc.code,
                  path=request.url.path, technical=exc.technical_message)
    return _envelope(request, exc)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    details = [
        {"field": ".".join(str(part) for part in err.get("loc", [])[1:]),
         "message": err.get("msg")}
        for err in exc.errors()
    ]
    return _envelope(request, AppError(
        "Dữ liệu gửi lên không hợp lệ.",
        code="VALIDATION_FAILED", category=ErrorCategory.VALIDATION, status_code=422,
        details={"fields": details},
    ))


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    mapping = {
        401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED",
        404: "RESOURCE_NOT_FOUND", 405: "METHOD_NOT_ALLOWED",
    }
    return _envelope(request, AppError(
        str(exc.detail), code=mapping.get(exc.status_code, "HTTP_ERROR"),
        category=ErrorCategory.UNKNOWN, status_code=exc.status_code,
    ))


@app.exception_handler(IntegrityError)
async def integrity_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    """A constraint the service layer should have caught first.

    Two requests can pass the same uniqueness pre-check concurrently and the
    database is the real arbiter. That is a conflict the caller can act on, not
    a server fault, so it must not surface as a 500.
    """
    detail = str(getattr(exc, "orig", exc))
    duplicate = "duplicate key" in detail or "UniqueViolation" in detail
    log_event(logger, logging.WARNING, "api.integrity_error",
              path=request.url.path, duplicate=duplicate, technical=detail[:300])
    return _envelope(request, AppError(
        "Tên này đã tồn tại trong workspace." if duplicate
        else "Dữ liệu vi phạm ràng buộc toàn vẹn.",
        code="RESOURCE_CONFLICT" if duplicate else "INTEGRITY_ERROR",
        category=ErrorCategory.CONFLICT, status_code=409,
        technical_message=detail[:1000] if not settings.is_production else None,
    ))


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    log_event(logger, logging.ERROR, "api.unhandled",
              path=request.url.path, error=f"{type(exc).__name__}: {exc}")
    return _envelope(request, AppError(
        "Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.",
        code="INTERNAL_ERROR", category=ErrorCategory.UNKNOWN, status_code=500,
        technical_message=f"{type(exc).__name__}: {exc}"
        if not settings.is_production else None,
    ))


@app.get("/healthz", tags=["system"])
async def healthz() -> dict:
    return {"status": "ok", "service": settings.service_name,
            "version": settings.product_version}


@app.get("/readyz", tags=["system"])
async def readyz(response: Response, deep: bool = False) -> dict:
    """Whether this instance should be sent traffic.

    `deep=1` also requires the engine and is the one a deploy gate should watch.
    Plain `/readyz` is for the load balancer and does not fail on an engine
    outage -- the product stays useful read-only without it. Either way the
    engine's state is in the body, so an operator does not need a second call.
    """
    from app.core.readiness import probe

    ok, report = await probe(deep=deep)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return report


# Not under /api/v1: metrics describe the deployment, not a tenant, and are not
# part of the product's versioned contract.
from app.api import metrics as metrics_module  # noqa: E402

app.include_router(metrics_module.router)

# The public webhook surface, also outside the versioned API (SRS 23.7).
app.include_router(hooks.router)

API_PREFIX = "/api/v1"
for router in (
    auth.router,
    workflows.router,
    executions.router,
    credentials.router,
    nodes.router,
    nodes.admin_router,
    ops.router,
    ops.admin_router,
    organization.router,
    platform.router,
):
    app.include_router(router, prefix=API_PREFIX)
