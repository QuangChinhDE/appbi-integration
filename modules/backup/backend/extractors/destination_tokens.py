from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

import httpx

from modules.backup.backend.extractors._gdrive import build_cached_gdrive_token_provider
from modules.backup.backend.extractors._onedrive import build_cached_onedrive_token_provider
from modules.connectors.apps._packages import canonical_connector_key
from modules.connectors.apps.onedrive.common.constants import DEFAULT_GRAPH_SCOPES, TOKEN_ENDPOINT_TEMPLATE
from modules.credentials.backend.services.google_auth_service import (
    GoogleAuthService,
    validate_service_account_drive_destination,
)


def _parse_expiry(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _refresh_onedrive_access_token(auth: Mapping[str, Any]) -> tuple[str, datetime | None]:
    refresh_token = str(auth.get("refresh_token") or "").strip()
    client_id = str(auth.get("client_id") or "").strip()
    if not refresh_token or not client_id:
        raise ValueError(
            "OneDrive access token is expired or rejected, and this credential has no "
            "refresh_token/client_id to refresh it. Update the OneDrive credential in Apps."
        )

    tenant_id = str(auth.get("tenant_id") or "common").strip() or "common"
    client_secret = str(auth.get("client_secret") or "").strip()
    form_data = {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
        "scope": " ".join(DEFAULT_GRAPH_SCOPES),
    }
    if client_secret:
        form_data["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            TOKEN_ENDPOINT_TEMPLATE.format(tenant_id=tenant_id),
            data=form_data,
        )
    response.raise_for_status()
    payload = response.json()
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise ValueError("Microsoft token endpoint did not return an access_token")

    expires_in = payload.get("expires_in")
    expires_at = None
    if expires_in is not None:
        try:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        except (TypeError, ValueError):
            expires_at = None
    return access_token, expires_at


async def build_backup_destination_token_provider(
    db,
    destination_type: str | None,
    destination_auth: Mapping[str, Any],
):
    normalized_destination = canonical_connector_key(destination_type)
    auth_payload = dict(destination_auth or {})

    if normalized_destination == "gdrive":
        validate_service_account_drive_destination(auth_payload)
        google_auth_service = GoogleAuthService(db)

        async def load_gdrive_token(force_refresh: bool = False):
            return await google_auth_service.get_destination_access_token_details(
                auth_payload,
                force_refresh=force_refresh,
            )

        return build_cached_gdrive_token_provider(load_gdrive_token)

    if normalized_destination == "onedrive":
        current_token = str(auth_payload.get("access_token") or "").strip()
        current_expiry = _parse_expiry(
            auth_payload.get("token_expiry")
            or auth_payload.get("expires_at")
            or auth_payload.get("expires")
        )

        async def load_onedrive_token(force_refresh: bool = False):
            nonlocal current_token, current_expiry
            if force_refresh and auth_payload.get("refresh_token"):
                current_token, current_expiry = await _refresh_onedrive_access_token(auth_payload)
            if not current_token:
                current_token, current_expiry = await _refresh_onedrive_access_token(auth_payload)
            return current_token, current_expiry

        return build_cached_onedrive_token_provider(load_onedrive_token)

    raise ValueError(f'Backup destination "{destination_type}" is not implemented.')

