"""The organisation itself: its own membership, above any one workspace.

An ORG_OWNER or ORG_ADMIN administers who belongs to the company account and
which departments (workspaces) exist; a workspace's own Owner administers only
that department. This module is the first axis; `provisioning.py` carries the
second (`provision_department_workspace`, `list_department_workspaces`).

Deliberately thin: an organisation here is a name, a slug, its members and the
workspaces it owns. It does not carry quota, engine bindings or billing --
those stay per workspace, exactly where they already were.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import RequestContext
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.permissions import Action, OrgRole, org_permissions, org_require
from app.core.security import hash_password, password_problems
from app.models.identity import Organization, OrganizationMembership, User
from app.services import audit


def _org_id(ctx: RequestContext) -> uuid.UUID:
    if ctx.organization_id is None:
        raise ForbiddenError(
            "Phiên này không gắn với tổ chức nào.", code="SESSION_WITHOUT_ORG")
    return ctx.organization_id


async def summary(session: AsyncSession, ctx: RequestContext) -> dict[str, Any]:
    org_require(ctx.org_role, Action.VIEW)
    organization = await session.get(Organization, _org_id(ctx))
    if organization is None:
        raise NotFoundError("Không tìm thấy tổ chức.")
    return {
        "id": organization.id,
        "name": organization.name,
        "slug": organization.slug,
        "status": organization.status.value,
        "my_role": ctx.org_role.value if ctx.org_role else None,
        "my_permissions": org_permissions(ctx.org_role),
        "created_at": organization.created_at,
    }


async def list_members(session: AsyncSession, ctx: RequestContext) -> list[dict[str, Any]]:
    org_require(ctx.org_role, Action.VIEW)
    rows = list((await session.scalars(
        select(OrganizationMembership)
        .where(OrganizationMembership.organization_id == _org_id(ctx))
        .order_by(OrganizationMembership.created_at)
    )).all())
    return [
        {
            "id": row.id,
            "user_id": row.user.id,
            "email": row.user.email,
            "full_name": row.user.full_name,
            "role": row.role.value,
            "is_active": row.user.is_active,
            "created_at": row.created_at,
        }
        for row in rows
    ]


def _assignable_org_role(role: str, *, acting_role: OrgRole | None) -> OrgRole:
    """Which `OrgRole` a caller may hand out.

    Only an ORG_OWNER may mint another ORG_OWNER -- the same asymmetry
    workspace Owner has over the assignable workspace roles: running the
    organisation day to day (ORG_ADMIN) must not be able to create a peer of
    whoever owns it.
    """
    try:
        parsed = OrgRole(role.upper())
    except ValueError:
        raise ValidationError(
            f"Vai trò tổ chức '{role}' không hợp lệ.",
            details={"allowed": [r.value for r in OrgRole]}) from None
    if parsed is OrgRole.ORG_OWNER and acting_role is not OrgRole.ORG_OWNER:
        raise ForbiddenError(
            "Chỉ ORG_OWNER mới gán được vai trò ORG_OWNER.",
            code="ORG_ROLE_NOT_ASSIGNABLE")
    return parsed


async def invite_member(
    session: AsyncSession, ctx: RequestContext, *,
    email: str, full_name: str, role: str, password: str,
) -> dict[str, Any]:
    org_require(ctx.org_role, Action.ADMIN)
    role_enum = _assignable_org_role(role, acting_role=ctx.org_role)
    problems = password_problems(password)
    if problems:
        raise ValidationError(
            "Mật khẩu khởi tạo không đạt yêu cầu.",
            code="PASSWORD_TOO_WEAK", details={"problems": problems})

    normalized = email.strip().lower()
    user = await session.scalar(select(User).where(func.lower(User.email) == normalized))
    if user is None:
        user = User(
            email=normalized,
            full_name=full_name.strip() or normalized,
            password_hash=hash_password(password),
            password_change_required=True,
        )
        session.add(user)
        await session.flush()

    org_id = _org_id(ctx)
    existing = await session.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.user_id == user.id,
        )
    )
    if existing is not None:
        raise ConflictError("Người dùng này đã thuộc tổ chức.")

    membership = OrganizationMembership(
        organization_id=org_id, user_id=user.id, role=role_enum)
    session.add(membership)
    await session.flush()

    await audit.record(
        session, ctx, action="org_member.invited", resource_type="ORGANIZATION_MEMBER",
        resource_id=user.id, resource_label=user.email,
        after={"role": role_enum.value})

    return {"id": membership.id, "user_id": user.id, "email": user.email,
            "full_name": user.full_name, "role": membership.role.value}


async def update_role(
    session: AsyncSession, ctx: RequestContext, membership_id: uuid.UUID, role: str,
) -> dict[str, Any]:
    org_require(ctx.org_role, Action.ADMIN)
    role_enum = _assignable_org_role(role, acting_role=ctx.org_role)
    row = await session.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.id == membership_id,
            OrganizationMembership.organization_id == _org_id(ctx),
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy thành viên tổ chức.")
    if row.role is OrgRole.ORG_OWNER and role_enum is not OrgRole.ORG_OWNER:
        await _guard_last_owner(session, ctx, exclude=row.id)

    before = row.role.value
    row.role = role_enum
    await session.flush()
    await audit.record(
        session, ctx, action="org_member.role_changed", resource_type="ORGANIZATION_MEMBER",
        resource_id=row.user_id, resource_label=row.user.email,
        before={"role": before}, after={"role": role_enum.value})
    return {"id": row.id, "user_id": row.user_id, "role": row.role.value}


async def remove_member(
    session: AsyncSession, ctx: RequestContext, membership_id: uuid.UUID,
) -> None:
    org_require(ctx.org_role, Action.ADMIN)
    row = await session.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.id == membership_id,
            OrganizationMembership.organization_id == _org_id(ctx),
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy thành viên tổ chức.")
    if row.role is OrgRole.ORG_OWNER:
        await _guard_last_owner(session, ctx, exclude=row.id)

    email = row.user.email
    await session.delete(row)
    await session.flush()
    await audit.record(
        session, ctx, action="org_member.removed", resource_type="ORGANIZATION_MEMBER",
        resource_id=row.user_id, resource_label=email)


async def _guard_last_owner(
    session: AsyncSession, ctx: RequestContext, *, exclude: uuid.UUID,
) -> None:
    """An organisation with no owner cannot be administered by anyone."""
    remaining = int(await session.scalar(
        select(func.count(OrganizationMembership.id)).where(
            OrganizationMembership.organization_id == _org_id(ctx),
            OrganizationMembership.role == OrgRole.ORG_OWNER,
            OrganizationMembership.id != exclude,
        )
    ) or 0)
    if remaining == 0:
        raise ConflictError(
            "Tổ chức phải có ít nhất một ORG_OWNER.",
            code="LAST_ORG_OWNER", remediation={"action": "ASSIGN_ANOTHER_ORG_OWNER"})
