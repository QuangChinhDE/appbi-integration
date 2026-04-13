from pydantic import BaseModel, Field, field_validator
from typing import Optional, Dict, Any, List
from datetime import datetime
from uuid import UUID

# Source schema
class SourceInfo(BaseModel):
    app: str = Field(..., description="App identifier (request, workflow, wework, service)")
    app_name: str = Field(..., description="Human-readable app name")
    domain: str = Field(..., description="Domain for the app (e.g., company.vn)")
    access_token: str = Field(..., description="Access token (will be hashed)")

# Destination schema
class DestinationInfo(BaseModel):
    type: str = Field(..., description="Destination type (gdrive, gsheets)")
    name: str = Field(..., description="Human-readable destination name")
    auth: Dict[str, Any] = Field(..., description="Authentication information")

# Structure schema
class StructureInfo(BaseModel):
    objects: Optional[List[str]] = Field(None, description="Selected objects to backup")
    custom_fields: Optional[List[str]] = Field(None, description="Selected custom field IDs")
    export_formats: Optional[Dict[str, str]] = Field(None, description="Export formats for fields")

# Schedule schema
class ScheduleInfo(BaseModel):
    type: str = Field(..., description="Schedule type (manual, daily, weekly, monthly)")
    time: Optional[str] = Field(None, description="Time to run (HH:MM)")
    day_of_week: Optional[int] = Field(None, ge=0, le=6, description="Day of week (0=Monday)")
    day_of_month: Optional[int] = Field(None, ge=1, le=31, description="Day of month")
    enabled: bool = Field(True, description="Whether schedule is enabled")

# Create draft (empty flow - only generates ID)
class BackupFlowDraftCreate(BaseModel):
    created_by: Optional[str] = None

# Auto-save partial wizard data at each step transition
class BackupFlowAutosave(BaseModel):
    name: Optional[str] = None
    source: Optional[Dict[str, Any]] = None       # raw dict, validated/encrypted in service
    backup_type: Optional[str] = None
    destination: Optional[Dict[str, Any]] = None  # raw dict
    structure: Optional[Dict[str, Any]] = None

# Save/publish flow (fill in details on last wizard step)
class BackupFlowSave(BaseModel):
    name: Optional[str] = None  # user-provided name; auto-generated if omitted
    source: SourceInfo
    backup_type: str = Field(..., description="Backup type (structured, unstructured, all)")
    destination: DestinationInfo
    structure: Optional[StructureInfo] = None
    schedule: Optional[ScheduleInfo] = None
    updated_by: Optional[str] = None

    @field_validator('backup_type')
    def validate_backup_type(cls, v):
        if v not in ['structured', 'unstructured', 'all']:
            raise ValueError('backup_type must be one of: structured, unstructured, all')
        return v

# Create backup flow request
class BackupFlowCreate(BaseModel):
    source: SourceInfo
    backup_type: str = Field(..., description="Backup type (structured, unstructured, all)")
    destination: DestinationInfo
    structure: Optional[StructureInfo] = None
    schedule: Optional[ScheduleInfo] = None
    created_by: str = Field(..., description="User who created this flow")

    @field_validator('backup_type')
    def validate_backup_type(cls, v):
        if v not in ['structured', 'unstructured', 'all']:
            raise ValueError('backup_type must be one of: structured, unstructured, all')
        return v

# Update backup flow request
class BackupFlowUpdate(BaseModel):
    source: Optional[SourceInfo] = None
    backup_type: Optional[str] = None
    destination: Optional[DestinationInfo] = None
    structure: Optional[StructureInfo] = None
    schedule: Optional[ScheduleInfo] = None
    status: Optional[str] = None
    updated_by: str = Field(..., description="User who updated this flow")

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

# Backup flow response (full details)
class BackupFlowResponse(BaseModel):
    id: UUID
    name: Optional[str] = None
    is_draft: int
    is_published: int
    source: Optional[Dict[str, Any]] = None
    backup_type: Optional[str] = None
    destination: Optional[Dict[str, Any]] = None
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

# Backup flow response for lists (lighter)
class BackupFlowListResponse(BaseModel):
    id: UUID
    name: Optional[str] = None
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
    created_at: datetime

    class Config:
        from_attributes = True

# Backup flow run response
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

# Source app response
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

# Google connection response (tokens omitted)
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

# Google Drive item
class GoogleDriveItem(BaseModel):
    id: str
    name: str
    kind: str   # 'my_drive' | 'shared_drive'

# Google Folder item
class GoogleFolderItem(BaseModel):
    id: str
    name: str
