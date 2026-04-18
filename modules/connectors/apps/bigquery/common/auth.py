"""
BigQuery credentials — wraps either OAuth2 or Service Account auth.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class BigQueryCredentials(BaseModel):
    """Credential data for BigQuery access."""
    auth_mode: str = Field(..., description="'google_oauth' or 'service_account'")
    project_id: str = Field(..., description="GCP project ID")
    dataset_id: Optional[str] = Field(None, description="Default dataset ID")
    connection_id: Optional[str] = Field(None, description="GoogleConnection UUID (OAuth)")
    service_account_info: Optional[Dict[str, Any]] = Field(None, description="SA JSON key")
