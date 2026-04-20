from pydantic import BaseModel, Field, field_validator
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID

# ─── Credential role references ─────────────────────────────────────────────
# The Backup module decides which saved AppCredential plays the source role
# and which plays the destination role at flow-configuration time. Both are
# just ids pointing into the Apps module's registry.


class SourceRoleRef(BaseModel):
    credential_id: UUID = Field(..., description="AppCredential ID used as this flow's source")


class DestinationRoleRef(BaseModel):
    credential_id: UUID = Field(..., description="AppCredential ID used as this flow's destination")
    target: Optional[Dict[str, Any]] = Field(
        None,
        description="Per-flow target selection (e.g. folder_id, drive_id). Overrides credential defaults.",
    )


# ─── Structure / schedule ───────────────────────────────────────────────────
class StructureInfo(BaseModel):
    objects: Optional[List[str]] = None
    custom_fields: Optional[List[str]] = None
    export_formats: Optional[Dict[str, str]] = None
    group_ids: Optional[List[str]] = None
    project_ids: Optional[List[str]] = None
    service_ids: Optional[List[str]] = None
    workflow_ids: Optional[List[str]] = None
    ticket_limit_per_service: Optional[int] = Field(None, ge=1)
    include_catalog: Optional[bool] = None
    include_stages: Optional[bool] = None
    include_ticket_details: Optional[bool] = None
    include_activity_logs: Optional[bool] = None
    activity_log_filters: Optional[Dict[str, Any]] = None

    @field_validator('group_ids', 'project_ids', 'service_ids', 'workflow_ids', mode='before')
    def normalize_identifier_list(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            identifiers = [item.strip() for item in value.split(',') if item.strip()]
        else:
            identifiers = [str(item).strip() for item in value if str(item).strip()]

        seen = set()
        output = []
        for identifier in identifiers:
            if identifier in seen:
                continue
            seen.add(identifier)
            output.append(identifier)
        return output


class ScheduleInfo(BaseModel):
    type: str
    time: Optional[str] = None
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    enabled: bool = True


# ─── Flow CRUD payloads ─────────────────────────────────────────────────────
class BackupFlowDraftCreate(BaseModel):
    created_by: Optional[str] = None
    name: Optional[str] = None
    source: Optional[SourceRoleRef] = None


class BackupFlowAutosave(BaseModel):
    name: Optional[str] = None
    source: Optional[SourceRoleRef] = None
    backup_type: Optional[str] = None
    destination: Optional[DestinationRoleRef] = None
    structure: Optional[Dict[str, Any]] = None


class BackupFlowSave(BaseModel):
    name: Optional[str] = None
    source: SourceRoleRef
    backup_type: str
    destination: DestinationRoleRef
    structure: Optional[StructureInfo] = None
    schedule: Optional[ScheduleInfo] = None
    updated_by: Optional[str] = None

    @field_validator('backup_type')
    def validate_backup_type(cls, v):
        if v not in ['structured', 'unstructured', 'all']:
            raise ValueError('backup_type must be one of: structured, unstructured, all')
        return v


class BackupFlowCreate(BaseModel):
    source: SourceRoleRef
    backup_type: str
    destination: DestinationRoleRef
    structure: Optional[StructureInfo] = None
    schedule: Optional[ScheduleInfo] = None
    created_by: str

    @field_validator('backup_type')
    def validate_backup_type(cls, v):
        if v not in ['structured', 'unstructured', 'all']:
            raise ValueError('backup_type must be one of: structured, unstructured, all')
        return v


class BackupFlowUpdate(BaseModel):
    source: Optional[SourceRoleRef] = None
    backup_type: Optional[str] = None
    destination: Optional[DestinationRoleRef] = None
    structure: Optional[StructureInfo] = None
    schedule: Optional[ScheduleInfo] = None
    status: Optional[str] = None
    updated_by: str

    @field_validator('backup_type')
    def validate_backup_type(cls, v):
        if v is not None and v not in ['structured', 'unstructured', 'all']:
            raise ValueError('backup_type must be one of: structured, unstructured, all')
        return v

    @field_validator('status')
    def validate_status(cls, v):
        if v is not None and v not in ['active', 'paused', 'archived']:
            raise ValueError('status must be one of: active, paused, archived')
        return v


# ─── Flow responses ─────────────────────────────────────────────────────────
class CredentialSummary(BaseModel):
    """Hydrated view of the AppCredential a flow references, safe for API output."""
    id: UUID
    owner_email: Optional[str] = None
    user_permission: Optional[str] = None
    app_id: str
    app_name: str
    auth_mode: str
    name: str
    preview: Dict[str, Any] = Field(default_factory=dict)


class BackupFlowResponse(BaseModel):
    id: UUID
    name: Optional[str] = None
    owner_email: Optional[str] = None
    user_permission: Optional[str] = None
    is_draft: int
    is_published: int
    source_credential_id: Optional[UUID] = None
    destination_credential_id: Optional[UUID] = None
    source: Optional[CredentialSummary] = None
    destination: Optional[CredentialSummary] = None
    destination_target: Optional[Dict[str, Any]] = None
    backup_type: Optional[str] = None
    structure: Optional[Dict[str, Any]] = None
    schedule: Optional[Dict[str, Any]] = None
    status: str
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_run_message: Optional[str] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BackupFlowListResponse(BaseModel):
    id: UUID
    name: Optional[str] = None
    owner_email: Optional[str] = None
    user_permission: Optional[str] = None
    is_draft: int
    is_published: int
    app: Optional[str] = None
    app_name: Optional[str] = None
    backup_type: Optional[str] = None
    destination_type: Optional[str] = None
    destination_name: Optional[str] = None
    status: str
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    run_blocked_reason: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BackupFlowRunResponse(BaseModel):
    id: UUID
    flow_id: UUID
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    execution_details: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    triggered_by: str

    class Config:
        from_attributes = True


class BackupDashboardRunResponse(BaseModel):
    run_id: UUID
    flow_id: UUID
    flow_name: Optional[str] = None
    app: Optional[str] = None
    app_name: Optional[str] = None
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    execution_details: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    triggered_by: str
    latest_log_line: Optional[str] = None


class BackupDashboardResponse(BaseModel):
    configured_apps: int
    completed_flows: int
    pending_flows: int
    running_flows: int
    active_runs: List[BackupDashboardRunResponse]
    recent_runs: List[BackupDashboardRunResponse]


class BackupSourceAppResponse(BaseModel):
    id: UUID
    app_id: str
    app_name: str
    base_url_template: str
    api_steps: List[Dict[str, Any]]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GoogleConnectionResponse(BaseModel):
    id: UUID
    email: str
    display_name: Optional[str] = None
    picture_url: Optional[str] = None
    scopes: Optional[str] = None
    token_expiry: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GoogleDriveItem(BaseModel):
    id: str
    name: str
    kind: str


class GoogleFolderItem(BaseModel):
    id: str
    name: str
