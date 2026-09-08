"""Platform-admin routes: creating and administering tenants (SRS 4.1, 65).

Separate from `/api/v1/workspace/*`, which is a tenant administering *itself*.
Everything here crosses the tenant boundary and is therefore gated on the
platform-admin flag rather than on any workspace role -- a customer's Owner is
the top of their own hierarchy and must not be able to reach these.

None of these routes return tenant *content*. They return the shape of the
tenancy: names, slugs, quotas, engine bindings, owners. A support engineer can
see that Acme has four workflows without being able to read one.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import CtxDep, SessionDep
from app.services import provisioning

router = APIRouter(prefix="/platform", tags=["platform"])


class ProvisionWorkspaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    #: Derived from the name when omitted.
    slug: str | None = Field(default=None, max_length=60)
    owner_email: EmailStr
    owner_full_name: str | None = Field(default=None, max_length=255)
    #: Omitted on purpose in most cases: a generated one is returned once and
    #: never stored in plaintext, which is better than an operator inventing
    #: passwords by hand.
    owner_password: str | None = Field(default=None, max_length=200)
    timezone: str = Field(default="Asia/Bangkok", max_length=64)
    max_concurrent_executions: int | None = Field(default=None, ge=1, le=1000)
    #: Which engine cluster serves this tenant. The default instance when
    #: omitted.
    engine_name: str | None = Field(default=None, max_length=80)


class QuotaRequest(BaseModel):
    #: `null` means "no tenant ceiling" -- the global one still applies.
    max_concurrent_executions: int | None = Field(default=None, ge=1, le=1000)


class EngineRequest(BaseModel):
    engine_name: str = Field(min_length=1, max_length=80)


class StatusRequest(BaseModel):
    status: str = Field(pattern="^(ACTIVE|SUSPENDED|ARCHIVED)$")


@router.get("/workspaces")
async def list_workspaces(ctx: CtxDep, session: SessionDep) -> dict:
    return await provisioning.list_workspaces(session, ctx)


@router.post("/workspaces", status_code=status.HTTP_201_CREATED)
async def provision_workspace(
    payload: ProvisionWorkspaceRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    """Onboard a customer: workspace, first owner, quota, engine binding.

    The generated owner password is in the response body exactly once and is
    never retrievable afterwards. The account must change it on first sign-in,
    so what is handed over is a one-time secret rather than a standing
    credential.
    """
    result = await provisioning.provision_workspace(
        session,
        ctx,
        name=payload.name,
        slug=payload.slug,
        owner_email=str(payload.owner_email),
        owner_full_name=payload.owner_full_name,
        owner_password=payload.owner_password,
        timezone=payload.timezone,
        max_concurrent_executions=payload.max_concurrent_executions,
        engine_name=payload.engine_name,
    )
    await session.commit()

    body = provisioning.summary(result.workspace)
    body["owner"] = {
        "id": result.owner.id,
        "email": result.owner.email,
        "full_name": result.owner.full_name,
        "password_change_required": result.owner.password_change_required,
    }
    if result.generated_password:
        body["owner"]["one_time_password"] = result.generated_password
        body["owner"]["note"] = (
            "Mật khẩu này chỉ hiển thị một lần và phải được đổi khi đăng nhập "
            "lần đầu."
        )
    return body


@router.put("/workspaces/{workspace_id}/quota")
async def set_quota(
    workspace_id: uuid.UUID,
    payload: QuotaRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    result = await provisioning.set_quota(
        session, ctx, workspace_id,
        max_concurrent_executions=payload.max_concurrent_executions)
    await session.commit()
    return result


@router.put("/workspaces/{workspace_id}/engine")
async def set_engine(
    workspace_id: uuid.UUID,
    payload: EngineRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    result = await provisioning.set_engine(
        session, ctx, workspace_id, engine_name=payload.engine_name)
    await session.commit()
    return result


@router.put("/workspaces/{workspace_id}/status")
async def set_status(
    workspace_id: uuid.UUID,
    payload: StatusRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    """Suspend or reinstate a tenant.

    A suspended workspace refuses every request including its owner's, which
    is what makes this usable for a billing hold without deleting anything.
    """
    result = await provisioning.set_status(
        session, ctx, workspace_id, status=payload.status)
    await session.commit()
    return result
