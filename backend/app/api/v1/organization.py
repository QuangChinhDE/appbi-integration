"""The organisation: its own members, and the departments (workspaces) it owns.

Scoped to `ctx.organization_id`, which comes from the workspace the session is
using -- never from the request body. Same tenant-isolation rule the rest of
the API follows, one level up.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import CtxDep, SessionDep
from app.services import organizations as org_service
from app.services import provisioning

router = APIRouter(prefix="/organization", tags=["organization"])


class OrgInviteRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    role: str
    password: str = Field(max_length=200)


class OrgRoleRequest(BaseModel):
    role: str


class DepartmentCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    slug: str | None = Field(default=None, max_length=60)
    timezone: str = Field(default="Asia/Bangkok", max_length=64)
    max_concurrent_executions: int | None = Field(default=None, ge=1, le=1000)
    engine_name: str | None = Field(default=None, max_length=80)


@router.get("")
async def get_organization(ctx: CtxDep, session: SessionDep) -> dict:
    return await org_service.summary(session, ctx)


@router.get("/members")
async def list_members(ctx: CtxDep, session: SessionDep) -> dict:
    return {"items": await org_service.list_members(session, ctx)}


@router.post("/members", status_code=status.HTTP_201_CREATED)
async def invite_member(
    payload: OrgInviteRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await org_service.invite_member(
        session, ctx, email=payload.email, full_name=payload.full_name,
        role=payload.role, password=payload.password)
    await session.commit()
    return result


@router.patch("/members/{membership_id}")
async def update_member_role(
    membership_id: uuid.UUID, payload: OrgRoleRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await org_service.update_role(session, ctx, membership_id, payload.role)
    await session.commit()
    return result


@router.delete("/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    membership_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> Response:
    await org_service.remove_member(session, ctx, membership_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/workspaces")
async def list_departments(ctx: CtxDep, session: SessionDep) -> dict:
    return await provisioning.list_department_workspaces(session, ctx)


@router.post("/workspaces", status_code=status.HTTP_201_CREATED)
async def create_department(
    payload: DepartmentCreateRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    """Add a department to this organisation. The caller becomes its Owner."""
    workspace = await provisioning.provision_department_workspace(
        session, ctx,
        name=payload.name, slug=payload.slug, timezone=payload.timezone,
        max_concurrent_executions=payload.max_concurrent_executions,
        engine_name=payload.engine_name,
    )
    await session.commit()
    return provisioning.summary(workspace)
