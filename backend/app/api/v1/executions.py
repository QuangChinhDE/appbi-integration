"""Execution routes (SRS 23.4)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query

from app.api.deps import CtxDep, SessionDep
from app.services import executions as service

router = APIRouter(prefix="/executions", tags=["executions"])


@router.get("")
async def list_executions(
    ctx: CtxDep,
    session: SessionDep,
    workflow_id: uuid.UUID | None = None,
    status: str | None = None,
    trigger: str | None = None,
    version_kind: str | None = None,
    error_code: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    return await service.list_executions(
        session, ctx, workflow_id=workflow_id, status=status, trigger_type=trigger,
        version_kind=version_kind, error_code=error_code, limit=limit, offset=offset)


@router.get("/{execution_id}")
async def get_execution(
    execution_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    execution = await service.get(session, ctx, execution_id)
    return await service.detail_view(session, ctx, execution)


@router.get("/{execution_id}/nodes")
async def list_node_results(
    execution_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    execution = await service.get(session, ctx, execution_id)
    detail = await service.detail_view(session, ctx, execution)
    return {"items": detail["nodes"]}


@router.get("/{execution_id}/nodes/{node_id}/input")
async def node_input(
    execution_id: uuid.UUID, node_id: str, ctx: CtxDep, session: SessionDep
) -> dict:
    return await service.node_payload(
        session, ctx, execution_id, node_id, direction="input")


@router.get("/{execution_id}/nodes/{node_id}/output")
async def node_output(
    execution_id: uuid.UUID, node_id: str, ctx: CtxDep, session: SessionDep
) -> dict:
    return await service.node_payload(
        session, ctx, execution_id, node_id, direction="output")


@router.get("/{execution_id}/logs")
async def execution_logs(
    execution_id: uuid.UUID,
    ctx: CtxDep,
    session: SessionDep,
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict:
    return await service.logs(session, ctx, execution_id, cursor=cursor, limit=limit)


@router.post("/{execution_id}/cancel")
async def cancel_execution(
    execution_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    execution = await service.cancel(session, ctx, execution_id)
    await session.commit()
    return service.summary_view(execution)


@router.post("/{execution_id}/retry", status_code=202)
async def retry_execution(
    execution_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    execution = await service.retry(session, ctx, execution_id)
    await session.commit()
    return service.summary_view(execution)
