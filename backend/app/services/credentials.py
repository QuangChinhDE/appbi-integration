"""Credential service (SRS 12).

Product owns the credential; the secret store owns the value. Three rules this
module exists to enforce:

* a secret never travels back out. Responses carry `{configured, masked_hint}`
  and nothing else (SRS 12.4);
* an omitted secret on update means *unchanged*, not *cleared*. A form that
  cannot show a value must not be able to erase it by being submitted;
* a credential in use by an active published version cannot be deleted — the
  409 lists what depends on it (SRS 12.6).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.errors import (
    ConflictError, NotFoundError, ResourceInUseError, ValidationError,
)
from app.core.permissions import Action, Module
from app.core.secrets import secret_store
from app.models.enums import (
    AuditResult, CredentialStatus, CredentialType, WorkflowStatus,
)
from app.models.workflow import Credential, Workflow, WorkflowVersion
from app.services import audit, catalog

#: Which fields of each credential type are secret, and which may be shown.
#: Read from the bundled registry so the FE form, the validation here and the
#: engine's runtime injection all agree on one definition (SRS 74).
def _type_spec(credential_type: CredentialType) -> dict[str, Any]:
    for entry in catalog.bundled_credential_types():
        if entry["key"] == credential_type.value:
            return entry
    if credential_type is CredentialType.NONE:
        return {"key": "NONE", "secret_fields": [], "public_fields": [],
                "config_schema": {"fields": []}}
    raise ValidationError(
        f"Loại thông tin xác thực '{credential_type.value}' chưa được hỗ trợ.",
        code="CREDENTIAL_TYPE_UNSUPPORTED")


def _mask_hint(value: str) -> str:
    """Enough to recognise the right credential, not enough to use it.

    Four trailing characters of a token is the convention every API console
    uses; fewer is unrecognisable, more starts being useful to an attacker.
    """
    tail = value[-4:] if len(value) >= 8 else ""
    return f"{'•' * 8}{tail}"


def public_view(row: Credential) -> dict[str, Any]:
    spec = _type_spec(row.credential_type)
    metadata = row.public_metadata or {}
    return {
        "id": row.id,
        "name": row.name,
        "credential_type": row.credential_type.value,
        "status": row.status.value,
        "public_metadata": {
            key: metadata.get(key)
            for key in spec.get("public_fields") or []
            if metadata.get(key) is not None
        },
        "secret": {
            "configured": bool(row.secret_ref),
            "masked_hint": metadata.get("masked_hint"),
            "rotated_at": row.rotated_at,
        },
        "last_test_at": row.last_test_at,
        "last_test_ok": row.last_test_ok,
        "last_test_message": row.last_test_message,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def list_credentials(
    session: AsyncSession, ctx: RequestContext, *, query: str | None = None
) -> list[dict[str, Any]]:
    ctx.require(Module.CREDENTIALS, Action.VIEW)
    statement = (
        select(Credential)
        .where(
            Credential.workspace_id == ctx.workspace_id,
            Credential.deleted_at.is_(None),
        )
        .order_by(Credential.name)
    )
    rows = list((await session.scalars(statement)).all())
    if query:
        needle = query.strip().lower()
        rows = [r for r in rows if needle in r.name.lower()]
    return [public_view(row) for row in rows]


async def get(
    session: AsyncSession, ctx: RequestContext, credential_id: uuid.UUID
) -> Credential:
    """Always workspace-scoped. A cross-tenant id is a 404, not a 403: telling
    a caller that an id exists elsewhere is itself a leak (SRS 32.1)."""
    row = await session.scalar(
        select(Credential).where(
            Credential.id == credential_id,
            Credential.workspace_id == ctx.workspace_id,
            Credential.deleted_at.is_(None),
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy thông tin xác thực.")
    return row


async def create(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    name: str,
    credential_type: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    ctx.require(Module.CREDENTIALS, Action.CREATE)
    kind = CredentialType(credential_type)
    spec = _type_spec(kind)

    name = (name or "").strip()
    if not name:
        raise ValidationError("Tên thông tin xác thực không được để trống.")

    existing = await session.scalar(
        select(func.count(Credential.id)).where(
            Credential.workspace_id == ctx.workspace_id,
            func.lower(Credential.name) == name.lower(),
            Credential.deleted_at.is_(None),
        )
    )
    if existing:
        raise ConflictError(f"Đã có thông tin xác thực tên '{name}'.")

    secret_payload, public_metadata = _split_payload(spec, data, require_all=True)

    row = Credential(
        workspace_id=ctx.workspace_id,
        name=name,
        credential_type=kind,
        public_metadata=public_metadata,
        status=CredentialStatus.ACTIVE,
        created_by=ctx.user_id,
    )
    session.add(row)
    await session.flush()

    if secret_payload:
        row.secret_ref = await secret_store.write(
            session, ctx.workspace_id, secret_payload)
        row.rotated_at = utcnow()
        await session.flush()

    await audit.record(
        session, ctx, action="credential.created", resource_type="CREDENTIAL",
        resource_id=row.id, resource_label=row.name,
        after={"credential_type": kind.value, "fields": sorted(secret_payload.keys())},
    )
    return public_view(row)


async def update(
    session: AsyncSession,
    ctx: RequestContext,
    credential_id: uuid.UUID,
    *,
    name: str | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ctx.require(Module.CREDENTIALS, Action.EDIT)
    row = await get(session, ctx, credential_id)
    spec = _type_spec(row.credential_type)
    before = {"name": row.name, "status": row.status.value}

    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise ValidationError("Tên thông tin xác thực không được để trống.")
        row.name = cleaned

    rotated = False
    if data:
        secret_payload, public_metadata = _split_payload(spec, data, require_all=False)
        if public_metadata:
            row.public_metadata = {**(row.public_metadata or {}), **public_metadata}
        if secret_payload:
            # Rotating a secret also clears an INVALID marker: the reason it was
            # marked invalid was the old value.
            row.secret_ref = await secret_store.write(
                session, ctx.workspace_id, secret_payload, ref=row.secret_ref)
            row.rotated_at = utcnow()
            row.status = CredentialStatus.ACTIVE
            row.last_test_ok = None
            row.last_test_message = None
            rotated = True

    await session.flush()
    await audit.record(
        session, ctx,
        action="credential.rotated" if rotated else "credential.updated",
        resource_type="CREDENTIAL", resource_id=row.id, resource_label=row.name,
        before=before, after={"name": row.name, "rotated": rotated},
    )
    return public_view(row)


def _split_payload(
    spec: dict[str, Any], data: dict[str, Any], *, require_all: bool
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Sort a submitted form into secret values and displayable metadata.

    The three-way distinction the UI depends on (SRS 12.4):

    * key absent      -> leave whatever is stored alone;
    * key with value  -> replace;
    * key empty string-> refuse, because "I meant to clear it" and "the form
      posted a blank input" look identical and one of them is destructive.
    """
    secret_fields = set(spec.get("secret_fields") or [])
    public_fields = set(spec.get("public_fields") or [])
    known = {f["key"] for f in (spec.get("config_schema") or {}).get("fields") or []}

    secret_payload: dict[str, Any] = {}
    public_metadata: dict[str, Any] = {}

    for key, value in (data or {}).items():
        if key not in known:
            raise ValidationError(
                f"Trường '{key}' không thuộc loại thông tin xác thực này.",
                code="CREDENTIAL_FIELD_UNKNOWN", details={"field": key})
        if key in secret_fields:
            if value is None:
                continue
            if not str(value).strip():
                raise ValidationError(
                    f"Trường '{key}' không được để trống.",
                    code="CREDENTIAL_FIELD_EMPTY", details={"field": key})
            secret_payload[key] = str(value)
        if key in public_fields and value is not None:
            public_metadata[key] = str(value)

    if require_all:
        missing = [
            f["key"]
            for f in (spec.get("config_schema") or {}).get("fields") or []
            if f.get("required")
            and f["key"] not in secret_payload
            and f["key"] not in public_metadata
        ]
        if missing:
            raise ValidationError(
                "Thiếu thông tin bắt buộc.",
                code="CREDENTIAL_INCOMPLETE", details={"fields": missing})

    # A hint of the longest secret, so a list of four bearer tokens is
    # distinguishable without any of them being readable.
    if secret_payload:
        longest = max(secret_payload.values(), key=len)
        public_metadata["masked_hint"] = _mask_hint(longest)

    return secret_payload, public_metadata


async def dependents(
    session: AsyncSession, ctx: RequestContext, credential_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Which workflows reference this credential, and how load-bearing that is.

    Scans published version graphs and the current drafts. A JSONB containment
    query would be faster; at V1 scale (hundreds of workflows) correctness and
    legibility win, and this is the only place that needs it.
    """
    definitions = await catalog.definitions_map(session)
    from app.services.graph import collect_credential_ids

    needle = str(credential_id)
    found: list[dict[str, Any]] = []

    workflows = list((await session.scalars(
        select(Workflow).where(
            Workflow.workspace_id == ctx.workspace_id,
            Workflow.deleted_at.is_(None),
        )
    )).all())

    for workflow in workflows:
        draft = workflow.draft
        if draft and needle in collect_credential_ids(draft.graph_json or {}, definitions):
            found.append({
                "type": "WORKFLOW_DRAFT",
                "id": str(workflow.id),
                "name": workflow.name,
                "blocking": False,
            })
        if workflow.active_version_id:
            version = await session.get(WorkflowVersion, workflow.active_version_id)
            if version and needle in collect_credential_ids(
                version.graph_json or {}, definitions
            ):
                found.append({
                    "type": "ACTIVE_VERSION",
                    "id": str(workflow.id),
                    "name": f"{workflow.name} · v{version.version_number}",
                    # This is the one that must block deletion: an active
                    # trigger will fire this graph without anyone watching.
                    "blocking": workflow.status is WorkflowStatus.ACTIVE,
                })
    return found


async def delete(
    session: AsyncSession, ctx: RequestContext, credential_id: uuid.UUID
) -> None:
    ctx.require(Module.CREDENTIALS, Action.DELETE)
    row = await get(session, ctx, credential_id)

    uses = await dependents(session, ctx, credential_id)
    blocking = [u for u in uses if u["blocking"]]
    if blocking:
        raise ResourceInUseError(
            "Thông tin xác thực đang được một workflow đang hoạt động sử dụng.",
            constraints=[
                {"type": u["type"], "id": u["id"], "name": u["name"]} for u in blocking
            ],
            remediation={"action": "VIEW_DEPENDENCIES"},
        )

    # Soft delete: an execution from last month still references this row for
    # its audit trail, and a hard delete would orphan that history.
    row.deleted_at = utcnow()
    row.status = CredentialStatus.DELETED
    if row.secret_ref:
        await secret_store.delete(session, row.secret_ref)
        row.secret_ref = None
    await session.flush()

    await audit.record(
        session, ctx, action="credential.deleted", resource_type="CREDENTIAL",
        resource_id=row.id, resource_label=row.name,
        before={"credential_type": row.credential_type.value},
    )


async def resolve_for_execution(
    session: AsyncSession, workspace_id: uuid.UUID, credential_ids: set[str]
) -> list[dict[str, Any]]:
    """Read plaintext for exactly one execution (SRS 12.5).

    The only function in the product that decrypts a credential. It returns
    plain dicts that go straight into the engine request and are never logged,
    never persisted and never returned to a caller.
    """
    if not credential_ids:
        return []

    parsed: list[uuid.UUID] = []
    for raw in credential_ids:
        try:
            parsed.append(uuid.UUID(str(raw)))
        except ValueError:
            continue

    rows = list((await session.scalars(
        select(Credential).where(
            Credential.id.in_(parsed),
            Credential.workspace_id == workspace_id,
            Credential.deleted_at.is_(None),
        )
    )).all())

    resolved: list[dict[str, Any]] = []
    for row in rows:
        if row.status is CredentialStatus.REVOKED:
            continue
        data = await secret_store.read(session, row.secret_ref) if row.secret_ref else {}
        # Public metadata (header name, username, query parameter name) is part
        # of what the engine needs to build the request, so it travels with the
        # secret rather than being looked up on the other side.
        merged = {
            **{
                k: v for k, v in (row.public_metadata or {}).items()
                if k != "masked_hint"
            },
            **data,
        }
        resolved.append({
            "credential_id": str(row.id),
            "credential_type": row.credential_type.value,
            "data": merged,
        })
    return resolved


async def mark_invalid(
    session: AsyncSession, credential_id: uuid.UUID, message: str
) -> None:
    """Called when a run failed authentication with this credential.

    Marking it is what turns a repeated mystery failure into an ACTION_REQUIRED
    badge with an Update credential button (SRS 18.3, journey D).
    """
    row = await session.get(Credential, credential_id)
    if row is None or row.status is CredentialStatus.REVOKED:
        return
    row.status = CredentialStatus.INVALID
    row.last_test_ok = False
    row.last_test_message = message[:500]
    row.last_test_at = utcnow()
    await session.flush()


async def record_test(
    session: AsyncSession,
    ctx: RequestContext,
    credential_id: uuid.UUID,
    *,
    ok: bool,
    message: str | None,
) -> dict[str, Any]:
    row = await get(session, ctx, credential_id)
    row.last_test_at = utcnow()
    row.last_test_ok = ok
    row.last_test_message = (message or "")[:500] or None
    if ok and row.status is CredentialStatus.INVALID:
        row.status = CredentialStatus.ACTIVE
    elif not ok:
        row.status = CredentialStatus.INVALID
    await session.flush()
    await audit.record(
        session, ctx, action="credential.tested", resource_type="CREDENTIAL",
        resource_id=row.id, resource_label=row.name,
        result=AuditResult.SUCCESS if ok else AuditResult.FAILURE,
        after={"ok": ok},
    )
    return public_view(row)
