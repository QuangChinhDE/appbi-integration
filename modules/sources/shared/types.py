from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


SUPPORTED_SOURCE_APPS = {
    "request": "Request",
    "workflow": "Workflow",
    "wework": "WeWork",
    "service": "Service",
}


class SourceConnectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    app_id: str = Field(..., description="request | workflow | wework | service")
    app_name: Optional[str] = Field(None, max_length=100)
    domain: Optional[str] = Field(None, max_length=255)
    access_token: str = Field(..., min_length=1)
    config: Optional[Dict[str, Any]] = None

    @field_validator("app_id")
    def validate_app_id(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in SUPPORTED_SOURCE_APPS:
            raise ValueError("app_id must be one of: request, workflow, wework, service")
        return normalized

    @field_validator("domain")
    def normalize_domain(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("access_token")
    def normalize_access_token(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("access_token is required")
        return normalized


class SourceConnectionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    app_id: Optional[str] = Field(None, description="request | workflow | wework | service")
    app_name: Optional[str] = Field(None, max_length=100)
    domain: Optional[str] = Field(None, max_length=255)
    access_token: Optional[str] = Field(None, min_length=1)
    config: Optional[Dict[str, Any]] = None

    @field_validator("app_id")
    def validate_optional_app_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = str(value or "").strip().lower()
        if normalized not in SUPPORTED_SOURCE_APPS:
            raise ValueError("app_id must be one of: request, workflow, wework, service")
        return normalized

    @field_validator("domain")
    def normalize_optional_domain(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("access_token")
    def normalize_optional_access_token(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("access_token is required")
        return normalized


class SourceConnectionListItem(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    app_id: str
    app_name: str
    domain: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class SourceConnectionDetail(SourceConnectionListItem):
    access_token: str


class SourceConnectionApplyResponse(BaseModel):
    id: UUID
    source: Dict[str, Any]