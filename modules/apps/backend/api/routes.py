from collections import Counter
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.destinations.backend.services.destination_profile_service import DestinationProfileService
from modules.destinations.shared.types import (
    DestinationProfileApplyResponse,
    DestinationProfileCreate,
    DestinationProfileDetail,
    DestinationProfileListItem,
    DestinationProfileUpdate,
)
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
from packages.database.src.models import DestinationProfile, SourceConnection


router = APIRouter(tags=["apps"], dependencies=[Depends(require_permission('apps', 'view'))])


class AppsOverviewResponse(BaseModel):
    connection_count: int
    connected_app_count: int
    storage_count: int
    storage_type_count: int
    connected_app_ids: List[str]
    storage_types: List[str]
    connections_by_app: Dict[str, int]
    storage_profiles_by_type: Dict[str, int]


@router.get("/api/apps/overview", response_model=AppsOverviewResponse)
async def get_apps_overview(db: AsyncSession = Depends(get_db)):
    source_result = await db.execute(select(SourceConnection))
    sources = source_result.scalars().all()

    destination_result = await db.execute(select(DestinationProfile))
    destinations = destination_result.scalars().all()

    connected_app_ids = sorted({item.app_id for item in sources if item.app_id})
    storage_types = sorted({item.destination_type for item in destinations if item.destination_type})
    connections_by_app = dict(Counter(item.app_id for item in sources if item.app_id))
    storage_profiles_by_type = dict(Counter(item.destination_type for item in destinations if item.destination_type))

    return AppsOverviewResponse(
        connection_count=len(sources),
        connected_app_count=len(connected_app_ids),
        storage_count=len(destinations),
        storage_type_count=len(storage_types),
        connected_app_ids=connected_app_ids,
        storage_types=storage_types,
        connections_by_app=connections_by_app,
        storage_profiles_by_type=storage_profiles_by_type,
    )


@router.get("/api/apps/connections", response_model=List[SourceConnectionListItem])
@router.get("/api/apps/sources", response_model=List[SourceConnectionListItem], include_in_schema=False)
async def list_app_connections(
    app_id: Optional[str] = Query(None, description="Filter by source app id"),
    db: AsyncSession = Depends(get_db),
):
    service = SourceConnectionService(db)
    try:
        return await service.list_sources(app_id=app_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/apps/connections", response_model=SourceConnectionDetail, status_code=201)
@router.post("/api/apps/sources", response_model=SourceConnectionDetail, status_code=201, include_in_schema=False)
async def create_app_connection(
    payload: SourceConnectionCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = SourceConnectionService(db)
    try:
        return await service.create_source(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/apps/connections/{connection_id}", response_model=SourceConnectionDetail)
@router.get("/api/apps/sources/{connection_id}", response_model=SourceConnectionDetail, include_in_schema=False)
async def get_app_connection(
    connection_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = SourceConnectionService(db)
    try:
        source = await service.get_source(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not source:
        raise HTTPException(status_code=404, detail="App connection not found")
    return source


@router.get("/api/apps/connections/{connection_id}/apply", response_model=SourceConnectionApplyResponse)
@router.get("/api/apps/sources/{connection_id}/apply", response_model=SourceConnectionApplyResponse, include_in_schema=False)
async def apply_app_connection(
    connection_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = SourceConnectionService(db)
    try:
        response = await service.get_source_snapshot(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not response:
        raise HTTPException(status_code=404, detail="App connection not found")
    return response


@router.put("/api/apps/connections/{connection_id}", response_model=SourceConnectionDetail)
@router.put("/api/apps/sources/{connection_id}", response_model=SourceConnectionDetail, include_in_schema=False)
async def update_app_connection(
    connection_id: str,
    payload: SourceConnectionUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = SourceConnectionService(db)
    try:
        source = await service.update_source(connection_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not source:
        raise HTTPException(status_code=404, detail="App connection not found")
    return source


@router.delete("/api/apps/connections/{connection_id}", status_code=204)
@router.delete("/api/apps/sources/{connection_id}", status_code=204, include_in_schema=False)
async def delete_app_connection(
    connection_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = SourceConnectionService(db)
    try:
        deleted = await service.delete_source(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="App connection not found")
    return None


@router.get("/api/apps/storage", response_model=List[DestinationProfileListItem])
@router.get("/api/apps/destinations", response_model=List[DestinationProfileListItem], include_in_schema=False)
async def list_storage_apps(
    destination_type: Optional[str] = Query(None, description="Filter by destination type"),
    db: AsyncSession = Depends(get_db),
):
    service = DestinationProfileService(db)
    try:
        return await service.list_destinations(destination_type=destination_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/apps/storage", response_model=DestinationProfileDetail, status_code=201)
@router.post("/api/apps/destinations", response_model=DestinationProfileDetail, status_code=201, include_in_schema=False)
async def create_storage_app(
    payload: DestinationProfileCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = DestinationProfileService(db)
    try:
        return await service.create_destination(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/apps/storage/{storage_id}", response_model=DestinationProfileDetail)
@router.get("/api/apps/destinations/{storage_id}", response_model=DestinationProfileDetail, include_in_schema=False)
async def get_storage_app(
    storage_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = DestinationProfileService(db)
    try:
        destination = await service.get_destination(storage_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not destination:
        raise HTTPException(status_code=404, detail="Storage app not found")
    return destination


@router.get("/api/apps/storage/{storage_id}/apply", response_model=DestinationProfileApplyResponse)
@router.get("/api/apps/destinations/{storage_id}/apply", response_model=DestinationProfileApplyResponse, include_in_schema=False)
async def apply_storage_app(
    storage_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = DestinationProfileService(db)
    try:
        response = await service.get_destination_snapshot(storage_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not response:
        raise HTTPException(status_code=404, detail="Storage app not found")
    return response


@router.put("/api/apps/storage/{storage_id}", response_model=DestinationProfileDetail)
@router.put("/api/apps/destinations/{storage_id}", response_model=DestinationProfileDetail, include_in_schema=False)
async def update_storage_app(
    storage_id: str,
    payload: DestinationProfileUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = DestinationProfileService(db)
    try:
        destination = await service.update_destination(storage_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not destination:
        raise HTTPException(status_code=404, detail="Storage app not found")
    return destination


@router.delete("/api/apps/storage/{storage_id}", status_code=204)
@router.delete("/api/apps/destinations/{storage_id}", status_code=204, include_in_schema=False)
async def delete_storage_app(
    storage_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = DestinationProfileService(db)
    try:
        deleted = await service.delete_destination(storage_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Storage app not found")
    return None