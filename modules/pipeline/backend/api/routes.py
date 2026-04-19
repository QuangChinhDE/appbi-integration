from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from modules.pipeline.backend.services.pipeline_module_service import PipelineModuleService
from modules.pipeline.backend.services.pipeline_service import PipelineService
from packages.auth.src import (
    require_edit_access,
    require_full_access,
    require_permission,
    require_view_access,
)
from packages.auth.src.dependencies import get_current_user
from packages.database.src import get_db
from packages.database.src.models import DataPipeline, PipelineRun, ResourceType, User


router = APIRouter(tags=['pipeline'])


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
async def get_pipeline_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    module_service = PipelineModuleService(db)
    overview = await module_service.get_overview()
    overview['pipelines'] = await PipelineService(db).list_pipelines(current_user)
    overview['pipeline_count'] = len(overview['pipelines'])
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


crud_router = APIRouter()


class PipelineBinding(BaseModel):
    source_stream_key: str
    source_config: dict[str, Any] = Field(default_factory=dict)
    dest_stream_key: str
    dest_config: dict[str, Any] = Field(default_factory=dict)
    write_mode: str = 'append'
    field_mapping: dict[str, Any] = Field(default_factory=dict)


class DiscoverFieldsRequest(BaseModel):
    source_credential_id: str
    source_connector_key: str
    source_stream_key: str
    source_config: dict[str, Any] = Field(default_factory=dict)
    sample_size: int = 10


class PipelineCreateRequest(BaseModel):
    name: str
    description: str | None = None
    source_connector_key: str
    source_credential_id: str | None = None
    dest_connector_key: str
    dest_credential_id: str | None = None
    bindings: list[PipelineBinding] = Field(default_factory=list)
    schedule: dict[str, Any] | None = None
    status: str = 'draft'


class PipelineUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    source_connector_key: str | None = None
    source_credential_id: str | None = None
    dest_connector_key: str | None = None
    dest_credential_id: str | None = None
    bindings: list[PipelineBinding] | None = None
    schedule: dict[str, Any] | None = None


async def _get_pipeline_or_404(db: AsyncSession, pipeline_id: UUID) -> DataPipeline:
    pipeline = await db.get(DataPipeline, pipeline_id)
    if pipeline is None:
        raise HTTPException(status_code=404, detail='Pipeline not found.')
    return pipeline


async def _get_run_or_404(db: AsyncSession, run_id: UUID) -> PipelineRun:
    run = await db.get(PipelineRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail='Pipeline run not found.')
    return run


@crud_router.post('/api/pipeline/discover-fields', dependencies=[Depends(require_permission('pipeline', 'edit'))])
async def discover_source_fields(
    body: DiscoverFieldsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = PipelineService(db)
    try:
        return await service.discover_source_fields(
            source_credential_id=body.source_credential_id,
            source_connector_key=body.source_connector_key,
            source_stream_key=body.source_stream_key,
            source_config=body.source_config,
            sample_size=body.sample_size,
            current_user=current_user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Discovery failed: {exc}") from exc


@crud_router.post('/api/pipeline/pipelines', dependencies=[Depends(require_permission('pipeline', 'edit'))])
async def create_pipeline(
    body: PipelineCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = PipelineService(db)
    try:
        pipeline = await service.create_pipeline(body.model_dump(exclude_none=True), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return pipeline


@crud_router.get('/api/pipeline/pipelines', dependencies=[Depends(require_permission('pipeline', 'view'))])
async def list_pipelines(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = PipelineService(db)
    return await service.list_pipelines(current_user, status=status)


@crud_router.get('/api/pipeline/pipelines/{pipeline_id}', dependencies=[Depends(require_permission('pipeline', 'view'))])
async def get_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pipeline = await _get_pipeline_or_404(db, pipeline_id)
    await require_view_access(db, current_user, pipeline, resource_type=ResourceType.DATA_PIPELINE)
    return await PipelineService(db).get_pipeline(pipeline, current_user)


@crud_router.put('/api/pipeline/pipelines/{pipeline_id}', dependencies=[Depends(require_permission('pipeline', 'edit'))])
async def update_pipeline(
    pipeline_id: UUID,
    body: PipelineUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pipeline = await _get_pipeline_or_404(db, pipeline_id)
    await require_edit_access(db, current_user, pipeline, resource_type=ResourceType.DATA_PIPELINE)
    service = PipelineService(db)
    try:
        updated = await service.update_pipeline(pipeline, body.model_dump(exclude_none=True), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return updated


@crud_router.delete('/api/pipeline/pipelines/{pipeline_id}', dependencies=[Depends(require_permission('pipeline', 'edit'))])
async def delete_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pipeline = await _get_pipeline_or_404(db, pipeline_id)
    await require_full_access(db, current_user, pipeline, resource_type=ResourceType.DATA_PIPELINE)
    await PipelineService(db).delete_pipeline(pipeline)
    await db.commit()
    return {'ok': True}


@crud_router.get('/api/pipeline/pipelines/{pipeline_id}/runs', dependencies=[Depends(require_permission('pipeline', 'view'))])
async def list_pipeline_runs(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pipeline = await _get_pipeline_or_404(db, pipeline_id)
    await require_view_access(db, current_user, pipeline, resource_type=ResourceType.DATA_PIPELINE)
    return await PipelineService(db).list_runs(pipeline, current_user)


@crud_router.get('/api/pipeline/runs/{run_id}', dependencies=[Depends(require_permission('pipeline', 'view'))])
async def get_pipeline_run(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run = await _get_run_or_404(db, run_id)
    pipeline = await _get_pipeline_or_404(db, run.pipeline_id)
    await require_view_access(db, current_user, pipeline, resource_type=ResourceType.DATA_PIPELINE)
    return await PipelineService(db).get_run(run, current_user)


@crud_router.post('/api/pipeline/pipelines/{pipeline_id}/run', dependencies=[Depends(require_permission('pipeline', 'edit'))])
async def run_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pipeline = await _get_pipeline_or_404(db, pipeline_id)
    await require_edit_access(db, current_user, pipeline, resource_type=ResourceType.DATA_PIPELINE)
    service = PipelineService(db)
    try:
        response = await service.trigger_run(pipeline, current_user.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return response


@crud_router.post('/api/pipeline/pipelines/{pipeline_id}/stop', dependencies=[Depends(require_permission('pipeline', 'edit'))])
async def stop_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pipeline = await _get_pipeline_or_404(db, pipeline_id)
    await require_edit_access(db, current_user, pipeline, resource_type=ResourceType.DATA_PIPELINE)
    return await PipelineService(db).stop_pipeline(pipeline)


router.include_router(crud_router)
