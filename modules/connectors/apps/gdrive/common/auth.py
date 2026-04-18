"""
Google Drive credentials — wraps either OAuth2 or Service Account auth.

Unlike Base apps (domain + access_token), Google connectors use
GoogleAuthService for token management. The credential stores either:
  - connection_id (for OAuth2 — references a GoogleConnection row)
  - service_account_info (for SA — JSON key inline)
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class GoogleDriveCredentials(BaseModel):
    """Credential data for Google Drive access."""
    auth_mode: str = Field(..., description="'google_oauth' or 'service_account'")
    # OAuth mode
    connection_id: Optional[str] = Field(None, description="GoogleConnection UUID (OAuth)")
    # Service Account mode
    service_account_info: Optional[Dict[str, Any]] = Field(None, description="SA JSON key")
    # Destination context
    folder_id: Optional[str] = Field(None, description="Root folder ID")
    drive_id: Optional[str] = Field(None, description="Shared Drive ID")
