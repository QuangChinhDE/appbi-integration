"""Workflow routes (SRS 23.3).

Saving a draft is a plain database write and answers in milliseconds; publish
and activate are the ones that talk to the engine. Keeping them as separate
endpoints is what makes autosave safe to fire every second.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Header, Query, Response, status
from pydantic import BaseModel, Field

from app.api.deps import CtxDep, SessionDep
from app.models.enums import TriggerType, VersionKind
from app.services import executions as execution_service
from app.services import triggers as trigger_service
from app.services import workflows as service

router = APIRouter(prefix="/workflows", tags=["workflows"])


class CreateWorkflowRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    trigger_node_key: str = "manual_trigger"


class UpdateWorkflowRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None


class SaveDraftRequest(BaseModel):
    graph: dict[str, Any]
    #: The revision the editor read. A mismatch is a 409, never a silent
    #: overwrite of somebody else's canvas (SRS 14.6).
    expected_revision: int


class PublishRequest(BaseModel):
    expected_revision: int | None = None
    change_note: str | None = Field(default=None, max_length=1000)


class ActivateRequest(BaseModel):
    #: Omit for the latest published version; name one to roll back (SRS 69.4).
    version_number: int | None = None


class RunRequest(BaseModel):
    kind: str = "DRAFT"
    payload: Any = None


@router.get("")
async def list_workflows(
    ctx: CtxDep,
    session: SessionDep,
    q: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    trigger: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    return await service.list_workflows(
        session, ctx, query=q, status=status_filter, trigger_type=trigger,
        limit=limit, offset=offset)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    payload: CreateWorkflowRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    workflow = await service.create(
        session, ctx, name=payload.name, description=payload.description,
        trigger_node_key=payload.trigger_node_key)
    await session.commit()
    return await service.summary_view(session, ctx, workflow)


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    workflow = await service.get_workflow(session, ctx, workflow_id)
    body = await service.summary_view(session, ctx, workflow)
    if workflow.triggers:
        body["trigger_detail"] = trigger_service.trigger_view(workflow.triggers[0])
    return body


@router.patch("/{workflow_id}")
async def update_workflow(
    workflow_id: uuid.UUID,
    payload: UpdateWorkflowRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    workflow = await service.rename(
        session, ctx, workflow_id, name=payload.name, description=payload.description)
    await session.commit()
    return await service.summary_view(session, ctx, workflow)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> Response:
    await service.delete(session, ctx, workflow_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{workflow_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_workflow(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    copy = await service.duplicate(session, ctx, workflow_id)
    await session.commit()
    return await service.summary_view(session, ctx, copy)


# ── draft ──────────────────────────────────────────────────────────────────
@router.get("/{workflow_id}/draft")
async def get_draft(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    return await service.get_draft(session, ctx, workflow_id)


@router.put("/{workflow_id}/draft")
async def save_draft(
    workflow_id: uuid.UUID,
    payload: SaveDraftRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    result = await service.save_draft(
        session, ctx, workflow_id,
        graph=payload.graph, expected_revision=payload.expected_revision)
    await session.commit()
    return result


@router.post("/{workflow_id}/validate")
async def validate_workflow(
    workflow_id: uuid.UUID,
    ctx: CtxDep,
    session: SessionDep,
    with_engine: bool = True,
) -> dict:
    result = await service.validate(session, ctx, workflow_id, with_engine=with_engine)
    await session.commit()
    return result


# ── versions ───────────────────────────────────────────────────────────────
@router.get("/{workflow_id}/versions")
async def list_versions(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    return {"items": await service.list_versions(session, ctx, workflow_id)}


@router.get("/{workflow_id}/versions/{version_number}")
async def get_version(
    workflow_id: uuid.UUID, version_number: int, ctx: CtxDep, session: SessionDep
) -> dict:
    return await service.get_version(session, ctx, workflow_id, version_number)


@router.post("/{workflow_id}/publish", status_code=status.HTTP_201_CREATED)
async def publish_workflow(
    workflow_id: uuid.UUID,
    payload: PublishRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    result = await service.publish(
        session, ctx, workflow_id,
        expected_revision=payload.expected_revision, change_note=payload.change_note)
    await session.commit()
    return result


@router.post("/{workflow_id}/activate")
async def activate_workflow(
    workflow_id: uuid.UUID,
    payload: ActivateRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    result = await service.activate(
        session, ctx, workflow_id, version_number=payload.version_number)
    await session.commit()
    return result


@router.post("/{workflow_id}/deactivate")
async def deactivate_workflow(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await service.deactivate(session, ctx, workflow_id)
    await session.commit()
    return result


# ── trigger ────────────────────────────────────────────────────────────────
@router.get("/{workflow_id}/trigger")
async def get_trigger(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    workflow = await service.get_workflow(session, ctx, workflow_id)
    if not workflow.triggers:
        return {"trigger_type": TriggerType.MANUAL.value, "enabled": False, "config": {}}
    return trigger_service.trigger_view(workflow.triggers[0])


@router.post("/{workflow_id}/trigger/rotate-secret")
async def rotate_webhook_secret(
    workflow_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await trigger_service.rotate_webhook_secret(session, ctx, workflow_id)
    await session.commit()
    return result


# ── executions ─────────────────────────────────────────────────────────────
@router.post("/{workflow_id}/executions", status_code=status.HTTP_202_ACCEPTED)
async def run_workflow(
    workflow_id: uuid.UUID,
    payload: RunRequest,
    ctx: CtxDep,
    session: SessionDep,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    """Queue a run. 202, not 200: the workflow has not finished (SRS 23.4).

    A draft run flushes nothing here -- the FE must have saved first, and the
    execution row freezes whatever revision it finds, so the record always names
    the exact graph that ran.
    """
    kind = VersionKind(payload.kind.upper())
    trigger = TriggerType.MANUAL
    execution = await execution_service.create(
        session, ctx, workflow_id,
        kind=kind,
        trigger_type=trigger,
        start_payload=payload.payload,
        idempotency_key=idempotency_key,
    )
    await session.commit()
    return execution_service.summary_view(execution)
