"""
Google Sheets credentials — wraps either OAuth2 or Service Account auth.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class GoogleSheetsCredentials(BaseModel):
    """Credential data for Google Sheets access."""
    auth_mode: str = Field(..., description="'google_oauth' or 'service_account'")
    connection_id: Optional[str] = Field(None, description="GoogleConnection UUID (OAuth)")
    service_account_info: Optional[Dict[str, Any]] = Field(None, description="SA JSON key")
