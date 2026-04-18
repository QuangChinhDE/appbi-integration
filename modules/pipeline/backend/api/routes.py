from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from modules.pipeline.backend.services.pipeline_module_service import PipelineModuleService
from packages.auth.src import require_permission
from packages.database.src import get_db


router = APIRouter(tags=['pipeline'], dependencies=[Depends(require_permission('pipeline', 'view'))])


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


@router.get('/api/pipeline/overview', response_model=PipelineOverviewResponse)
async def get_pipeline_overview(db: AsyncSession = Depends(get_db)):
    service = PipelineModuleService(db)
    return await service.get_overview()


@router.get('/api/pipeline/capabilities/{kind}/{capability_key}', response_model=PipelineCatalogItem)
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
