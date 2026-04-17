from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from modules.sources.backend.services.source_connection_service import SourceConnectionService
from modules.sources.shared.types import (
    SourceConnectionApplyResponse,
    SourceConnectionCreate,
    SourceConnectionDetail,
    SourceConnectionListItem,
    SourceConnectionUpdate,
)
from packages.auth.src import require_permission
from packages.database.src import get_db


router = APIRouter(tags=["apps"], dependencies=[Depends(require_permission('apps', 'view'))])


@router.get("/api/sources", response_model=List[SourceConnectionListItem])
async def list_sources(
    app_id: Optional[str] = Query(None, description="Filter by source app id"),
    db: AsyncSession = Depends(get_db),
):
    service = SourceConnectionService(db)
    try:
        return await service.list_sources(app_id=app_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/sources", response_model=SourceConnectionDetail, status_code=201)
async def create_source(
    payload: SourceConnectionCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = SourceConnectionService(db)
    try:
        return await service.create_source(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/sources/{source_id}", response_model=SourceConnectionDetail)
async def get_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = SourceConnectionService(db)
    try:
        source = await service.get_source(source_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not source:
        raise HTTPException(status_code=404, detail="Source connection not found")
    return source


@router.get("/api/sources/{source_id}/apply", response_model=SourceConnectionApplyResponse)
async def apply_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = SourceConnectionService(db)
    try:
        response = await service.get_source_snapshot(source_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not response:
        raise HTTPException(status_code=404, detail="Source connection not found")
    return response


@router.put("/api/sources/{source_id}", response_model=SourceConnectionDetail)
async def update_source(
    source_id: str,
    payload: SourceConnectionUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = SourceConnectionService(db)
    try:
        source = await service.update_source(source_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not source:
        raise HTTPException(status_code=404, detail="Source connection not found")
    return source


@router.delete("/api/sources/{source_id}", status_code=204)
async def delete_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = SourceConnectionService(db)
    try:
        deleted = await service.delete_source(source_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Source connection not found")
    return None