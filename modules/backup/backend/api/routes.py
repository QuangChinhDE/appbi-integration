from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from modules.backup.backend.services.backup_flow_service import BackupFlowService
from modules.backup.shared.types import (
    BackupDashboardResponse,
    BackupFlowAutosave,
    BackupFlowCreate,
    BackupFlowDraftCreate,
    BackupFlowListResponse,
    BackupFlowResponse,
    BackupFlowSave,
    BackupFlowUpdate,
)
from packages.auth.src import (
    get_current_user,
    require_edit_access,
    require_full_access,
    require_permission,
    require_view_access,
)
from packages.database.src import get_db
from packages.database.src.models import ResourceType, User


router = APIRouter(tags=["backup"], dependencies=[Depends(require_permission('backup', 'view'))])


@router.post("/api/backup-flows/draft", response_model=BackupFlowResponse, status_code=201)
async def create_backup_flow_draft(
    draft: BackupFlowDraftCreate = BackupFlowDraftCreate(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """
    Create an empty draft backup flow.
    Returns immediately with a new UUID, is_draft=1, is_published=0, all other fields null.
    """
    service = BackupFlowService(db)
    try:
        new_draft = await service.create_draft(draft, current_user)
        return new_draft
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create draft: {str(exc)}")


@router.post("/api/backup-flows/{flow_id}/save", response_model=BackupFlowResponse)
async def save_backup_flow(
    flow_id: str,
    save_data: BackupFlowSave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """
    Save (publish) a draft backup flow with all required details.
    Sets is_draft=0, is_published=1 and fills in all fields.
    """
    service = BackupFlowService(db)
    try:
        flow = await service.get_flow_model(flow_id)
        if not flow:
            raise HTTPException(status_code=404, detail="Backup flow not found")
        await require_edit_access(db, current_user, flow, resource_type=ResourceType.BACKUP_FLOW)
        saved_flow = await service.save_flow(flow_id, save_data, current_user)
        if not saved_flow:
            raise HTTPException(status_code=404, detail="Backup flow not found")
        return saved_flow
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save backup flow: {str(exc)}")


@router.post("/api/backup-flows", response_model=BackupFlowResponse, status_code=201)
async def create_backup_flow(
    flow: BackupFlowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """
    Create a new backup flow

    - **source**: App information with domain and access token (will be hashed)
    - **backup_type**: Type of backup (structured, unstructured, all)
    - **destination**: Storage destination information
    - **structure**: Backup structure configuration (optional)
    - **schedule**: Schedule configuration (optional)
    """
    service = BackupFlowService(db)
    try:
        new_flow = await service.create_flow(flow, current_user)
        return new_flow
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create backup flow: {str(exc)}")


@router.get("/api/backup-flows", response_model=List[BackupFlowListResponse])
async def list_backup_flows(
    status: Optional[str] = None,
    app: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all backup flows with optional filtering

    - **status**: Filter by status (active, paused, archived)
    - **app**: Filter by app type (request, workflow, wework, service)
    - **skip**: Number of records to skip (pagination)
    - **limit**: Maximum number of records to return
    """
    service = BackupFlowService(db)
    return await service.list_flows(current_user, status=status, app=app, skip=skip, limit=limit)


@router.get("/api/backup-flows/dashboard", response_model=BackupDashboardResponse)
async def get_backup_dashboard(
    recent_limit: int = 8,
    active_limit: int = 5,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return dashboard stats plus active and recent backup runs."""
    service = BackupFlowService(db)
    return await service.get_dashboard_data(current_user, recent_limit=recent_limit, active_limit=active_limit)


@router.get("/api/backup-flows/{flow_id}", response_model=BackupFlowResponse)
async def get_backup_flow(
    flow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific backup flow by ID"""
    service = BackupFlowService(db)
    flow_model = await service.get_flow_model(flow_id)
    if not flow_model:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    await require_view_access(db, current_user, flow_model, resource_type=ResourceType.BACKUP_FLOW)
    return await service.get_flow(flow_id, current_user)


@router.patch("/api/backup-flows/{flow_id}", response_model=BackupFlowResponse)
async def update_backup_flow(
    flow_id: str,
    flow_update: BackupFlowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """Update a backup flow"""
    service = BackupFlowService(db)
    try:
        flow = await service.get_flow_model(flow_id)
        if not flow:
            raise HTTPException(status_code=404, detail="Backup flow not found")
        await require_edit_access(db, current_user, flow, resource_type=ResourceType.BACKUP_FLOW)
        updated_flow = await service.update_flow(flow_id, flow_update, current_user)
        if not updated_flow:
            raise HTTPException(status_code=404, detail="Backup flow not found")
        return updated_flow
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/api/backup-flows/{flow_id}/autosave", status_code=200)
async def autosave_backup_flow(
    flow_id: str,
    data: BackupFlowAutosave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """Auto-save partial wizard step data to the backup flow."""
    service = BackupFlowService(db)
    flow = await service.get_flow_model(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    await require_edit_access(db, current_user, flow, resource_type=ResourceType.BACKUP_FLOW)
    ok = await service.autosave_flow(flow_id, data)
    if not ok:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    return {"saved": True}


@router.delete("/api/backup-flows/{flow_id}", status_code=204)
async def delete_backup_flow(
    flow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """Delete a backup flow"""
    service = BackupFlowService(db)
    flow = await service.get_flow_model(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    await require_full_access(db, current_user, flow, resource_type=ResourceType.BACKUP_FLOW)
    success = await service.delete_flow(flow_id)
    if not success:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    return None


@router.post("/api/backup-flows/{flow_id}/publish", response_model=BackupFlowResponse)
async def publish_backup_flow(
    flow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """Publish a flow: set is_draft=0, is_published=1"""
    service = BackupFlowService(db)
    flow_model = await service.get_flow_model(flow_id)
    if not flow_model:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    await require_edit_access(db, current_user, flow_model, resource_type=ResourceType.BACKUP_FLOW)
    flow = await service.publish_flow(flow_id, current_user)
    if not flow:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    return flow


@router.post("/api/backup-flows/{flow_id}/run", status_code=202)
async def run_backup_flow(
    flow_id: str,
    triggered_by: str = "manual",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """
    Trigger a backup flow execution

    Returns immediately with run_id. Actual backup runs asynchronously.
    """
    service = BackupFlowService(db)
    try:
        flow = await service.get_flow_model(flow_id)
        if not flow:
            raise HTTPException(status_code=404, detail="Backup flow not found")
        await require_edit_access(db, current_user, flow, resource_type=ResourceType.BACKUP_FLOW)
        run = await service.trigger_flow_run(flow_id, triggered_by or current_user.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not run:
        raise HTTPException(status_code=404, detail="Backup flow not found")

    return {
        "run_id": str(run.id),
        "flow_id": str(run.flow_id),
        "status": run.status,
        "message": "Backup flow triggered successfully",
    }


@router.post("/api/backup-flows/runs/interrupt-all", status_code=200)
async def interrupt_all_backup_flow_runs(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission('backup', 'edit')),
):
    """Force stop all running backup tasks and mark their runs as interrupted."""
    service = BackupFlowService(db)
    result = await service.interrupt_all_running_tasks()
    return {
        "message": "Interrupt request sent to all running backup flows",
        **result,
    }


@router.post("/api/backup-flows/{flow_id}/stop", status_code=200)
async def stop_backup_flow_run(
    flow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('backup', 'edit')),
):
    """Stop the active backup run(s) for a single flow."""
    service = BackupFlowService(db)
    flow = await service.get_flow_model(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    await require_edit_access(db, current_user, flow, resource_type=ResourceType.BACKUP_FLOW)
    result = await service.interrupt_flow_running_tasks(flow_id)
    return {
        "flow_id": flow_id,
        "message": "Interrupt request sent to the running backup flow",
        **result,
    }


@router.get("/api/backup-flows/{flow_id}/runs")
async def get_flow_runs(
    flow_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get execution history for a backup flow"""
    service = BackupFlowService(db)
    flow = await service.get_flow_model(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    await require_view_access(db, current_user, flow, resource_type=ResourceType.BACKUP_FLOW)
    return await service.get_flow_runs(flow_id, limit=limit)
