"""Operations routes: overview, monitoring, alerts, audit, engine, workspace."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import AdminDep, CtxDep, SessionDep
from app.services import access, alerts, audit, monitoring

router = APIRouter(tags=["ops"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


class AlertRuleRequest(BaseModel):
    event_type: str
    workflow_id: uuid.UUID | None = None
    threshold: int = Field(default=1, ge=1, le=100)
    cooldown_seconds: int = Field(default=900, ge=60, le=86_400)
    enabled: bool = True


class WorkspaceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    timezone: str | None = None
    max_concurrent_executions: int | None = Field(default=None, ge=1, le=100)


class InviteRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    role: str
    # Length is deliberately *not* constrained here. `password_problems` is the
    # single authority on what a valid password is, and it returns every reason
    # at once; a schema minimum would short-circuit that for the length case
    # only, so the same weak password would produce a field error or a
    # PASSWORD_TOO_WEAK envelope depending on which rule it happened to break.
    # An upper bound stays, because it bounds the work bcrypt is asked to do.
    password: str = Field(max_length=200)


class RoleRequest(BaseModel):
    role: str


# ── dashboards ─────────────────────────────────────────────────────────────
@router.get("/overview")
async def overview(ctx: CtxDep, session: SessionDep) -> dict:
    return await monitoring.overview(session, ctx)


@router.get("/monitoring")
async def monitoring_dashboard(ctx: CtxDep, session: SessionDep) -> dict:
    return await monitoring.monitoring(session, ctx)


@router.get("/engine/status")
async def engine_status(ctx: CtxDep, session: SessionDep) -> dict:
    result = await monitoring.engine_status(session, ctx)
    await session.commit()
    return result


@router.get("/engine/compatibility")
async def compatibility(ctx: CtxDep, session: SessionDep) -> dict:
    return await monitoring.compatibility(session, ctx)


# ── alerts ─────────────────────────────────────────────────────────────────
@router.get("/alert-rules")
async def list_alert_rules(ctx: CtxDep, session: SessionDep) -> dict:
    return {"items": await alerts.list_rules(session, ctx)}


@router.put("/alert-rules")
async def upsert_alert_rule(
    payload: AlertRuleRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await alerts.upsert_rule(
        session, ctx, event_type=payload.event_type, workflow_id=payload.workflow_id,
        threshold=payload.threshold, cooldown_seconds=payload.cooldown_seconds,
        enabled=payload.enabled)
    await session.commit()
    return result


@router.delete("/alert-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_rule(
    rule_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> Response:
    await alerts.delete_rule(session, ctx, rule_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/notifications")
async def list_notifications(
    ctx: CtxDep,
    session: SessionDep,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    return await alerts.list_notifications(
        session, ctx, status=status_filter, limit=limit, offset=offset)


@router.get("/notifications/unread-count")
async def unread_count(ctx: CtxDep, session: SessionDep) -> dict:
    return await alerts.unread_count(session, ctx)


@router.post("/notifications/{notification_id}/acknowledge")
async def acknowledge(
    notification_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    await alerts.acknowledge(session, ctx, notification_id)
    await session.commit()
    return {"ok": True}


@router.post("/notifications/acknowledge-all")
async def acknowledge_all(ctx: CtxDep, session: SessionDep) -> dict:
    count = await alerts.acknowledge_all(session, ctx)
    await session.commit()
    return {"ok": True, "count": count}


# ── audit ──────────────────────────────────────────────────────────────────
@router.get("/audit")
async def audit_log(
    ctx: CtxDep,
    session: SessionDep,
    action: str | None = None,
    resource_type: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    return await access.audit_log(
        session, ctx, action=action, resource_type=resource_type,
        limit=limit, offset=offset)


# ── workspace and members ──────────────────────────────────────────────────
@router.get("/workspace/settings")
async def workspace_settings(ctx: CtxDep, session: SessionDep) -> dict:
    return await access.workspace_settings(session, ctx)


@router.patch("/workspace/settings")
async def update_workspace(
    payload: WorkspaceUpdateRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await access.update_workspace(
        session, ctx, name=payload.name, timezone=payload.timezone,
        max_concurrent_executions=payload.max_concurrent_executions)
    await session.commit()
    return result


@router.get("/workspace/members")
async def list_members(ctx: CtxDep, session: SessionDep) -> dict:
    return {"items": await access.list_members(session, ctx)}


@router.post("/workspace/members", status_code=status.HTTP_201_CREATED)
async def invite_member(
    payload: InviteRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await access.invite_member(
        session, ctx, email=payload.email, full_name=payload.full_name,
        role=payload.role, password=payload.password)
    await session.commit()
    return result


@router.patch("/workspace/members/{membership_id}")
async def update_member_role(
    membership_id: uuid.UUID, payload: RoleRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await access.update_role(session, ctx, membership_id, payload.role)
    await session.commit()
    return result


@router.delete("/workspace/members/{membership_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    membership_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> Response:
    await access.remove_member(session, ctx, membership_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── admin / debug (SRS 61) ─────────────────────────────────────────────────
@admin_router.get("/executions/{execution_id}/engine-debug")
async def engine_debug(
    execution_id: uuid.UUID, ctx: AdminDep, session: SessionDep
) -> dict:
    """Admin-only diagnostics for one run, and it audits the access.

    The engine ref is masked: knowing that a handle exists is enough for
    support, and printing it invites somebody to try calling the engine with it.
    """
    from app.services import executions as execution_service

    execution = await execution_service.get(session, ctx, execution_id)
    await audit.record(
        session, ctx, action="admin.engine_debug_viewed", resource_type="EXECUTION",
        resource_id=execution.id, resource_label=execution.short_id)
    await session.commit()

    ref = execution.engine_ref or ""
    return {
        "execution_id": execution.id,
        "short_id": execution.short_id,
        "status": execution.status.value,
        "engine_ref_masked": f"{ref[:8]}…" if ref else None,
        "engine_instance_id": execution.engine_instance_id,
        "technical": execution.technical_metadata,
        "graph_hash": execution.graph_hash,
        "trace_id": execution.trace_id,
    }


@admin_router.get("/compatibility")
async def admin_compatibility(ctx: AdminDep, session: SessionDep) -> dict:
    return await monitoring.compatibility(session, ctx)
