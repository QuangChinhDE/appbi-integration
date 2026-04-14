import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from modules.backup.shared.types import GoogleConnectionResponse
from modules.credentials.backend.services.google_auth_service import AppConfigService, GoogleAuthService
from packages.database.src import get_db


router = APIRouter(tags=["credentials"])
SUPPORTED_TYPES = {"google"}


class GoogleOAuthConfig(BaseModel):
    client_id: str
    client_secret: str = "__KEEP__"
    redirect_uri: str = "http://localhost:8000/api/google/callback"


class GoogleServiceAccountPayload(BaseModel):
    service_account_json: Dict[str, Any]


class GoogleServiceAccountDrivesPayload(BaseModel):
    auth: Dict[str, Any]


class GoogleServiceAccountFoldersPayload(BaseModel):
    auth: Dict[str, Any]
    parent_id: str = "root"
    drive_id: Optional[str] = None


class GoogleServiceAccountSharedFoldersPayload(BaseModel):
    auth: Dict[str, Any]
    query: str = ""


class GoogleServiceAccountFolderInfoPayload(BaseModel):
    auth: Dict[str, Any]
    folder_id_or_url: str


@router.get("/api/settings/google")
async def get_google_settings(db: AsyncSession = Depends(get_db)):
    """Return current Google OAuth config (client_secret is masked)."""
    cfg = await AppConfigService(db).get_google_config()
    return {
        "client_id": cfg["client_id"],
        "client_secret": "••••••••" if cfg["client_secret"] else "",
        "redirect_uri": cfg["redirect_uri"],
        "configured": cfg["configured"],
    }


@router.put("/api/settings/google", status_code=200)
async def save_google_settings(
    body: GoogleOAuthConfig,
    db: AsyncSession = Depends(get_db),
):
    """Save Google OAuth credentials to the database (encrypted)."""
    config_service = AppConfigService(db)
    await config_service.set(
        "google_client_id",
        body.client_id,
        is_secret=False,
        description="Google OAuth 2.0 Client ID",
    )
    if body.client_secret and body.client_secret != "__KEEP__":
        await config_service.set(
            "google_client_secret",
            body.client_secret,
            is_secret=True,
            description="Google OAuth 2.0 Client Secret",
        )
    await config_service.set(
        "google_redirect_uri",
        body.redirect_uri,
        is_secret=False,
        description="Google OAuth 2.0 Redirect URI",
    )
    return {"message": "Google OAuth configuration saved successfully"}


@router.get("/api/google/auth-url")
async def google_auth_url(db: AsyncSession = Depends(get_db)):
    """
    Return a Google OAuth consent URL.
    The frontend should open this URL in a popup window.
    A random state value is embedded to prevent CSRF.
    """
    service = GoogleAuthService(db)
    try:
        state = str(uuid.uuid4())
        url = await service.get_auth_url(state)
        return {"url": url, "state": state}
    except ValueError:
        raise HTTPException(
            status_code=503,
            detail="Google OAuth is not configured. Please set Client ID and Client Secret in Settings.",
        )


@router.get("/api/google/callback", response_class=HTMLResponse)
async def google_callback(
    code: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    OAuth callback. Google redirects here after user grants consent.
    Exchanges code for tokens, saves the connection, then closes the popup
    via window.opener.postMessage.
    """
    if error:
        return HTMLResponse(_oauth_result_html(success=False, message=error))

    if not code:
        return HTMLResponse(
            _oauth_result_html(success=False, message="No authorization code received")
        )

    try:
        service = GoogleAuthService(db)
        token_data = await service.exchange_code(code)
        userinfo = await service.get_userinfo(token_data["access_token"])
        connection = await service.save_connection(token_data, userinfo)
        return HTMLResponse(
            _oauth_result_html(
                success=True,
                connection_id=str(connection.id),
                email=connection.email,
                display_name=connection.display_name or connection.email,
                picture_url=connection.picture_url or "",
            )
        )
    except Exception as exc:
        return HTMLResponse(_oauth_result_html(success=False, message=str(exc)))


def _oauth_result_html(
    success: bool,
    connection_id: str = "",
    email: str = "",
    display_name: str = "",
    picture_url: str = "",
    message: str = "",
) -> str:
    """Tiny HTML page that posts the result back to the opener and self-closes."""
    if success:
        payload = (
            f'{{"success":true,"connection_id":"{connection_id}",'
            f'"email":"{email}","display_name":"{display_name}",'
            f'"picture_url":"{picture_url}"}}'
        )
    else:
        safe_msg = message.replace('"', '\\"')
        payload = f'{{"success":false,"error":"{safe_msg}"}}'

    return f"""<!DOCTYPE html>
<html>
<head><title>Google Auth</title></head>
<body>
<script>
  var payload = {payload};
  if (window.opener) {{
    window.opener.postMessage(payload, window.location.origin);
  }}
  window.close();
</script>
<p>Authenticating... this window will close automatically.</p>
</body>
</html>"""


@router.get("/api/google/connections", response_model=List[GoogleConnectionResponse])
async def list_google_connections(db: AsyncSession = Depends(get_db)):
    """List all saved Google connections (tokens not exposed). Kept for Backup wizard."""
    service = GoogleAuthService(db)
    return await service.list_connections()


@router.delete("/api/google/connections/{connection_id}", status_code=204)
async def delete_google_connection(
    connection_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Remove a saved Google connection. Kept for Backup wizard."""
    service = GoogleAuthService(db)
    deleted = await service.delete_connection(connection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Connection not found")


@router.get("/api/credentials")
async def list_credentials(
    type: Optional[str] = Query(None, description="Filter by provider type (e.g. 'google')"),
    db: AsyncSession = Depends(get_db),
):
    """
    List all saved credentials across all providers.
    Each item includes a 'type' field so the frontend knows which provider it belongs to.
    Use ?type=google to filter.
    """
    result = []

    if type is None or type == "google":
        service = GoogleAuthService(db)
        connections = await service.list_connections()
        for connection in connections:
            item = connection.model_dump() if hasattr(connection, "model_dump") else dict(connection)
            item["type"] = "google"
            result.append(item)

    return result


@router.delete("/api/credentials/{credential_id}", status_code=204)
async def delete_credential(
    credential_id: str,
    type: str = Query(..., description="Provider type, e.g. 'google'"),
    db: AsyncSession = Depends(get_db),
):
    """Delete a credential by ID for the given provider type."""
    if type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported credential type: {type}")

    if type == "google":
        service = GoogleAuthService(db)
        deleted = await service.delete_connection(credential_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Credential not found")


@router.get("/api/google/drives")
async def list_google_drives(
    connection_id: str = Query(..., description="GoogleConnection UUID"),
    db: AsyncSession = Depends(get_db),
):
    """List My Drive + Shared Drives for the given connection."""
    service = GoogleAuthService(db)
    try:
        return await service.list_drives(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")


@router.post("/api/google/service-account/analyze")
async def analyze_google_service_account(
    body: GoogleServiceAccountPayload,
    db: AsyncSession = Depends(get_db),
):
    service = GoogleAuthService(db)
    try:
        return await service.analyze_service_account(body.service_account_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google service account error: {exc}")


@router.post("/api/google/service-account/drives")
async def list_service_account_drives(
    body: GoogleServiceAccountDrivesPayload,
    db: AsyncSession = Depends(get_db),
):
    service = GoogleAuthService(db)
    try:
        return await service.list_drives_for_auth(body.auth)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")


@router.get("/api/google/folders")
async def list_google_folders(
    connection_id: str = Query(...),
    parent_id: str = Query("root"),
    drive_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List sub-folders inside a folder. Defaults to the root of My Drive."""
    service = GoogleAuthService(db)
    try:
        return await service.list_folders(connection_id, parent_id=parent_id, drive_id=drive_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")


@router.post("/api/google/service-account/folders")
async def list_service_account_folders(
    body: GoogleServiceAccountFoldersPayload,
    db: AsyncSession = Depends(get_db),
):
    service = GoogleAuthService(db)
    try:
        return await service.list_folders_for_auth(
            body.auth,
            parent_id=body.parent_id,
            drive_id=body.drive_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")


@router.post("/api/google/service-account/shared-folders")
async def list_service_account_shared_folders(
    body: GoogleServiceAccountSharedFoldersPayload,
    db: AsyncSession = Depends(get_db),
):
    service = GoogleAuthService(db)
    try:
        return await service.list_shared_folders_for_auth(body.auth, query=body.query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")


@router.post("/api/google/service-account/folder-info")
async def get_service_account_folder_info(
    body: GoogleServiceAccountFolderInfoPayload,
    db: AsyncSession = Depends(get_db),
):
    service = GoogleAuthService(db)
    try:
        return await service.get_folder_info_for_auth(body.auth, body.folder_id_or_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")