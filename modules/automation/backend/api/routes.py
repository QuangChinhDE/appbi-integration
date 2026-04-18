from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from modules.automation.backend.services.automation_module_service import AutomationModuleService
from packages.auth.src import require_permission
from packages.database.src import get_db


router = APIRouter(tags=['automation'], dependencies=[Depends(require_permission('automation', 'view'))])


class AutomationOperationItem(BaseModel):
    key: str
    summary: str
    input_schema: str | None = None
    required_fields: list[str] = Field(default_factory=list)
    optional_fields: list[str] = Field(default_factory=list)
    api_calls: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class AutomationResourceItem(BaseModel):
    key: str
    actions: list[str] = Field(default_factory=list)


class AutomationConnectorItem(BaseModel):
    key: str
    app_id: str
    app_name: str
    summary: str
    binding_source: str
    status: str
    credential_count: int = 0
    operation_count: int = 0
    trigger_count: int = 0
    selection_label: str
    resources: list[AutomationResourceItem] = Field(default_factory=list)
    triggers: list[str] = Field(default_factory=list)
    operations: list[AutomationOperationItem] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class AutomationOverviewResponse(BaseModel):
    module: dict[str, Any]
    connector_count: int
    saved_binding_count: int
    operation_count: int
    trigger_count: int
    connectors: list[AutomationConnectorItem]


@router.get('/api/automation/overview', response_model=AutomationOverviewResponse)
async def get_automation_overview(db: AsyncSession = Depends(get_db)):
    service = AutomationModuleService(db)
    return await service.get_overview()


@router.get('/api/automation/connectors/{connector_key}', response_model=AutomationConnectorItem)
async def get_automation_connector(connector_key: str, db: AsyncSession = Depends(get_db)):
    service = AutomationModuleService(db)
    connector = await service.get_connector(connector_key)
    if connector is None:
        raise HTTPException(status_code=404, detail='Automation connector not found.')
    return connector
