from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


SUPPORTED_DESTINATION_TYPES = {"gdrive", "gsheets"}


class DestinationProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    destination_type: str = Field(..., description="gdrive | gsheets")
    auth: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("destination_type")
    def validate_destination_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in SUPPORTED_DESTINATION_TYPES:
            raise ValueError("destination_type must be one of: gdrive, gsheets")
        return normalized


class DestinationProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    destination_type: Optional[str] = Field(None, description="gdrive | gsheets")
    auth: Optional[Dict[str, Any]] = None

    @field_validator("destination_type")
    def validate_optional_destination_type(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = str(value or "").strip().lower()
        if normalized not in SUPPORTED_DESTINATION_TYPES:
            raise ValueError("destination_type must be one of: gdrive, gsheets")
        return normalized


class DestinationProfileListItem(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    destination_type: str
    destination_name: str
    auth_mode: str
    connection_label: Optional[str] = None
    folder_name: Optional[str] = None
    drive_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class DestinationProfileDetail(DestinationProfileListItem):
    auth: Dict[str, Any]


class DestinationProfileApplyResponse(BaseModel):
    id: UUID
    destination: Dict[str, Any]