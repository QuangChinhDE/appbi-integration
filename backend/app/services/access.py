"""Authentication, workspace membership and the session payload (SRS 10, 4)."""

from __future__ import annotations

import logging
import uuid
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
    ASSIGNABLE_ROLES, Action, Module, Role, permission_map,
)
from app.core.security import (
    hash_password, issue_session_token, password_problems, verify_password,
)
from app.models.enums import WorkspaceStatus
from app.models.identity import Membership, User, Workspace
from app.services import audit

logger = logging.getLogger(__name__)


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


async def reachable(session: AsyncSession, user: User) -> list[Membership]:
    """Workspaces this account can operate in.

    A platform admin reaches every active workspace, *in addition to* any it
    holds a real membership in -- not instead of. This was an either/or at
    first, and the consequence was subtle: `app.bootstrap` gives the first
    admin an Owner membership, so the platform branch never applied to the one
    account that needs it, and the admin could provision a tenant and then not
    open it.

    Their own memberships come first, so the workspace they land in by default
    is the one they belong to rather than whichever tenant was created first.
    """
    rows = list((await session.scalars(
        select(Membership)
        .where(Membership.user_id == user.id)
        .order_by(Membership.created_at)
    )).all())
    memberships = [m for m in rows if m.workspace.status is WorkspaceStatus.ACTIVE]

    if not user.is_platform_admin:
        return memberships

    held = {m.workspace_id for m in memberships}
    workspaces = list((await session.scalars(
        select(Workspace).where(Workspace.status == WorkspaceStatus.ACTIVE)
        .order_by(Workspace.created_at)
    )).all())
    # Synthetic memberships, not persisted: the authority comes from the account
    # flag, and writing rows for it would make revoking the flag insufficient.
    return memberships + [
        Membership(
            id=uuid.uuid4(), workspace_id=workspace.id, user_id=user.id,
            role=Role.PLATFORM_ADMIN, workspace=workspace, user=user,
        )
        for workspace in workspaces
        if workspace.id not in held
    ]


async def session_payload(session: AsyncSession, user: User, workspace_id: uuid.UUID | None):
    memberships = await reachable(session, user)
    current = next((m for m in memberships if m.workspace_id == workspace_id), None)
    if current is None and memberships:
        current = memberships[0]

    role = current.role if current else Role.ANALYST
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
        } if current else None,
        "workspaces": [
            {"id": m.workspace.id, "name": m.workspace.name, "slug": m.workspace.slug}
            for m in memberships
        ],
        "role": role.value,
        "permissions": permission_map(role),
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
