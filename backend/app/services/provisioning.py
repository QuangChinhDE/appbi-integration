"""Creating a tenant (SRS 4.1, 65).

Onboarding a customer is one call: a workspace, its first owner, its quotas and
its engine binding, recorded in the audit log of the workspace it created.

Deliberately independent of the bootstrap workspace. `app.bootstrap` makes one
workspace so that a fresh deployment has somewhere for its platform admin to
land; a SaaS deployment then creates a workspace per customer and never touches
that one again. Anything that only worked because "the default workspace"
existed would be a single-tenant assumption wearing a multi-tenant schema.

Authority is the platform-admin flag on the account, checked here rather than
through the role matrix: creating a tenant is not an action *within* a tenant,
so no workspace role can grant it.
"""

from __future__ import annotations

import re
import secrets
import unicodedata
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import RequestContext
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.core.permissions import Action, OrgRole, Role, org_require
from app.core.security import hash_password, password_problems
from app.models.catalog import EngineInstance
from app.models.enums import WorkspaceStatus
from app.models.identity import Membership, Organization, OrganizationMembership, User, Workspace
from app.services import audit, schedules

#: Lowercase, digits and single hyphens. It appears in URLs and in log lines.
_SLUG_OK = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

#: Reserved because a workspace reachable at one of these would collide with a
#: product route or read as something it is not.
_SLUG_RESERVED = {
    "api", "admin", "hooks", "internal", "login", "logout", "static",
    "assets", "health", "healthz", "readyz", "metrics", "platform", "www",
}


@dataclass(slots=True)
class ProvisionResult:
    workspace: Workspace
    owner: User
    #: Set only when this call created the account. An existing user added as
    #: the owner of a new workspace keeps the password they already have.
    generated_password: str | None


#: Vietnamese `đ`/`Đ` carry no combining mark, so NFD leaves them intact and
#: they have to be mapped by hand. Every other Vietnamese letter decomposes.
_TRANSLITERATE = str.maketrans({"đ": "d", "Đ": "d", "ð": "d", "ø": "o", "ß": "ss"})


def slugify(name: str) -> str:
    """A URL-safe slug from a display name.

    Accents are folded rather than dropped: "Công ty Demo" becomes
    `cong-ty-demo`, not `c-ng-ty-demo`. A slug appears in URLs and log lines
    and is how an operator recognises a tenant, so mangling the name of a
    Vietnamese customer into consonants is a worse first impression than the
    product can afford -- and this deployment's customers are Vietnamese.

    Not authoritative: the caller may pass a slug explicitly. This is the
    convenience for `provision --name "Acme Corp"`.
    """
    folded = unicodedata.normalize("NFD", name.strip().translate(_TRANSLITERATE))
    ascii_only = "".join(
        character for character in folded
        if unicodedata.category(character) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    return slug[:60] or "workspace"


def name_from_email(email: str) -> str:
    """A readable name for an account nobody supplied one for.

    `ops.team@acme.com` becomes `Ops Team`. Defaulting to the address itself
    made the account menu show the same string twice -- once as the person's
    name and once as their email -- which reads like a rendering fault rather
    than a missing value.

    A guess, and a replaceable one: the account can change it, and this only
    decides what they see before they do.
    """
    local = email.split("@", 1)[0]
    words = [word for word in re.split(r"[._+-]+", local) if word]
    if not words:
        return email
    return " ".join(word[:1].upper() + word[1:] for word in words)


def _validate_slug(slug: str) -> str:
    if not _SLUG_OK.match(slug):
        raise ValidationError(
            f"Slug '{slug}' không hợp lệ: chỉ chữ thường, số và dấu gạch nối.",
            code="WORKSPACE_SLUG_INVALID", details={"field": "slug"})
    if len(slug) > 60:
        raise ValidationError(
            "Slug tối đa 60 ký tự.",
            code="WORKSPACE_SLUG_INVALID", details={"field": "slug"})
    if slug in _SLUG_RESERVED:
        raise ValidationError(
            f"Slug '{slug}' đã được hệ thống giữ.",
            code="WORKSPACE_SLUG_RESERVED", details={"field": "slug"})
    return slug


def require_platform_admin(ctx: RequestContext) -> None:
    """The only authority that can create or suspend a tenant.

    A workspace Owner is the top of a *tenant's* hierarchy and has no business
    creating another tenant, so this is not expressible in the role matrix.
    """
    if not ctx.is_platform_admin:
        raise ForbiddenError(
            "Chỉ platform admin thực hiện được thao tác này.",
            code="PLATFORM_ADMIN_REQUIRED")


async def _resolve_engine(
    session: AsyncSession, engine_name: str | None
) -> EngineInstance:
    """The engine instance this tenant's runs go to (SRS 65/66).

    Explicit when named, otherwise the default. Bound at creation rather than
    resolved per dispatch so that moving a tenant between clusters is a
    deliberate, auditable change to one row -- and so a new cluster becoming
    the default does not silently migrate every existing tenant onto it.
    """
    if engine_name:
        instance = await session.scalar(
            select(EngineInstance).where(EngineInstance.name == engine_name))
        if instance is None:
            raise NotFoundError(
                f"Không tìm thấy engine instance '{engine_name}'.",
                code="ENGINE_INSTANCE_NOT_FOUND")
        return instance

    instance = await session.scalar(
        select(EngineInstance).where(EngineInstance.is_default.is_(True)))
    if instance is None:
        raise ConflictError(
            "Chưa có engine instance nào được đánh dấu mặc định. "
            "Hãy chạy bootstrap hoặc chỉ định --engine.",
            code="ENGINE_INSTANCE_MISSING")
    return instance


async def provision_workspace(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    name: str,
    slug: str | None = None,
    owner_email: str,
    owner_full_name: str | None = None,
    owner_password: str | None = None,
    timezone: str = "Asia/Bangkok",
    max_concurrent_executions: int | None = None,
    engine_name: str | None = None,
) -> ProvisionResult:
    """Create a tenant, its first owner, its quota and its engine binding.

    One transaction. A workspace with no owner cannot be administered by
    anybody, and a half-provisioned tenant is worse than none: whoever is
    onboarding the customer has to be able to retry the same command.
    """
    require_platform_admin(ctx)

    display_name = name.strip()
    if not display_name:
        raise ValidationError("Tên workspace không được để trống.",
                              code="WORKSPACE_NAME_REQUIRED",
                              details={"field": "name"})

    resolved_slug = _validate_slug((slug or slugify(display_name)).strip().lower())

    # Rejected before anything is written, so the error names the conflict
    # rather than surfacing a constraint violation.
    if await session.scalar(select(Workspace).where(Workspace.slug == resolved_slug)):
        raise ConflictError(
            f"Workspace slug '{resolved_slug}' đã tồn tại.",
            code="WORKSPACE_SLUG_TAKEN", details={"field": "slug"})
    if await session.scalar(select(Organization).where(Organization.slug == resolved_slug)):
        raise ConflictError(
            f"Slug '{resolved_slug}' đã tồn tại.",
            code="WORKSPACE_SLUG_TAKEN", details={"field": "slug"})

    # A schedule computed in an unknown zone would fire at an unpredictable
    # hour, so an unresolvable timezone is refused here rather than at the
    # first schedule (SRS 39).
    schedules.resolve_zone(timezone)

    if max_concurrent_executions is not None and max_concurrent_executions < 1:
        raise ValidationError(
            "Quota số lần chạy đồng thời phải từ 1 trở lên.",
            code="WORKSPACE_QUOTA_INVALID",
            details={"field": "max_concurrent_executions"})

    engine = await _resolve_engine(session, engine_name)

    normalized_email = (owner_email or "").strip().lower()
    if "@" not in normalized_email:
        raise ValidationError("Email chủ workspace không hợp lệ.",
                              code="OWNER_EMAIL_INVALID",
                              details={"field": "owner_email"})

    # One organisation per customer, created alongside their first workspace.
    # `provision_workspace` has always meant "onboard a customer"; a customer
    # who needs more than one workspace (a department each) adds those
    # afterward through their own ORG_OWNER/ORG_ADMIN, via
    # `provision_department_workspace`.
    organization = Organization(
        name=display_name, slug=resolved_slug, status=WorkspaceStatus.ACTIVE)
    session.add(organization)
    await session.flush()

    workspace = Workspace(
        name=display_name,
        slug=resolved_slug,
        organization_id=organization.id,
        timezone=timezone,
        status=WorkspaceStatus.ACTIVE,
        engine_instance_id=engine.id,
        max_concurrent_executions=max_concurrent_executions,
    )
    session.add(workspace)

    generated: str | None = None
    owner = await session.scalar(
        select(User).where(func.lower(User.email) == normalized_email))
    if owner is None:
        password = owner_password
        if password:
            problems = password_problems(password)
            if problems:
                raise ValidationError(
                    "Mật khẩu khởi tạo không đạt yêu cầu.",
                    code="PASSWORD_TOO_WEAK", details={"problems": problems})
        else:
            # Shown once, to the operator running the command. Better than a
            # documented default that ships to every customer.
            password = secrets.token_urlsafe(16)
            generated = password
        owner = User(
            email=normalized_email,
            full_name=(owner_full_name or "").strip()
            or name_from_email(normalized_email),
            password_hash=hash_password(password),
            # They change it on first sign-in and can do nothing else until
            # they have.
            password_change_required=True,
        )
        session.add(owner)

    try:
        await session.flush()
    except IntegrityError as exc:  # pragma: no cover - guarded above
        raise ConflictError(
            "Không tạo được workspace: dữ liệu đã tồn tại.",
            code="WORKSPACE_SLUG_TAKEN") from exc

    session.add(Membership(
        workspace_id=workspace.id, user_id=owner.id, role=Role.OWNER))
    session.add(OrganizationMembership(
        organization_id=organization.id, user_id=owner.id, role=OrgRole.ORG_OWNER))
    await session.flush()

    # Recorded in the audit log of the workspace that was just created, with
    # the platform admin as the actor. A tenant's history therefore starts with
    # who created it -- which is the first question asked when a customer
    # queries their own trail.
    await audit.record(
        session,
        ctx.for_workspace(workspace.id),
        action="workspace.provisioned",
        resource_type="WORKSPACE",
        resource_id=workspace.id,
        resource_label=workspace.name,
        after={
            "slug": workspace.slug,
            "timezone": workspace.timezone,
            "owner_email": owner.email,
            "max_concurrent_executions": max_concurrent_executions,
            "engine_instance": engine.name,
        },
    )

    return ProvisionResult(
        workspace=workspace, owner=owner, generated_password=generated)


async def provision_department_workspace(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    name: str,
    slug: str | None = None,
    timezone: str = "Asia/Bangkok",
    max_concurrent_executions: int | None = None,
    engine_name: str | None = None,
) -> Workspace:
    """Add a department to the caller's own organisation.

    Unlike `provision_workspace` this crosses no tenant boundary -- it is an
    organisation administering itself -- so it is gated on `org_require`
    rather than the platform-admin flag, and the acting account becomes the
    new workspace's Owner outright rather than one named by email. There is
    nothing to invite: whoever is creating the department is already inside
    the organisation.
    """
    if ctx.organization_id is None:
        raise ForbiddenError(
            "Phiên này không gắn với tổ chức nào.", code="SESSION_WITHOUT_ORG")
    org_require(ctx.org_role, Action.CREATE)

    display_name = name.strip()
    if not display_name:
        raise ValidationError("Tên workspace không được để trống.",
                              code="WORKSPACE_NAME_REQUIRED",
                              details={"field": "name"})

    resolved_slug = _validate_slug((slug or slugify(display_name)).strip().lower())
    if await session.scalar(select(Workspace).where(Workspace.slug == resolved_slug)):
        raise ConflictError(
            f"Workspace slug '{resolved_slug}' đã tồn tại.",
            code="WORKSPACE_SLUG_TAKEN", details={"field": "slug"})

    schedules.resolve_zone(timezone)
    if max_concurrent_executions is not None and max_concurrent_executions < 1:
        raise ValidationError(
            "Quota số lần chạy đồng thời phải từ 1 trở lên.",
            code="WORKSPACE_QUOTA_INVALID",
            details={"field": "max_concurrent_executions"})

    engine = await _resolve_engine(session, engine_name)

    workspace = Workspace(
        name=display_name,
        slug=resolved_slug,
        organization_id=ctx.organization_id,
        timezone=timezone,
        status=WorkspaceStatus.ACTIVE,
        engine_instance_id=engine.id,
        max_concurrent_executions=max_concurrent_executions,
    )
    session.add(workspace)
    try:
        await session.flush()
    except IntegrityError as exc:  # pragma: no cover - guarded above
        raise ConflictError(
            "Không tạo được workspace: dữ liệu đã tồn tại.",
            code="WORKSPACE_SLUG_TAKEN") from exc

    session.add(Membership(
        workspace_id=workspace.id, user_id=ctx.user_id, role=Role.OWNER))
    await session.flush()

    await audit.record(
        session, ctx.for_workspace(workspace.id),
        action="workspace.provisioned", resource_type="WORKSPACE",
        resource_id=workspace.id, resource_label=workspace.name,
        after={"slug": workspace.slug, "timezone": workspace.timezone,
               "organization_id": str(ctx.organization_id),
               "engine_instance": engine.name})
    return workspace


async def list_department_workspaces(
    session: AsyncSession, ctx: RequestContext
) -> dict[str, Any]:
    """Every workspace (department) in the caller's own organisation."""
    if ctx.organization_id is None:
        raise ForbiddenError(
            "Phiên này không gắn với tổ chức nào.", code="SESSION_WITHOUT_ORG")
    org_require(ctx.org_role, Action.VIEW)

    rows = list((await session.scalars(
        select(Workspace)
        .where(Workspace.organization_id == ctx.organization_id)
        .order_by(Workspace.created_at)
    )).all())
    return {"items": [summary(row) for row in rows]}


async def set_quota(
    session: AsyncSession,
    ctx: RequestContext,
    workspace_id: uuid.UUID,
    *,
    max_concurrent_executions: int | None,
) -> dict[str, Any]:
    """Change a tenant's concurrency ceiling."""
    require_platform_admin(ctx)
    workspace = await _get(session, workspace_id)

    if max_concurrent_executions is not None and max_concurrent_executions < 1:
        raise ValidationError(
            "Quota số lần chạy đồng thời phải từ 1 trở lên.",
            code="WORKSPACE_QUOTA_INVALID",
            details={"field": "max_concurrent_executions"})

    before = workspace.max_concurrent_executions
    workspace.max_concurrent_executions = max_concurrent_executions
    await session.flush()
    await audit.record(
        session, ctx.for_workspace(workspace.id),
        action="workspace.quota_changed", resource_type="WORKSPACE",
        resource_id=workspace.id, resource_label=workspace.name,
        before={"max_concurrent_executions": before},
        after={"max_concurrent_executions": max_concurrent_executions})
    return summary(workspace)


async def set_engine(
    session: AsyncSession,
    ctx: RequestContext,
    workspace_id: uuid.UUID,
    *,
    engine_name: str,
) -> dict[str, Any]:
    """Move a tenant to a different engine instance.

    Takes effect on the next dispatch. Runs already in flight finish where they
    started, because their engine holds their state (ADR-010).
    """
    require_platform_admin(ctx)
    workspace = await _get(session, workspace_id)
    engine = await _resolve_engine(session, engine_name)

    before = workspace.engine_instance_id
    workspace.engine_instance_id = engine.id
    await session.flush()
    await audit.record(
        session, ctx.for_workspace(workspace.id),
        action="workspace.engine_changed", resource_type="WORKSPACE",
        resource_id=workspace.id, resource_label=workspace.name,
        before={"engine_instance_id": str(before) if before else None},
        after={"engine_instance": engine.name})
    return summary(workspace)


async def set_status(
    session: AsyncSession,
    ctx: RequestContext,
    workspace_id: uuid.UUID,
    *,
    status: str,
) -> dict[str, Any]:
    """Suspend or reinstate a tenant.

    A suspended workspace refuses every request in `request_context`, including
    its owner's -- which is what makes this usable for a billing hold without
    deleting anything.
    """
    require_platform_admin(ctx)
    workspace = await _get(session, workspace_id)
    try:
        wanted = WorkspaceStatus(status.upper())
    except ValueError:
        raise ValidationError(
            f"Trạng thái '{status}' không hợp lệ.",
            code="WORKSPACE_STATUS_INVALID", details={"field": "status"}) from None

    before = workspace.status
    workspace.status = wanted
    await session.flush()
    await audit.record(
        session, ctx.for_workspace(workspace.id),
        action="workspace.status_changed", resource_type="WORKSPACE",
        resource_id=workspace.id, resource_label=workspace.name,
        before={"status": before.value}, after={"status": wanted.value})
    return summary(workspace)


async def list_workspaces(
    session: AsyncSession, ctx: RequestContext
) -> dict[str, Any]:
    """Every tenant on this deployment, with its owners.

    Platform-admin only, and the only read in the product that deliberately
    crosses tenants -- which is why it lives behind its own authority check and
    returns no tenant *content*, only the shape of the tenancy.
    """
    require_platform_admin(ctx)
    rows = list((await session.scalars(
        select(Workspace).order_by(Workspace.created_at))).all())

    owners: dict[uuid.UUID, list[str]] = {}
    if rows:
        memberships = list((await session.scalars(
            select(Membership).where(
                Membership.workspace_id.in_([r.id for r in rows]),
                Membership.role == Role.OWNER,
            )
        )).all())
        for membership in memberships:
            owners.setdefault(membership.workspace_id, []).append(
                membership.user.email)

    return {"items": [
        {**summary(row), "owners": sorted(owners.get(row.id, []))}
        for row in rows
    ]}


def summary(workspace: Workspace) -> dict[str, Any]:
    return {
        "id": workspace.id,
        "name": workspace.name,
        "slug": workspace.slug,
        "status": workspace.status.value,
        "timezone": workspace.timezone,
        "max_concurrent_executions": workspace.max_concurrent_executions,
        "created_at": workspace.created_at,
    }


async def _get(session: AsyncSession, workspace_id: uuid.UUID) -> Workspace:
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFoundError("Không tìm thấy workspace.")
    return workspace
