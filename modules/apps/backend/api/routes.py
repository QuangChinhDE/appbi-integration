"""Apps module HTTP surface.

Apps is a role-neutral credential registry. It exposes CRUD over
AppCredential rows and a lightweight overview for dashboards. It does NOT
expose any source/destination concept — that lives in the Backup module,
which picks a saved credential and assigns it a role at flow-config time.
"""

from collections import Counter
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.apps.backend.services.app_credential_service import AppCredentialService
from modules.apps.shared.types import (
    AppCredentialApplyResponse,
    AppCredentialCreate,
    AppCredentialDetail,
    AppCredentialListItem,
    AppCredentialUpdate,
)
from packages.auth.src import require_permission
from packages.database.src import get_db
from packages.database.src.models import AppCredential


router = APIRouter(tags=["apps"], dependencies=[Depends(require_permission('apps', 'view'))])


class AppsOverviewResponse(BaseModel):
    credential_count: int
    app_count: int
    credentials_by_app: Dict[str, int]


@router.get("/api/apps/overview", response_model=AppsOverviewResponse)
async def get_apps_overview(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AppCredential))
    credentials = result.scalars().all()

    counts_by_app = dict(Counter(item.app_id for item in credentials if item.app_id))
    return AppsOverviewResponse(
        credential_count=len(credentials),
        app_count=len(counts_by_app),
        credentials_by_app=counts_by_app,
    )


@router.get("/api/apps/credentials", response_model=List[AppCredentialListItem])
async def list_app_credentials(
    app_id: Optional[str] = Query(None, description="Filter by app id"),
    db: AsyncSession = Depends(get_db),
):
    service = AppCredentialService(db)
    try:
        return await service.list_credentials(app_id=app_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/apps/credentials", response_model=AppCredentialDetail, status_code=201)
async def create_app_credential(
    payload: AppCredentialCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = AppCredentialService(db)
    try:
        return await service.create_credential(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/apps/credentials/{credential_id}", response_model=AppCredentialDetail)
async def get_app_credential(
    credential_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = AppCredentialService(db)
    try:
        credential = await service.get_credential(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not credential:
        raise HTTPException(status_code=404, detail="App credential not found")
    return credential


@router.get("/api/apps/credentials/{credential_id}/apply", response_model=AppCredentialApplyResponse)
async def apply_app_credential(
    credential_id: str,
    db: AsyncSession = Depends(get_db),
):
    service = AppCredentialService(db)
    try:
        snapshot = await service.get_credential_snapshot(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not snapshot:
        raise HTTPException(status_code=404, detail="App credential not found")
    return snapshot


@router.put("/api/apps/credentials/{credential_id}", response_model=AppCredentialDetail)
async def update_app_credential(
    credential_id: str,
    payload: AppCredentialUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = AppCredentialService(db)
    try:
        credential = await service.update_credential(credential_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not credential:
        raise HTTPException(status_code=404, detail="App credential not found")
    return credential


@router.delete("/api/apps/credentials/{credential_id}", status_code=204)
async def delete_app_credential(
    credential_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('apps', 'edit')),
):
    service = AppCredentialService(db)
    try:
        deleted = await service.delete_credential(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="App credential not found")
    return None
