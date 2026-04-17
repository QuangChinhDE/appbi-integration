from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from modules.destinations.backend.services.destination_profile_service import DestinationProfileService
from modules.destinations.shared.types import (
    DestinationProfileApplyResponse,
    DestinationProfileCreate,
    DestinationProfileDetail,
    DestinationProfileListItem,
    DestinationProfileUpdate,
)
from packages.auth.src import require_permission
from packages.database.src import get_db


router = APIRouter(tags=["apps"], dependencies=[Depends(require_permission('apps', 'view'))])


@router.get("/api/destinations", response_model=List[DestinationProfileListItem])
async def list_destinations(
    destination_type: Optional[str] = Query(None, description="Filter by destination type"),
    db: AsyncSession = Depends(get_db),
):
    service = DestinationProfileService(db)
    try:
        return await service.list_destinations(destination_type=destination_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/destinations", response_model=DestinationProfileDetail, status_code=201)
async def create_destination(
    payload: DestinationProfileCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = DestinationProfileService(db)
    try:
        return await service.create_destination(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/destinations/{destination_id}", response_model=DestinationProfileDetail)
async def get_destination(
    destination_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = DestinationProfileService(db)
    try:
        destination = await service.get_destination(destination_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not destination:
        raise HTTPException(status_code=404, detail="Destination profile not found")
    return destination


@router.get("/api/destinations/{destination_id}/apply", response_model=DestinationProfileApplyResponse)
async def apply_destination(
    destination_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = DestinationProfileService(db)
    try:
        response = await service.get_destination_snapshot(destination_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not response:
        raise HTTPException(status_code=404, detail="Destination profile not found")
    return response


@router.put("/api/destinations/{destination_id}", response_model=DestinationProfileDetail)
async def update_destination(
    destination_id: str,
    payload: DestinationProfileUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = DestinationProfileService(db)
    try:
        destination = await service.update_destination(destination_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not destination:
        raise HTTPException(status_code=404, detail="Destination profile not found")
    return destination


@router.delete("/api/destinations/{destination_id}", status_code=204)
async def delete_destination(
    destination_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = DestinationProfileService(db)
    try:
        deleted = await service.delete_destination(destination_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Destination profile not found")
    return None