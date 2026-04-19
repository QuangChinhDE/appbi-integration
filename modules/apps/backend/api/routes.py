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
from modules.connectors.backend.shared.runtime import ConnectorRuntimeService
from packages.auth.src import (
    apply_resource_scope,
    get_current_user,
    require_edit_access,
    require_full_access,
    require_permission,
    require_view_access,
)
from packages.database.src import get_db
from packages.database.src.models import AppCredential, ResourceType, User


router = APIRouter(tags=["apps"], dependencies=[Depends(require_permission('apps', 'view'))])


class AppsOverviewResponse(BaseModel):
    credential_count: int
    app_count: int
    credentials_by_app: Dict[str, int]


@router.get("/api/apps/overview", response_model=AppsOverviewResponse)
async def get_apps_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = apply_resource_scope(
        select(AppCredential),
        AppCredential,
        ResourceType.APP_CREDENTIAL,
        current_user,
        module='apps',
    )
    result = await db.execute(stmt)
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
    current_user: User = Depends(get_current_user),
):
    service = AppCredentialService(db)
    try:
        return await service.list_credentials(current_user, app_id=app_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/apps/credentials", response_model=AppCredentialDetail, status_code=201)
async def create_app_credential(
    payload: AppCredentialCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('apps', 'edit')),
):
    service = AppCredentialService(db)
    try:
        return await service.create_credential(payload, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/apps/credentials/{credential_id}", response_model=AppCredentialDetail)
async def get_app_credential(
    credential_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = AppCredentialService(db)
    try:
        model = await service.get_credential_model(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not model:
        raise HTTPException(status_code=404, detail="App credential not found")
    await require_view_access(db, current_user, model, resource_type=ResourceType.APP_CREDENTIAL)
    return await service.get_credential(credential_id, current_user)


@router.get("/api/apps/credentials/{credential_id}/apply", response_model=AppCredentialApplyResponse)
async def apply_app_credential(
    credential_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = AppCredentialService(db)
    try:
        model = await service.get_credential_model(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not model:
        raise HTTPException(status_code=404, detail="App credential not found")
    await require_view_access(db, current_user, model, resource_type=ResourceType.APP_CREDENTIAL)
    return await service.get_credential_snapshot(credential_id, current_user)


@router.post("/api/apps/credentials/{credential_id}/test-connection")
async def test_app_credential_connection(
    credential_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = AppCredentialService(db)
    try:
        model = await service.get_credential_model(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not model:
        raise HTTPException(status_code=404, detail="App credential not found")
    await require_view_access(db, current_user, model, resource_type=ResourceType.APP_CREDENTIAL)

    runtime = ConnectorRuntimeService(db)
    try:
        connector = await runtime.build_connector_from_credential_id(model.id)
    except Exception as exc:
        return {"ok": False, "error": f"Failed to build connector: {exc}"}

    try:
        result = await connector.test_connection()
    except Exception as exc:
        result = {"ok": False, "error": str(exc)}
    finally:
        if hasattr(connector, 'close'):
            try:
                await connector.close()
            except Exception:
                pass

    return result


@router.put("/api/apps/credentials/{credential_id}", response_model=AppCredentialDetail)
async def update_app_credential(
    credential_id: str,
    payload: AppCredentialUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('apps', 'edit')),
):
    service = AppCredentialService(db)
    try:
        model = await service.get_credential_model(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not model:
        raise HTTPException(status_code=404, detail="App credential not found")
    await require_edit_access(db, current_user, model, resource_type=ResourceType.APP_CREDENTIAL)
    credential = await service.update_credential(credential_id, payload, current_user)
    if not credential:
        raise HTTPException(status_code=404, detail="App credential not found")
    return credential


@router.delete("/api/apps/credentials/{credential_id}", status_code=204)
async def delete_app_credential(
    credential_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('apps', 'edit')),
):
    service = AppCredentialService(db)
    try:
        model = await service.get_credential_model(credential_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not model:
        raise HTTPException(status_code=404, detail="App credential not found")
    await require_full_access(db, current_user, model, resource_type=ResourceType.APP_CREDENTIAL)
    deleted = await service.delete_credential(credential_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="App credential not found")
    return None
