"""Workflow domain service (SRS 13, 69).

The three lifecycles this module keeps apart:

* the draft moves whenever the editor saves, guarded by `revision`;
* a published version never changes after it is written;
* the active version is what a trigger fires, and only `activate` moves it.

Saving a draft never touches the engine (SRS 8.1). Publishing does, because a
version that cannot compile must not become publishable (SRS 27.2).
"""

from __future__ import annotations

import secrets
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.context import RequestContext
from app.core.db import utcnow
from app.core.errors import (
    ConflictError, DraftConflictError, NotFoundError, ValidationError,
    error_from_matrix,
)
from app.core.permissions import Action, Module
from app.engine.dto import EngineExecutionRequest, RuntimeCredential
from app.engine.registry import get_adapter
from app.models.enums import (
    CredentialStatus, ExecutionStatus, HealthLevel, OverlapPolicy, TriggerType,
    WebhookAuthMode, WorkflowStatus,
)
from app.models.execution import Execution
from app.models.workflow import (
    Credential, TriggerBinding, Workflow, WorkflowDraft, WorkflowVersion,
)
from app.services import audit, catalog, schedules
from app.services.graph import (
    ValidationResult, empty_graph, graph_hash, trigger_of, validate_graph,
)

MAX_NAME_LENGTH = 200


# ── reads ──────────────────────────────────────────────────────────────────
async def get_workflow(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID
) -> Workflow:
    """Workspace-scoped by construction. A cross-tenant id is a 404."""
    row = await session.scalar(
        select(Workflow).where(
            Workflow.id == workflow_id,
            Workflow.workspace_id == ctx.workspace_id,
            Workflow.deleted_at.is_(None),
        )
    )
    if row is None:
        raise NotFoundError("Không tìm thấy workflow.")
    return row


# Both of these take the workspace as well as the workflow, even though a
# workflow id already implies one. The tenant filter is then visible in the
# query rather than remembered by whoever calls it, and the isolation test can
# assert on the query instead of on a chain of callers being careful (SRS 4.1).
async def _last_execution(
    session: AsyncSession, workspace_id: uuid.UUID, workflow_id: uuid.UUID
) -> Execution | None:
    return await session.scalar(
        select(Execution)
        .where(
            Execution.workspace_id == workspace_id,
            Execution.workflow_id == workflow_id,
        )
        .order_by(Execution.queued_at.desc())
        .limit(1)
    )


async def _active_execution_count(
    session: AsyncSession, workspace_id: uuid.UUID, workflow_id: uuid.UUID
) -> int:
    from app.models.enums import ACTIVE_EXECUTION_STATUSES

    return int(await session.scalar(
        select(func.count(Execution.id)).where(
            Execution.workspace_id == workspace_id,
            Execution.workflow_id == workflow_id,
            Execution.status.in_(list(ACTIVE_EXECUTION_STATUSES)),
        )
    ) or 0)


async def derive_health(
    session: AsyncSession, workflow: Workflow
) -> dict[str, Any]:
    """Health, derived and never stored as lifecycle (SRS 18.3).

    Order matters: a running workflow reads as RUNNING even if its last
    finished run failed, and a credential problem outranks a failure because it
    names something the user can fix.
    """
    trigger = workflow.triggers[0] if workflow.triggers else None
    last = await _last_execution(session, workflow.workspace_id, workflow.id)

    if await _active_execution_count(session, workflow.workspace_id, workflow.id):
        return {"level": HealthLevel.RUNNING.value, "code": None,
                "label": "Đang chạy"}

    credential_problem = await _credential_problem(session, workflow)
    if credential_problem:
        return {"level": HealthLevel.ACTION_REQUIRED.value,
                "code": "CREDENTIAL_INVALID",
                "label": "Cần xử lý",
                "message": credential_problem}

    if workflow.published_version_id is None:
        return {"level": HealthLevel.DRAFT_ONLY.value, "code": None,
                "label": "Chỉ có draft"}
    if not (trigger and trigger.enabled):
        return {"level": HealthLevel.INACTIVE.value, "code": None,
                "label": "Chưa bật"}
    if last is None:
        return {"level": HealthLevel.NEVER_RUN.value, "code": None,
                "label": "Chưa chạy lần nào"}
    if last.status is ExecutionStatus.SUCCEEDED:
        return {"level": HealthLevel.HEALTHY.value, "code": None, "label": "Bình thường"}
    if last.status in (ExecutionStatus.FAILED, ExecutionStatus.TIMED_OUT,
                       ExecutionStatus.ENGINE_INTERRUPTED,
                       ExecutionStatus.FAILED_TO_START):
        return {"level": HealthLevel.FAILED.value, "code": last.error_code,
                "label": "Lần chạy gần nhất thất bại"}
    return {"level": HealthLevel.WARNING.value, "code": last.error_code,
            "label": "Cần theo dõi"}


async def _credential_problem(
    session: AsyncSession, workflow: Workflow
) -> str | None:
    """Whether the graph a trigger would fire depends on a broken credential."""
    version_id = workflow.active_version_id or workflow.published_version_id
    graph = None
    if version_id:
        version = await session.get(WorkflowVersion, version_id)
        graph = version.graph_json if version else None
    elif workflow.draft:
        graph = workflow.draft.graph_json
    if not graph:
        return None

    definitions = await catalog.definitions_map(session)
    from app.services.graph import collect_credential_ids

    ids = collect_credential_ids(graph, definitions)
    if not ids:
        return None
    parsed = []
    for raw in ids:
        try:
            parsed.append(uuid.UUID(raw))
        except ValueError:
            continue
    if not parsed:
        return None

    # Scoped to the workflow's own tenant. A graph can name any UUID -- it is
    # a value in a JSONB column, not a foreign key -- so without this filter a
    # reference to another tenant's credential would be read, and its *name*
    # returned in the health message below. The reference resolving at all is
    # already wrong; it must not also describe what it found (SRS 4.1).
    rows = list((await session.scalars(
        select(Credential).where(
            Credential.workspace_id == workflow.workspace_id,
            Credential.id.in_(parsed),
        )
    )).all())
    found = {row.id for row in rows if row.deleted_at is None}
    missing = [p for p in parsed if p not in found]
    if missing:
        return "Một thông tin xác thực mà workflow dùng đã bị xóa."
    broken = [
        row for row in rows
        if row.status in (CredentialStatus.INVALID, CredentialStatus.REVOKED)
    ]
    if broken:
        return f"Thông tin xác thực '{broken[0].name}' không còn hợp lệ."
    return None


def available_actions(
    ctx: RequestContext, workflow: Workflow, health: dict[str, Any]
) -> list[str]:
    """What the backend says this caller may do next (SRS 80).

    The FE renders these; it does not recompute the state machine. Keeping the
    decision here is what stops the editor and the list page disagreeing about
    whether a workflow can be activated.
    """
    actions: list[str] = []
    trigger = workflow.triggers[0] if workflow.triggers else None

    if ctx.can(Module.WORKFLOWS, Action.EDIT):
        actions.append("EDIT")
    if ctx.can(Module.WORKFLOWS, Action.EXECUTE):
        actions.append("RUN_DRAFT")
    if ctx.can(Module.WORKFLOWS, Action.PUBLISH):
        actions.append("PUBLISH")
        if workflow.published_version_id:
            if trigger and trigger.enabled:
                actions.append("DEACTIVATE")
            else:
                actions.append("ACTIVATE")
    if health.get("code") == "CREDENTIAL_INVALID":
        actions.append("UPDATE_CREDENTIAL")
    if ctx.can(Module.WORKFLOWS, Action.CREATE):
        actions.append("DUPLICATE")
    if ctx.can(Module.WORKFLOWS, Action.DELETE):
        actions.append("DELETE")
    return actions


async def summary_view(
    session: AsyncSession, ctx: RequestContext, workflow: Workflow
) -> dict[str, Any]:
    health = await derive_health(session, workflow)
    last = await _last_execution(session, workflow.workspace_id, workflow.id)
    trigger = workflow.triggers[0] if workflow.triggers else None
    published = (
        await session.get(WorkflowVersion, workflow.published_version_id)
        if workflow.published_version_id else None
    )
    active = (
        await session.get(WorkflowVersion, workflow.active_version_id)
        if workflow.active_version_id else None
    )
    draft = workflow.draft

    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "status": workflow.status.value,
        "draft": {
            "revision": draft.revision if draft else 0,
            "graph_hash": draft.graph_hash if draft else "",
            "has_changes_since_publish": bool(
                draft and published and draft.graph_hash != published.graph_hash
            ) or bool(draft and not published and draft.graph_hash),
            "updated_at": draft.updated_at if draft else None,
            "validation": (draft.validation_state if draft else None),
        },
        "published": {
            "version": published.version_number,
            "published_at": published.published_at,
        } if published else None,
        "active_version": active.version_number if active else None,
        "trigger": {
            "type": trigger.trigger_type.value,
            "enabled": trigger.enabled,
            "summary": _trigger_summary(trigger),
            "next_run_at": trigger.next_run_at,
        } if trigger else None,
        "last_execution": {
            "id": last.id,
            "short_id": last.short_id,
            "status": last.status.value,
            "ended_at": last.ended_at,
            "started_at": last.started_at,
            "duration_ms": last.duration_ms,
            "failed_node_name": last.failed_node_name,
        } if last else None,
        "health": health,
        "available_actions": available_actions(ctx, workflow, health),
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at,
    }


def _trigger_summary(trigger: TriggerBinding) -> str:
    if trigger.trigger_type is TriggerType.SCHEDULE:
        return schedules.describe(trigger.config_json or {})
    if trigger.trigger_type is TriggerType.WEBHOOK:
        return f"{(trigger.config_json or {}).get('method', 'POST')} webhook"
    return "Chạy thủ công"


async def list_workflows(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    query: str | None = None,
    status: str | None = None,
    trigger_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    ctx.require(Module.WORKFLOWS, Action.VIEW)

    statement = select(Workflow).where(
        Workflow.workspace_id == ctx.workspace_id,
        Workflow.deleted_at.is_(None),
    )
    if status:
        statement = statement.where(Workflow.status == WorkflowStatus(status.upper()))
    if trigger_type:
        statement = statement.where(
            Workflow.trigger_type_cache == TriggerType(trigger_type.upper()))
    if query:
        needle = f"%{query.strip().lower()}%"
        statement = statement.where(func.lower(Workflow.name).like(needle))

    total = int(await session.scalar(
        select(func.count()).select_from(statement.subquery())) or 0)
    rows = list((await session.scalars(
        statement.order_by(Workflow.updated_at.desc()).limit(limit).offset(offset)
    )).all())

    items = [await summary_view(session, ctx, row) for row in rows]

    # Counted from the page's rows, not with three more aggregate queries: the
    # numbers in the strip describe the same set the table shows.
    active = sum(1 for i in items if i["status"] == WorkflowStatus.ACTIVE.value)
    # Workflows a person should look at, which is not the same as executions
    # that failed. A draft-only workflow whose test run failed is not in
    # trouble; a live one whose last run failed, or whose credential is gone,
    # is. The strip on this page describes *workflows*, so it counts those --
    # and it used to be labelled "failures in 24 hours", which meant it read
    # zero while a run had just failed on screen.
    needs_attention = sum(
        1 for i in items
        if i["health"]["level"] in {
            HealthLevel.FAILED.value, HealthLevel.ACTION_REQUIRED.value})
    draft_only = sum(
        1 for i in items if i["health"]["level"] == HealthLevel.DRAFT_ONLY.value)

    return {
        "items": items,
        "page": {"total": total, "limit": limit, "offset": offset,
                 "has_more": offset + len(rows) < total},
        "summary": {"total": total, "active": active,
                    "needs_attention": needs_attention,
                    "draft_only": draft_only},
    }


# ── writes ─────────────────────────────────────────────────────────────────
async def create(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    name: str,
    description: str | None = None,
    trigger_node_key: str = "manual_trigger",
) -> Workflow:
    ctx.require(Module.WORKFLOWS, Action.CREATE)
    name = (name or "").strip()
    if not name:
        raise ValidationError("Tên workflow không được để trống.")
    if len(name) > MAX_NAME_LENGTH:
        raise ValidationError("Tên workflow quá dài.")

    # The registry entry for the chosen trigger, so the seeded node is
    # equivalent to one added from the palette rather than a bare stub.
    definitions = await catalog.definitions_map(session)
    definition = definitions.get(trigger_node_key)
    if definition is None:
        raise ValidationError(
            f"Bước bắt đầu '{trigger_node_key}' không tồn tại.",
            code="NODE_UNSUPPORTED", details={"field": "trigger_node_key"})
    if not (definition.get("capability") or {}).get("is_trigger"):
        raise ValidationError(
            f"'{definition.get('display_name', trigger_node_key)}' không phải "
            "bước bắt đầu.",
            code="NODE_UNSUPPORTED", details={"field": "trigger_node_key"})

    workflow = Workflow(
        workspace_id=ctx.workspace_id,
        name=name,
        description=(description or None),
        status=WorkflowStatus.INACTIVE,
        created_by=ctx.user_id,
        updated_by=ctx.user_id,
        trigger_type_cache=TriggerType.MANUAL,
    )
    session.add(workflow)
    await session.flush()

    graph = empty_graph(trigger_node_key, definition)
    session.add(WorkflowDraft(
        workflow_id=workflow.id,
        workspace_id=ctx.workspace_id,
        graph_json=graph,
        graph_hash=graph_hash(graph),
        revision=1,
        saved_by=ctx.user_id,
        updated_at=utcnow(),
    ))
    # The binding exists from creation so a webhook URL is allocated once and
    # stays stable, rather than appearing the first time somebody activates.
    session.add(TriggerBinding(
        workflow_id=workflow.id,
        workspace_id=ctx.workspace_id,
        trigger_type=TriggerType.MANUAL,
        enabled=False,
        config_json={},
    ))
    await session.flush()
    await session.refresh(workflow)

    # The same sync a draft save performs, run once here. Without it the
    # binding stays MANUAL until the user's first edit -- so a webhook
    # workflow reported its trigger as "Thủ công" and showed no webhook URL
    # on the screen where somebody has just chosen a webhook.
    await _sync_trigger_from_graph(session, ctx, workflow, graph, definitions)
    await session.flush()
    await session.refresh(workflow)

    await audit.record(
        session, ctx, action="workflow.created", resource_type="WORKFLOW",
        resource_id=workflow.id, resource_label=workflow.name,
        after={"trigger": trigger_node_key})
    return workflow


async def rename(
    session: AsyncSession,
    ctx: RequestContext,
    workflow_id: uuid.UUID,
    *,
    name: str | None = None,
    description: str | None = None,
) -> Workflow:
    ctx.require(Module.WORKFLOWS, Action.EDIT)
    workflow = await get_workflow(session, ctx, workflow_id)
    before = {"name": workflow.name, "description": workflow.description}

    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise ValidationError("Tên workflow không được để trống.")
        workflow.name = cleaned[:MAX_NAME_LENGTH]
    if description is not None:
        workflow.description = description or None
    workflow.updated_by = ctx.user_id
    await session.flush()

    await audit.record(
        session, ctx, action="workflow.updated", resource_type="WORKFLOW",
        resource_id=workflow.id, resource_label=workflow.name,
        before=before, after={"name": workflow.name})
    return workflow


async def get_draft(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID
) -> dict[str, Any]:
    ctx.require(Module.WORKFLOWS, Action.VIEW)
    workflow = await get_workflow(session, ctx, workflow_id)
    draft = workflow.draft
    if draft is None:
        raise NotFoundError("Workflow chưa có draft.")
    return {
        "workflow_id": workflow.id,
        "name": workflow.name,
        "revision": draft.revision,
        "graph": draft.graph_json,
        "graph_hash": draft.graph_hash,
        "product_schema_version": draft.product_schema_version,
        "validation": draft.validation_state,
        "updated_at": draft.updated_at,
    }


async def save_draft(
    session: AsyncSession,
    ctx: RequestContext,
    workflow_id: uuid.UUID,
    *,
    graph: dict[str, Any],
    expected_revision: int,
) -> dict[str, Any]:
    """Persist the canvas. Never calls the engine (SRS 8.1).

    `expected_revision` is not advisory. Autosave fires every second or two
    from every open editor, and without the check the last tab to save wins
    silently — which is how somebody loses twenty minutes of work to a
    colleague's stale tab.
    """
    ctx.require(Module.WORKFLOWS, Action.EDIT)
    workflow = await get_workflow(session, ctx, workflow_id)
    draft = workflow.draft
    if draft is None:
        raise NotFoundError("Workflow chưa có draft.")

    if int(expected_revision) != int(draft.revision):
        raise DraftConflictError(
            details={"server_revision": draft.revision,
                     "your_revision": int(expected_revision)},
            remediation={"action": "RELOAD_DRAFT"})

    definitions = await catalog.definitions_map(session)
    result = validate_graph(graph, definitions, require_trigger=False)

    draft.graph_json = graph
    draft.graph_hash = graph_hash(graph)
    draft.revision = int(draft.revision) + 1
    draft.validation_state = result.as_dict()
    draft.saved_by = ctx.user_id
    draft.updated_at = utcnow()

    # The trigger the canvas declares decides which binding shape the workflow
    # has. Doing it on save (rather than on activate) is what lets the editor
    # show a webhook URL and the next three schedule fire times while the user
    # is still building.
    await _sync_trigger_from_graph(session, ctx, workflow, graph, definitions)

    workflow.updated_by = ctx.user_id
    await session.flush()

    return {
        "workflow_id": workflow.id,
        "revision": draft.revision,
        "graph_hash": draft.graph_hash,
        "validation": draft.validation_state,
        "updated_at": draft.updated_at,
    }


async def _sync_trigger_from_graph(
    session: AsyncSession,
    ctx: RequestContext,
    workflow: Workflow,
    graph: dict[str, Any],
    definitions: dict[str, dict[str, Any]],
) -> None:
    node = trigger_of(graph, definitions)
    binding = workflow.triggers[0] if workflow.triggers else None
    if binding is None:
        binding = TriggerBinding(
            workflow_id=workflow.id, workspace_id=workflow.workspace_id,
            trigger_type=TriggerType.MANUAL, enabled=False, config_json={})
        session.add(binding)
        await session.flush()
        workflow.triggers.append(binding)

    if node is None:
        return

    capability = (definitions.get(str(node.get("node_key"))) or {}).get("capability") or {}
    declared = capability.get("trigger_type") or "MANUAL"
    trigger_type = TriggerType(declared)
    config = node.get("config") or {}

    changed_type = binding.trigger_type is not trigger_type
    binding.trigger_type = trigger_type
    workflow.trigger_type_cache = trigger_type

    if trigger_type is TriggerType.SCHEDULE:
        normalized = schedules.validate(config, workspace_timezone=ctx.timezone)
        binding.config_json = normalized
        binding.overlap_policy = OverlapPolicy(normalized["overlap_policy"])
        if binding.enabled:
            # A schedule edit takes effect from now, not from the old cadence.
            binding.next_run_at = schedules.next_run_at(normalized)
    elif trigger_type is TriggerType.WEBHOOK:
        binding.config_json = {
            "method": str(config.get("method") or "POST").upper(),
            "auth_mode": str(config.get("auth_mode") or "HEADER_SIGNATURE").upper(),
            "allowed_content_type": config.get("allowed_content_type")
            or "application/json",
            "max_body_bytes": min(
                int(config.get("max_body_bytes") or settings.webhook_max_body_bytes),
                settings.webhook_max_body_bytes),
        }
        if not binding.public_key:
            # 32 hex characters of randomness. Not the workflow UUID: a public
            # path built from a product id invites enumeration (SRS 17.3).
            binding.public_key = secrets.token_hex(16)
        if binding.config_json["auth_mode"] != WebhookAuthMode.NONE.value \
                and not binding.webhook_secret_ref:
            from app.core.secrets import secret_store

            binding.webhook_secret_ref = await secret_store.write(
                session, workflow.workspace_id,
                {"secret": secrets.token_urlsafe(32)})
        binding.next_run_at = None
    else:
        binding.config_json = {}
        binding.next_run_at = None

    if changed_type and binding.enabled:
        # Changing the trigger type of an active workflow silently would leave
        # a schedule firing a graph that now declares a webhook. Deactivate and
        # make the user re-activate deliberately.
        binding.enabled = False
        workflow.status = WorkflowStatus.INACTIVE
        await audit.record(
            session, ctx, action="workflow.deactivated", resource_type="WORKFLOW",
            resource_id=workflow.id, resource_label=workflow.name,
            after={"reason": "TRIGGER_TYPE_CHANGED"})

    await session.flush()


async def validate(
    session: AsyncSession,
    ctx: RequestContext,
    workflow_id: uuid.UUID,
    *,
    with_engine: bool = True,
) -> dict[str, Any]:
    """Product validation, then the engine's compile dry-run.

    Engine unavailability is reported, not fatal: the editor must keep working
    and telling the user what the product itself could check (SRS 9.6).
    """
    ctx.require(Module.WORKFLOWS, Action.VIEW)
    workflow = await get_workflow(session, ctx, workflow_id)
    draft = workflow.draft
    if draft is None:
        raise NotFoundError("Workflow chưa có draft.")

    definitions = await catalog.definitions_map(session)
    result = validate_graph(draft.graph_json or {}, definitions)
    issues = [i.as_dict() for i in result.issues]
    credential_issues, credential_rows = await _credential_issues(session, ctx, result)
    issues.extend(credential_issues)

    engine_state = "SKIPPED"
    if with_engine and not any(i["severity"] == "ERROR" for i in issues):
        engine_state, engine_issues = await _engine_validate(
            session, ctx, workflow, draft.graph_json or {}, definitions,
            credentials=credential_rows)
        issues.extend(engine_issues)

    payload = {
        "ok": not any(i["severity"] == "ERROR" for i in issues),
        "issues": issues,
        "engine": engine_state,
        "trigger_node_id": result.trigger_node_id,
        "trigger_node_key": result.trigger_node_key,
    }
    draft.validation_state = payload
    await session.flush()
    return payload


async def _credential_issues(
    session: AsyncSession, ctx: RequestContext, result: ValidationResult
) -> tuple[list[dict[str, Any]], list[Credential]]:
    """Credentials the graph names but the workspace cannot use.

    Checked here rather than in `services.graph` because it needs the database,
    and `graph` is deliberately pure.

    Also returns the rows it found, so the engine dry-run can be told which
    credentials exist and what type they are. Without that the compiler sees an
    unresolvable reference and reports `CREDENTIAL_REQUIRED`, which would make
    every workflow that authenticates to anything impossible to publish.
    """
    if not result.credential_ids:
        return [], []
    parsed: dict[str, uuid.UUID] = {}
    issues: list[dict[str, Any]] = []
    for raw in result.credential_ids:
        try:
            parsed[raw] = uuid.UUID(raw)
        except ValueError:
            issues.append({
                "code": "CREDENTIAL_REQUIRED",
                "message": "Một bước tham chiếu thông tin xác thực không hợp lệ.",
                "node_id": None, "field": None, "severity": "ERROR"})
    if not parsed:
        return issues, []

    rows = {
        row.id: row
        for row in (await session.scalars(
            select(Credential).where(
                Credential.id.in_(list(parsed.values())),
                Credential.workspace_id == ctx.workspace_id,
                Credential.deleted_at.is_(None),
            )
        )).all()
    }
    for raw, parsed_id in parsed.items():
        row = rows.get(parsed_id)
        if row is None:
            issues.append({
                "code": "CREDENTIAL_REQUIRED",
                "message": "Thông tin xác thực được dùng không còn tồn tại.",
                "node_id": None, "field": None, "severity": "ERROR"})
        elif row.status in (CredentialStatus.INVALID, CredentialStatus.REVOKED):
            issues.append({
                "code": "CREDENTIAL_INVALID",
                "message": f"Thông tin xác thực '{row.name}' không còn hợp lệ.",
                "node_id": None, "field": None, "severity": "ERROR"})
    return issues, list(rows.values())


async def _engine_validate(
    session: AsyncSession,
    ctx: RequestContext,
    workflow: Workflow,
    graph: dict[str, Any],
    definitions: dict[str, dict[str, Any]],
    *,
    credentials: list[Credential] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    from app.core.errors import AppError

    adapter = get_adapter()
    request = EngineExecutionRequest(
        execution_id=f"validate_{workflow.id}",
        workspace_ref=str(ctx.workspace_id),
        graph=graph,
        registry=catalog.registry_snapshot(definitions),
        start_payload={},
        # Identity and type, with an empty payload. The compiler needs to know
        # the reference resolves and that the type maps to an authentication it
        # supports -- neither of which needs the secret. Nothing is executed
        # here, so there is nothing for a value to be used by, and a dry run is
        # the last place a secret should be sent (SRS 12.2).
        credentials=[
            RuntimeCredential(
                credential_id=str(row.id),
                credential_type=row.credential_type.value,
                data={},
            )
            for row in (credentials or [])
        ],
        trace_id=ctx.trace_id,
        egress_policy=_egress_policy(),
    )
    try:
        outcome = await adapter.validate(request)
    except AppError as exc:
        # Reported as a state, not raised: the editor shows "could not verify
        # with the engine" and keeps every product-side finding it has.
        return "UNAVAILABLE", [{
            "code": exc.code, "message": exc.message,
            "node_id": None, "field": None, "severity": "WARNING"}]

    return ("OK" if outcome.ok else "INVALID"), [
        {"code": d.code, "message": d.message, "node_id": d.node_id,
         "field": d.field, "severity": d.severity}
        for d in outcome.diagnostics
    ]


def _egress_policy() -> dict[str, Any]:
    return {
        "allow_private_networks": settings.egress_allow_private_networks,
        "allowed_hosts": settings.egress_allowed_host_list,
        "blocked_hosts": settings.egress_blocked_host_list,
        "max_redirects": settings.egress_max_redirects,
        "max_response_bytes": settings.egress_max_response_bytes,
        "request_timeout_seconds": settings.egress_request_timeout_seconds,
    }


async def publish(
    session: AsyncSession,
    ctx: RequestContext,
    workflow_id: uuid.UUID,
    *,
    expected_revision: int | None = None,
    change_note: str | None = None,
) -> dict[str, Any]:
    """Freeze the draft into an immutable version (SRS 27.2).

    Deliberately does not activate. Publishing says "this is good"; activating
    says "run this in production" — and a product that conflates them cannot
    offer a rollback that does not republish (SRS 69.4).
    """
    ctx.require(Module.WORKFLOWS, Action.PUBLISH)
    workflow = await get_workflow(session, ctx, workflow_id)
    draft = workflow.draft
    if draft is None:
        raise NotFoundError("Workflow chưa có draft.")

    if expected_revision is not None and int(expected_revision) != int(draft.revision):
        raise DraftConflictError(
            details={"server_revision": draft.revision,
                     "your_revision": int(expected_revision)})

    outcome = await validate(session, ctx, workflow_id, with_engine=True)
    if not outcome["ok"]:
        raise error_from_matrix(
            "WORKFLOW_INVALID",
            details={"issues": outcome["issues"]})
    if outcome["engine"] == "UNAVAILABLE":
        # No certified compile means no publish. Freezing a version we could
        # not compile would make it publishable-but-unrunnable, which is worse
        # than making the user wait (SRS 27.2).
        raise error_from_matrix("ENGINE_UNAVAILABLE")

    next_number = int(await session.scalar(
        select(func.coalesce(func.max(WorkflowVersion.version_number), 0)).where(
            WorkflowVersion.workflow_id == workflow.id)
    ) or 0) + 1

    version = WorkflowVersion(
        workflow_id=workflow.id,
        workspace_id=ctx.workspace_id,
        version_number=next_number,
        graph_json=draft.graph_json,
        graph_hash=draft.graph_hash,
        product_schema_version=draft.product_schema_version,
        compiler_version=settings.adapter_contract_version,
        engine_compatibility_set=settings.product_version,
        published_by=ctx.user_id,
        published_at=utcnow(),
        change_note=(change_note or None),
    )
    session.add(version)
    await session.flush()

    workflow.published_version_id = version.id
    workflow.updated_by = ctx.user_id
    await session.flush()

    await audit.record(
        session, ctx, action="workflow.published", resource_type="WORKFLOW",
        resource_id=workflow.id, resource_label=workflow.name,
        after={"version": next_number, "graph_hash": version.graph_hash,
               "change_note": change_note})

    return {
        "id": version.id,
        "version": version.version_number,
        "graph_hash": version.graph_hash,
        "published_at": version.published_at,
        "change_note": version.change_note,
    }


async def list_versions(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID
) -> list[dict[str, Any]]:
    ctx.require(Module.WORKFLOWS, Action.VIEW)
    workflow = await get_workflow(session, ctx, workflow_id)
    rows = list((await session.scalars(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow.id)
        .order_by(WorkflowVersion.version_number.desc())
    )).all())
    return [
        {
            "id": row.id,
            "version": row.version_number,
            "graph_hash": row.graph_hash,
            "published_at": row.published_at,
            "published_by": row.published_by,
            "change_note": row.change_note,
            "compiler_version": row.compiler_version,
            "is_active": row.id == workflow.active_version_id,
            "is_latest": row.id == workflow.published_version_id,
        }
        for row in rows
    ]


async def get_version(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID, number: int
) -> dict[str, Any]:
    ctx.require(Module.WORKFLOWS, Action.VIEW)
    workflow = await get_workflow(session, ctx, workflow_id)
    row = await session.scalar(
        select(WorkflowVersion).where(
            WorkflowVersion.workflow_id == workflow.id,
            WorkflowVersion.version_number == number,
        )
    )
    if row is None:
        raise NotFoundError(f"Không tìm thấy phiên bản v{number}.")
    return {
        "id": row.id,
        "version": row.version_number,
        "graph": row.graph_json,
        "graph_hash": row.graph_hash,
        "published_at": row.published_at,
        "change_note": row.change_note,
        "is_active": row.id == workflow.active_version_id,
    }


async def activate(
    session: AsyncSession,
    ctx: RequestContext,
    workflow_id: uuid.UUID,
    *,
    version_number: int | None = None,
) -> dict[str, Any]:
    """Point the trigger at one exact published version (SRS 27.5).

    Defaults to the latest published version. Naming an older one is the
    rollback path, and it does not create a new version.
    """
    ctx.require(Module.WORKFLOWS, Action.PUBLISH)
    workflow = await get_workflow(session, ctx, workflow_id)

    if version_number is None:
        if workflow.published_version_id is None:
            raise error_from_matrix("WORKFLOW_NOT_PUBLISHED")
        version = await session.get(WorkflowVersion, workflow.published_version_id)
    else:
        version = await session.scalar(
            select(WorkflowVersion).where(
                WorkflowVersion.workflow_id == workflow.id,
                WorkflowVersion.version_number == version_number,
            )
        )
    if version is None:
        raise NotFoundError("Không tìm thấy phiên bản để bật.")

    definitions = await catalog.definitions_map(session)
    result = validate_graph(version.graph_json or {}, definitions)
    if not result.ok:
        raise error_from_matrix(
            "WORKFLOW_INVALID",
            message="Phiên bản này không còn hợp lệ với cấu hình hiện tại.",
            details={"issues": [i.as_dict() for i in result.issues]})

    credential_issues, _ = await _credential_issues(session, ctx, result)
    blocking = [i for i in credential_issues if i["severity"] == "ERROR"]
    if blocking:
        raise error_from_matrix(
            "CREDENTIAL_INVALID", details={"issues": blocking})

    binding = workflow.triggers[0] if workflow.triggers else None
    if binding is None:
        raise ConflictError("Workflow chưa có trigger.")

    binding.workflow_version_id = version.id
    binding.enabled = True
    binding.activated_by = ctx.user_id
    if binding.trigger_type is TriggerType.SCHEDULE:
        binding.next_run_at = schedules.next_run_at(binding.config_json or {})
    workflow.active_version_id = version.id
    workflow.status = WorkflowStatus.ACTIVE
    workflow.updated_by = ctx.user_id
    await session.flush()

    await audit.record(
        session, ctx, action="workflow.activated", resource_type="WORKFLOW",
        resource_id=workflow.id, resource_label=workflow.name,
        after={"version": version.version_number,
               "trigger": binding.trigger_type.value,
               "next_run_at": binding.next_run_at.isoformat()
               if binding.next_run_at else None})

    return await summary_view(session, ctx, workflow)


async def deactivate(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID
) -> dict[str, Any]:
    ctx.require(Module.WORKFLOWS, Action.PUBLISH)
    workflow = await get_workflow(session, ctx, workflow_id)
    binding = workflow.triggers[0] if workflow.triggers else None
    if binding is not None:
        binding.enabled = False
        binding.next_run_at = None
    workflow.status = WorkflowStatus.INACTIVE
    # `active_version_id` is deliberately left in place: it is what a
    # re-activation restores, and clearing it would turn "pause this" into
    # "forget which version was running".
    workflow.updated_by = ctx.user_id
    await session.flush()

    await audit.record(
        session, ctx, action="workflow.deactivated", resource_type="WORKFLOW",
        resource_id=workflow.id, resource_label=workflow.name)
    return await summary_view(session, ctx, workflow)


async def duplicate(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID
) -> Workflow:
    """Copy the draft graph only (SRS 13.4).

    Not activated, no versions carried over, and a fresh webhook key — a copy
    that inherited the original's public URL would receive its traffic.
    """
    ctx.require(Module.WORKFLOWS, Action.CREATE)
    source = await get_workflow(session, ctx, workflow_id)
    if source.draft is None:
        raise NotFoundError("Workflow chưa có draft để nhân bản.")

    copy = Workflow(
        workspace_id=ctx.workspace_id,
        name=f"{source.name} (copy)"[:MAX_NAME_LENGTH],
        description=source.description,
        status=WorkflowStatus.INACTIVE,
        created_by=ctx.user_id,
        updated_by=ctx.user_id,
        trigger_type_cache=source.trigger_type_cache,
    )
    session.add(copy)
    await session.flush()

    graph = source.draft.graph_json
    session.add(WorkflowDraft(
        workflow_id=copy.id,
        workspace_id=ctx.workspace_id,
        graph_json=graph,
        graph_hash=graph_hash(graph),
        revision=1,
        saved_by=ctx.user_id,
        updated_at=utcnow(),
    ))
    session.add(TriggerBinding(
        workflow_id=copy.id,
        workspace_id=ctx.workspace_id,
        trigger_type=source.trigger_type_cache or TriggerType.MANUAL,
        enabled=False,
        config_json=dict(
            (source.triggers[0].config_json or {}) if source.triggers else {}),
    ))
    await session.flush()
    await session.refresh(copy)

    definitions = await catalog.definitions_map(session)
    await _sync_trigger_from_graph(session, ctx, copy, graph, definitions)

    await audit.record(
        session, ctx, action="workflow.duplicated", resource_type="WORKFLOW",
        resource_id=copy.id, resource_label=copy.name,
        after={"source_workflow_id": str(source.id)})
    return copy


async def delete(
    session: AsyncSession, ctx: RequestContext, workflow_id: uuid.UUID
) -> None:
    """Soft delete (SRS 13.5, 79).

    Refuses while active or while a run is in flight: deleting a workflow whose
    execution is halfway through an external API call would leave that call's
    outcome unattributable.
    """
    ctx.require(Module.WORKFLOWS, Action.DELETE)
    workflow = await get_workflow(session, ctx, workflow_id)

    if workflow.status is WorkflowStatus.ACTIVE:
        raise ConflictError(
            "Hãy tắt workflow trước khi xóa.",
            remediation={"action": "DEACTIVATE"})
    if await _active_execution_count(
            session, workflow.workspace_id, workflow.id):
        raise error_from_matrix("WORKFLOW_ALREADY_RUNNING")

    workflow.deleted_at = utcnow()
    workflow.status = WorkflowStatus.DELETED
    for binding in workflow.triggers:
        binding.enabled = False
        binding.next_run_at = None
        # Release the public path so it cannot be hit after deletion.
        binding.public_key = None
    await session.flush()

    await audit.record(
        session, ctx, action="workflow.deleted", resource_type="WORKFLOW",
        resource_id=workflow.id, resource_label=workflow.name)


async def webhook_url(binding: TriggerBinding) -> str | None:
    if binding.trigger_type is not TriggerType.WEBHOOK or not binding.public_key:
        return None
    return f"{settings.public_base_url.rstrip('/')}/hooks/{binding.public_key}"
