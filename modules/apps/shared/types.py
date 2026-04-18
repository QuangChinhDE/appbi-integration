from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# Catalog of every app the Apps module can store a credential for.
# Apps are role-neutral here. Role (source vs destination) is assigned by
# the Backup module at flow-configuration time.
SUPPORTED_APPS: Dict[str, str] = {
    "request": "Request",
    "workflow": "Workflow",
    "wework": "WeWork",
    "service": "Service",
    "crm": "CRM",
    "hrm": "HRM",
    "table": "Table",
    "goal": "Goal",
    "income": "Income",
    "meeting": "Meeting",
    "payroll": "Payroll",
    "timeoff": "Timeoff",
    "gdrive": "Google Drive",
    "gsheets": "Google Sheets",
}

SOURCE_STYLE_APPS = {
    "request", "workflow", "wework", "service",
    "crm", "hrm", "table", "goal", "income", "meeting", "payroll", "timeoff",
}
GOOGLE_STYLE_APPS = {"gdrive", "gsheets"}

SUPPORTED_AUTH_MODES = {"access_token", "google_oauth", "service_account"}


class AppCredentialCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    app_id: str = Field(..., description="One of: " + ", ".join(sorted(SUPPORTED_APPS)))
    app_name: Optional[str] = Field(None, max_length=100)
    auth: Dict[str, Any] = Field(default_factory=dict)
    config: Optional[Dict[str, Any]] = None

    @field_validator("app_id")
    def validate_app_id(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in SUPPORTED_APPS:
            raise ValueError("app_id must be one of: " + ", ".join(sorted(SUPPORTED_APPS)))
        return normalized


class AppCredentialUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    app_name: Optional[str] = Field(None, max_length=100)
    auth: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None


class AppCredentialListItem(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    owner_email: Optional[str] = None
    user_permission: Optional[str] = None
    app_id: str
    app_name: str
    auth_mode: str
    # Non-secret preview data, useful for list rendering.
    # For source-style apps: {"domain": "..."}
    # For google-style apps: {"email": "...", "display_name": "...", "folder_name": "...", "drive_name": "..."}
    preview: Dict[str, Any] = Field(default_factory=dict)
    config: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class AppCredentialDetail(AppCredentialListItem):
    # Sensitive fields materialized for the edit form.
    # For source-style apps: includes decrypted access_token.
    # For google-style apps: includes full auth metadata (connection IDs etc.).
    auth: Dict[str, Any] = Field(default_factory=dict)


class AppCredentialApplyResponse(BaseModel):
    """Runtime payload Backup uses to execute a flow with this credential."""
    id: UUID
    owner_email: Optional[str] = None
    user_permission: Optional[str] = None
    app_id: str
    app_name: str
    auth_mode: str
    auth: Dict[str, Any]
    config: Dict[str, Any] = Field(default_factory=dict)
