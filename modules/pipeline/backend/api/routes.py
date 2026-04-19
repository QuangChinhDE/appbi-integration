from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from modules.pipeline.backend.services.pipeline_module_service import PipelineModuleService
from modules.pipeline.backend.services.pipeline_service import PipelineService
from packages.auth.src import require_permission
from packages.auth.src.dependencies import get_current_user
from packages.database.src import get_db


router = APIRouter(tags=['pipeline'])

# ── Read-only catalog endpoints (view permission) ─────────────────────────────

catalog_router = APIRouter(dependencies=[Depends(require_permission('pipeline', 'view'))])


class PipelineCatalogItem(BaseModel):
    key: str
    app_id: str
    app_name: str
    summary: str
    binding_source: str
    status: str
    selection_label: str
    credential_count: int = 0
    binding_fields: list[str] = Field(default_factory=list)
    sync_modes: list[str] = Field(default_factory=list)
    auth_modes: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    discovery: dict[str, Any] | None = None
    streams: list[dict[str, Any]] = Field(default_factory=list)


class PipelineOverviewResponse(BaseModel):
    module: dict[str, Any]
    source_count: int
    destination_count: int
    source_credential_count: int
    destination_credential_count: int
    ready_destination_count: int
    planned_destination_count: int
    sources: list[PipelineCatalogItem]
    destinations: list[PipelineCatalogItem]
    pipelines: list[dict[str, Any]] = Field(default_factory=list)
    pipeline_count: int = 0


@catalog_router.get('/api/pipeline/overview', response_model=PipelineOverviewResponse)
async def get_pipeline_overview(db: AsyncSession = Depends(get_db)):
    service = PipelineModuleService(db)
    overview = await service.get_overview()
    # Attach user pipelines
    pipeline_service = PipelineService(db)
    pipelines = await pipeline_service.list_pipelines()
    overview['pipelines'] = pipelines
    overview['pipeline_count'] = len(pipelines)
    return overview


@catalog_router.get('/api/pipeline/capabilities/{kind}/{capability_key}', response_model=PipelineCatalogItem)
async def get_pipeline_capability(
    kind: Literal['source', 'destination'],
    capability_key: str,
    db: AsyncSession = Depends(get_db),
):
    service = PipelineModuleService(db)
    capability = await service.get_capability(kind, capability_key)
    if capability is None:
        raise HTTPException(status_code=404, detail='Pipeline capability not found.')
    return capability


router.include_router(catalog_router)


# ── Pipeline CRUD endpoints (edit permission) ─────────────────────────────────

crud_router = APIRouter(dependencies=[Depends(require_permission('pipeline', 'edit'))])


class PipelineCreateRequest(BaseModel):
    name: str
    description: str | None = None
    source_connector_key: str
    source_credential_id: str | None = None
    source_streams: list[str] = Field(default_factory=list)
    source_config: dict[str, Any] | None = None
    dest_connector_key: str
    dest_credential_id: str | None = None
    dest_stream_key: str
    dest_config: dict[str, Any] | None = None
    write_mode: str = 'append'
    field_mapping: dict[str, Any] | None = None
    schedule: dict[str, Any] | None = None
    status: str = 'draft'


class PipelineUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    source_connector_key: str | None = None
    source_credential_id: str | None = None
    source_streams: list[str] | None = None
    source_config: dict[str, Any] | None = None
    dest_connector_key: str | None = None
    dest_credential_id: str | None = None
    dest_stream_key: str | None = None
    dest_config: dict[str, Any] | None = None
    write_mode: str | None = None
    field_mapping: dict[str, Any] | None = None
    schedule: dict[str, Any] | None = None


@crud_router.post('/api/pipeline/pipelines')
async def create_pipeline(
    body: PipelineCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(get_current_user),
):
    service = PipelineService(db)
    pipeline = await service.create_pipeline(body.model_dump(exclude_none=True), owner_id=user.id)
    await db.commit()
    return pipeline


@crud_router.get('/api/pipeline/pipelines')
async def list_pipelines(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    service = PipelineService(db)
    return await service.list_pipelines(status=status)


@crud_router.get('/api/pipeline/pipelines/{pipeline_id}')
async def get_pipeline(pipeline_id: UUID, db: AsyncSession = Depends(get_db)):
    service = PipelineService(db)
    pipeline = await service.get_pipeline(pipeline_id)
    if pipeline is None:
        raise HTTPException(status_code=404, detail='Pipeline not found.')
    return pipeline


@crud_router.put('/api/pipeline/pipelines/{pipeline_id}')
async def update_pipeline(
    pipeline_id: UUID,
    body: PipelineUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    service = PipelineService(db)
    pipeline = await service.update_pipeline(pipeline_id, body.model_dump(exclude_none=True))
    if pipeline is None:
        raise HTTPException(status_code=404, detail='Pipeline not found.')
    await db.commit()
    return pipeline


@crud_router.delete('/api/pipeline/pipelines/{pipeline_id}')
async def delete_pipeline(pipeline_id: UUID, db: AsyncSession = Depends(get_db)):
    service = PipelineService(db)
    deleted = await service.delete_pipeline(pipeline_id)
    if not deleted:
        raise HTTPException(status_code=404, detail='Pipeline not found.')
    await db.commit()
    return {'ok': True}


# ── Pipeline runs ─────────────────────────────────────────────────────────────

@crud_router.get('/api/pipeline/pipelines/{pipeline_id}/runs')
async def list_pipeline_runs(pipeline_id: UUID, db: AsyncSession = Depends(get_db)):
    service = PipelineService(db)
    return await service.list_runs(pipeline_id)


@crud_router.get('/api/pipeline/runs/{run_id}')
async def get_pipeline_run(run_id: UUID, db: AsyncSession = Depends(get_db)):
    service = PipelineService(db)
    run = await service.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail='Pipeline run not found.')
    return run


router.include_router(crud_router)
