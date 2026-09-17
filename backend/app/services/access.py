"""Authentication, workspace membership and the session payload (SRS 10, 4)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.errors import (
    ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError,
)
from app.core.logging import log_event
from app.core.permissions import (
    ASSIGNABLE_ROLES, ORG_ROLES_WITH_WORKSPACE_ACCESS, Action, Module, OrgRole, Role,
    effective, parse_overrides, serialise,
)
from app.core.security import (
    hash_password, issue_session_token, password_problems, verify_password,
)
from app.models.enums import WorkspaceStatus
from app.models.identity import Membership, OrganizationMembership, User, Workspace
from app.services import audit

logger = logging.getLogger(__name__)


@dataclass(slots=True, frozen=True)
class WorkspaceAccess:
    """A workspace the user can open, and how they got there."""

    workspace: Workspace
    role: Role
    #: Set when the reach came from the organisation rather than a membership
    #: row. The FE says "through the organisation" instead of implying
    #: somebody was added to this workspace by hand.
    via_organization: bool
    org_role: OrgRole | None = None
    #: What the membership stores on top of its preset, or None when it
    #: stores nothing, or when the reach did not come through a membership
    #: row at all. A platform admin or an organisation grant holds the
    #: workspace outright, and a stale override on some membership of theirs
    #: must not narrow that.
    permissions: dict | None = None

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id

    @property
    def organization_id(self) -> uuid.UUID:
        return self.workspace.organization_id


async def organizations_of(session: AsyncSession, user: User) -> dict[uuid.UUID, OrgRole]:
    rows = await session.execute(
        select(OrganizationMembership.organization_id, OrganizationMembership.role)
        .where(OrganizationMembership.user_id == user.id)
    )
    return {org_id: role for org_id, role in rows.all()}


async def org_role_of(
    session: AsyncSession, user: User, organization_id: uuid.UUID
) -> OrgRole | None:
    return await session.scalar(
        select(OrganizationMembership.role).where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.organization_id == organization_id,
        )
    )


def effective_role(
    user: User, workspace_role: Role | None, org_role: OrgRole | None,
) -> Role:
    """The role that actually applies inside one workspace.

    A real membership row wins first: it is a specific decision somebody made
    about this account in this workspace, and the platform-admin flag exists
    to add reach on top of that, not to overwrite it. `app.bootstrap` gives
    the first admin a real OWNER membership in their own workspace precisely
    so they administer it as its Owner; if the flag outranked that row, their
    own home workspace would show "Platform Admin" instead of "Owner" the
    moment the flag exists, and revoking that membership later would silently
    change nothing because the flag still carries OWNER-equivalent authority
    everywhere.

    A workspace with no membership row is where the flag and the organisation
    grant do their actual job: reach that would not otherwise exist. The
    platform-admin flag outranks the organisation grant there, then the
    organisation grant provides OWNER. Returning a default for "no claim at
    all" would be wrong -- the caller must not reach a workspace it has no
    claim on, so that case is the caller's to refuse, not this function's to
    paper over.
    """
    if workspace_role is not None:
        return workspace_role
    if user.is_platform_admin:
        return Role.PLATFORM_ADMIN
    if org_role in ORG_ROLES_WITH_WORKSPACE_ACCESS:
        return Role.OWNER
    raise LookupError("no claim on this workspace")


async def authenticate(
    session: AsyncSession, *, email: str, password: str, ip: str | None
) -> tuple[User, str]:
    """Verify credentials and issue a session token.

    Failed attempts are counted and the account locks temporarily. The failure
    message never distinguishes "no such account" from "wrong password": doing
    so turns the login form into an account-enumeration endpoint.
    """
    normalized = (email or "").strip().lower()
    user = await session.scalar(select(User).where(func.lower(User.email) == normalized))

    if user is None:
        log_event(logger, logging.WARNING, "auth.login_unknown_email", ip=ip)
        raise UnauthorizedError("Email hoặc mật khẩu không đúng.", code="INVALID_CREDENTIALS")

    if user.locked_until and user.locked_until > utcnow():
        raise UnauthorizedError(
            "Tài khoản đang tạm bị khóa do đăng nhập sai nhiều lần.",
            code="ACCOUNT_LOCKED",
            details={"locked_until": user.locked_until.isoformat()},
        )

    if not user.is_active:
        raise UnauthorizedError("Tài khoản không còn hoạt động.", code="ACCOUNT_DISABLED")

    if not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        if user.failed_login_count >= settings.login_max_attempts:
            user.locked_until = utcnow() + timedelta(seconds=settings.login_lockout_seconds)
            user.failed_login_count = 0
        await session.flush()
        log_event(logger, logging.WARNING, "auth.login_failed",
                  user_id=str(user.id), ip=ip)
        raise UnauthorizedError("Email hoặc mật khẩu không đúng.", code="INVALID_CREDENTIALS")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    await session.flush()

    memberships = await reachable(session, user)
    workspace_id = memberships[0].workspace_id if memberships else None
    token = issue_session_token(user.id, workspace_id, user.session_version)
    log_event(logger, logging.INFO, "auth.login", user_id=str(user.id))
    return user, token


async def change_password(
    session: AsyncSession, user: User, *, current: str, new: str
) -> str:
    if not verify_password(current, user.password_hash):
        raise UnauthorizedError("Mật khẩu hiện tại không đúng.", code="INVALID_CREDENTIALS")
    problems = password_problems(new)
    if problems:
        raise ValidationError(
            "Mật khẩu mới không đạt yêu cầu.",
            code="PASSWORD_TOO_WEAK", details={"problems": problems})

    user.password_hash = hash_password(new)
    user.password_change_required = False
    user.password_changed_at = utcnow()
    # Every token issued before now stops authenticating. Without this, a
    # password rotation leaves the old sessions live, which is the opposite of
    # what rotating it was for.
    user.session_version += 1
    await session.flush()

    memberships = await reachable(session, user)
    workspace_id = memberships[0].workspace_id if memberships else None
    return issue_session_token(user.id, workspace_id, user.session_version)


async def reachable(session: AsyncSession, user: User) -> list[WorkspaceAccess]:
    """Every workspace this account can operate in, and with what authority.

    Two sources of reach, and a person can have both:

    1. an organisation role of ORG_OWNER or ORG_ADMIN reaches every workspace
       (department) the organisation holds, as OWNER;
    2. a row in `memberships` reaches exactly that workspace, with exactly
       that role.

    A platform admin reaches every active workspace on top of both -- *in
    addition to*, not instead of. This was an either/or at first, and the
    consequence was subtle: `app.bootstrap` gives the first admin an Owner
    membership, so the platform branch never applied to the one account that
    needs it, and the admin could provision a tenant and then not open it.

    Own memberships come first in the result, so the workspace an account
    lands in by default is one it actually belongs to rather than whichever
    workspace was created first.
    """
    rows = list((await session.scalars(
        select(Membership)
        .where(Membership.user_id == user.id)
        .order_by(Membership.created_at)
    )).all())
    memberships = {
        m.workspace_id: m for m in rows if m.workspace.status is WorkspaceStatus.ACTIVE
    }

    org_roles = await organizations_of(session, user)
    admin_org_ids = [
        org_id for org_id, role in org_roles.items()
        if role in ORG_ROLES_WITH_WORKSPACE_ACCESS
    ]

    workspaces: dict[uuid.UUID, Workspace] = {
        m.workspace_id: m.workspace for m in memberships.values()
    }
    if admin_org_ids:
        for workspace in (await session.scalars(
            select(Workspace).where(
                Workspace.organization_id.in_(admin_org_ids),
                Workspace.status == WorkspaceStatus.ACTIVE,
            )
        )).all():
            workspaces.setdefault(workspace.id, workspace)

    if user.is_platform_admin:
        for workspace in (await session.scalars(
            select(Workspace).where(Workspace.status == WorkspaceStatus.ACTIVE)
            .order_by(Workspace.created_at)
        )).all():
            workspaces.setdefault(workspace.id, workspace)

    out: list[WorkspaceAccess] = []
    for workspace in workspaces.values():
        org_role = org_roles.get(workspace.organization_id)
        via_org = org_role in ORG_ROLES_WITH_WORKSPACE_ACCESS
        membership = memberships.get(workspace.id)
        try:
            role = effective_role(user, membership.role if membership else None, org_role)
        except LookupError:                                   # pragma: no cover
            continue
        # A platform admin or an organisation administrator holds the
        # workspace outright; a stale override on some membership of theirs
        # must not narrow that, or administering a workspace would depend on
        # never having been given a restricted seat in it.
        overrides = (
            membership.permissions
            if membership and not via_org and not user.is_platform_admin
            else None
        )
        out.append(WorkspaceAccess(
            workspace=workspace, role=role, via_organization=via_org,
            org_role=org_role, permissions=overrides,
        ))

    # Own memberships first (insertion order from `memberships`, which was
    # already ordered by `created_at`), org-reached workspaces after, active
    # before suspended within each.
    order = {workspace_id: i for i, workspace_id in enumerate(workspaces)}
    out.sort(key=lambda a: (a.workspace.status is not WorkspaceStatus.ACTIVE,
                            order[a.workspace.id]))
    return out


async def session_payload(session: AsyncSession, user: User, workspace_id: uuid.UUID | None):
    memberships = await reachable(session, user)
    current = next((m for m in memberships if m.workspace_id == workspace_id), None)
    if current is None and memberships:
        current = memberships[0]

    role = current.role if current else Role.ANALYST
    perms = effective(
        role, current.permissions if current else None,
        is_platform_admin=user.is_platform_admin)
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "locale": user.locale,
        "is_platform_admin": user.is_platform_admin,
        "password_change_required": user.password_change_required,
        "workspace": {
            "id": current.workspace.id,
            "name": current.workspace.name,
            "slug": current.workspace.slug,
            "timezone": current.workspace.timezone,
            "via_organization": current.via_organization,
        } if current else None,
        "workspaces": [
            {"id": m.workspace.id, "name": m.workspace.name, "slug": m.workspace.slug,
             "via_organization": m.via_organization}
            for m in memberships
        ],
        "role": role.value,
        "permissions": serialise(perms),
    }


async def list_members(session: AsyncSession, ctx: RequestContext) -> list[dict[str, Any]]:
    ctx.require(Module.MEMBERS, Action.VIEW)
    rows = list((await session.scalars(
        select(Membership).where(Membership.workspace_id == ctx.workspace_id)
        .order_by(Membership.created_at)
    )).all())
    return [
        {
            "id": row.id,
            "user_id": row.user.id,
            "email": row.user.email,
            "full_name": row.user.full_name,
            "role": row.role.value,
            "is_active": row.user.is_active,
            "last_login_at": row.user.last_login_at,
            "created_at": row.created_at,
            #: Raw override, or null when this membership carries exactly its
            #: role's preset. Use `effective()` for what it actually grants.
            "permissions": row.permissions,
        }
        for row in rows
    ]


async def invite_member(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    email: str,
    full_name: str,
    role: str,
    password: str,
) -> dict[str, Any]:
    ctx.require(Module.MEMBERS, Action.CREATE)
    role_enum = _assignable(role)
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
            # The invited person changes it on first sign-in; until then the
            # account can do nothing else.
            password_change_required=True,
        )
        session.add(user)
        await session.flush()

    existing = await session.scalar(
        select(Membership).where(
            Membership.workspace_id == ctx.workspace_id,
            Membership.user_id == user.id,
        )
    )
    if existing is not None:
        raise ConflictError("Người dùng này đã thuộc workspace.")

    membership = Membership(
        workspace_id=ctx.workspace_id, user_id=user.id, role=role_enum)
    session.add(membership)
    await session.flush()

    await audit.record(
        session, ctx, action="member.invited", resource_type="MEMBER",
        resource_id=user.id, resource_label=user.email,
        after={"role": role_enum.value})

    return {
        "id": membership.id,
        "user_id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": membership.role.value,
        "is_active": user.is_active,
    }


async def update_role(
    session: AsyncSession, ctx: RequestContext, membership_id: uuid.UUID, role: str
) -> dict[str, Any]:
    ctx.require(Module.MEMBERS, Action.EDIT)
    role_enum = _assignable(role)
    row = await session.scalar(
        select(Membership).where(
            Membership.id == membership_id,
            Membership.workspace_id == ctx.workspace_id,
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy thành viên.")

    if row.role is Role.OWNER and role_enum is not Role.OWNER:
        await _guard_last_owner(session, ctx, exclude=row.id)

    before = row.role.value
    row.role = role_enum
    await session.flush()
    await audit.record(
        session, ctx, action="member.role_changed", resource_type="MEMBER",
        resource_id=row.user_id, resource_label=row.user.email,
        before={"role": before}, after={"role": role_enum.value})
    return {"id": row.id, "user_id": row.user_id, "role": row.role.value}


async def update_permissions(
    session: AsyncSession, ctx: RequestContext, membership_id: uuid.UUID,
    overrides: dict | None,
) -> dict[str, Any]:
    """Set what one membership holds instead of its role's preset.

    Gated on `ADMIN` rather than `EDIT`: `EDIT` on MEMBERS is "change which
    preset somebody starts from", `ADMIN` is "grant or take away authority
    itself" -- the same distinction the organisation axis draws. `None`
    clears the override and the membership falls back to its role's preset.
    """
    ctx.require(Module.MEMBERS, Action.ADMIN)
    row = await session.scalar(
        select(Membership).where(
            Membership.id == membership_id,
            Membership.workspace_id == ctx.workspace_id,
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy thành viên.")

    try:
        stored = parse_overrides(overrides) if overrides else None
    except ValueError as exc:
        raise ValidationError(str(exc), code="PERMISSION_OVERRIDE_INVALID") from None

    before = row.permissions
    row.permissions = stored
    await session.flush()
    await audit.record(
        session, ctx, action="member.permissions_changed", resource_type="MEMBER",
        resource_id=row.user_id, resource_label=row.user.email,
        before={"permissions": before}, after={"permissions": stored})

    perms = effective(row.role, stored)
    return {"id": row.id, "user_id": row.user_id, "role": row.role.value,
            "permissions": serialise(perms)}


async def remove_member(
    session: AsyncSession, ctx: RequestContext, membership_id: uuid.UUID
) -> None:
    ctx.require(Module.MEMBERS, Action.DELETE)
    row = await session.scalar(
        select(Membership).where(
            Membership.id == membership_id,
            Membership.workspace_id == ctx.workspace_id,
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy thành viên.")
    if row.role is Role.OWNER:
        await _guard_last_owner(session, ctx, exclude=row.id)

    email = row.user.email
    await session.delete(row)
    await session.flush()
    await audit.record(
        session, ctx, action="member.removed", resource_type="MEMBER",
        resource_id=row.user_id, resource_label=email)


async def _guard_last_owner(
    session: AsyncSession, ctx: RequestContext, *, exclude: uuid.UUID
) -> None:
    """A workspace with no owner cannot be administered by anyone.

    Cheap to check, and the alternative is a support ticket that can only be
    resolved with database access.
    """
    remaining = int(await session.scalar(
        select(func.count(Membership.id)).where(
            Membership.workspace_id == ctx.workspace_id,
            Membership.role == Role.OWNER,
            Membership.id != exclude,
        )
    ) or 0)
    if remaining == 0:
        raise ConflictError(
            "Workspace phải có ít nhất một Owner.",
            code="LAST_OWNER", remediation={"action": "ASSIGN_ANOTHER_OWNER"})


def _assignable(role: str) -> Role:
    try:
        parsed = Role(role.upper())
    except ValueError:
        raise ValidationError(
            f"Vai trò '{role}' không hợp lệ.",
            details={"allowed": [r.value for r in ASSIGNABLE_ROLES]}) from None
    if parsed not in ASSIGNABLE_ROLES:
        raise ForbiddenError(
            f"Vai trò '{parsed.value}' không thể gán từ giao diện workspace.",
            details={"allowed": [r.value for r in ASSIGNABLE_ROLES]})
    return parsed


async def workspace_settings(
    session: AsyncSession, ctx: RequestContext
) -> dict[str, Any]:
    ctx.require(Module.SETTINGS, Action.VIEW)
    workspace = await session.get(Workspace, ctx.workspace_id)
    if workspace is None:
        raise NotFoundError("Không tìm thấy workspace.")
    return {
        "id": workspace.id,
        "name": workspace.name,
        "slug": workspace.slug,
        "timezone": workspace.timezone,
        "status": workspace.status.value,
        "max_concurrent_executions": workspace.max_concurrent_executions
        or settings.max_concurrent_executions_per_workspace,
        "created_at": workspace.created_at,
    }


async def update_workspace(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    name: str | None = None,
    timezone: str | None = None,
    max_concurrent_executions: int | None = None,
) -> dict[str, Any]:
    ctx.require(Module.SETTINGS, Action.EDIT)
    workspace = await session.get(Workspace, ctx.workspace_id)
    if workspace is None:
        raise NotFoundError("Không tìm thấy workspace.")

    before = {"name": workspace.name, "timezone": workspace.timezone}
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise ValidationError("Tên workspace không được để trống.")
        workspace.name = cleaned
    if timezone is not None:
        from app.services.schedules import resolve_zone

        resolve_zone(timezone)
        workspace.timezone = timezone
    if max_concurrent_executions is not None:
        workspace.max_concurrent_executions = max(1, min(100, max_concurrent_executions))

    await session.flush()
    await audit.record(
        session, ctx, action="workspace.updated", resource_type="WORKSPACE",
        resource_id=workspace.id, resource_label=workspace.name,
        before=before, after={"name": workspace.name, "timezone": workspace.timezone})
    return await workspace_settings(session, ctx)


async def audit_log(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    action: str | None = None,
    resource_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    ctx.require(Module.AUDIT, Action.VIEW)
    from app.models.ops import AuditEvent

    statement = select(AuditEvent).where(AuditEvent.workspace_id == ctx.workspace_id)
    if action:
        statement = statement.where(AuditEvent.action == action)
    if resource_type:
        statement = statement.where(AuditEvent.resource_type == resource_type.upper())

    total = int(await session.scalar(
        select(func.count()).select_from(statement.subquery())) or 0)
    rows = list((await session.scalars(
        statement.order_by(AuditEvent.created_at.desc()).limit(limit).offset(offset)
    )).all())

    return {
        "items": [
            {
                "id": row.id,
                "action": row.action,
                "actor_type": row.actor_type.value,
                "actor_label": row.actor_label,
                "resource_type": row.resource_type,
                "resource_id": row.resource_id,
                "resource_label": row.resource_label,
                "result": row.result.value,
                "before_summary": row.before_summary,
                "after_summary": row.after_summary,
                "trace_id": row.trace_id,
                "ip_address": row.ip_address,
                "created_at": row.created_at,
            }
            for row in rows
        ],
        "page": {"total": total, "limit": limit, "offset": offset,
                 "has_more": offset + len(rows) < total},
    }
