from fastapi import FastAPI, HTTPException, Depends, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from pydantic import BaseModel
import os
import uuid
from datetime import datetime

from database import engine, get_db, Base
from models import BackupFlow, BackupFlowRun, BackupSourceApp, GoogleConnection, AppConfig
from schemas import (
    BackupFlowCreate, 
    BackupFlowDraftCreate,
    BackupFlowSave,
    BackupFlowAutosave,
    BackupFlowResponse, 
    BackupFlowUpdate,
    BackupFlowListResponse,
    BackupSourceAppResponse,
    GoogleConnectionResponse,
    GoogleDriveItem,
    GoogleFolderItem
)
from services import BackupFlowService, BackupSourceAppService
from google_auth import GoogleAuthService, AppConfigService

# ── Request bodies for settings ────────────────────────────────────────────────────────

class GoogleOAuthConfig(BaseModel):
    client_id: str
    client_secret: str = "__KEEP__"   # __KEEP__ = don't overwrite existing
    redirect_uri: str = "https://n8n.base-datateam.com/rest/oauth2-credential/callback"

# Create FastAPI app
app = FastAPI(
    title="IntegrationHub API",
    description="Backend API for IntegrationHub backup system",
    version="1.0.0"
)

# CORS Configuration
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables on startup
@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

# Backup flows endpoints
@app.post("/api/backup-flows/draft", response_model=BackupFlowResponse, status_code=201)
async def create_backup_flow_draft(
    draft: BackupFlowDraftCreate = BackupFlowDraftCreate(),
    db: AsyncSession = Depends(get_db)
):
    """
    Create an empty draft backup flow.
    Returns immediately with a new UUID, is_draft=1, is_published=0, all other fields null.
    """
    service = BackupFlowService(db)
    try:
        new_draft = await service.create_draft(draft)
        return new_draft
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create draft: {str(e)}")


@app.post("/api/backup-flows/{flow_id}/save", response_model=BackupFlowResponse)
async def save_backup_flow(
    flow_id: str,
    save_data: BackupFlowSave,
    db: AsyncSession = Depends(get_db)
):
    """
    Save (publish) a draft backup flow with all required details.
    Sets is_draft=0, is_published=1 and fills in all fields.
    """
    service = BackupFlowService(db)
    try:
        saved_flow = await service.save_flow(flow_id, save_data)
        if not saved_flow:
            raise HTTPException(status_code=404, detail="Backup flow not found")
        return saved_flow
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save backup flow: {str(e)}")


@app.post("/api/backup-flows", response_model=BackupFlowResponse, status_code=201)
async def create_backup_flow(
    flow: BackupFlowCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new backup flow
    
    - **source**: App information with domain and access token (will be hashed)
    - **backup_type**: Type of backup (structured, unstructured, all)
    - **destination**: Storage destination information
    - **structure**: Backup structure configuration (optional)
    - **schedule**: Schedule configuration (optional)
    """
    service = BackupFlowService(db)
    try:
        new_flow = await service.create_flow(flow)
        return new_flow
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create backup flow: {str(e)}")

@app.get("/api/backup-flows", response_model=List[BackupFlowListResponse])
async def list_backup_flows(
    status: Optional[str] = None,
    app: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """
    List all backup flows with optional filtering
    
    - **status**: Filter by status (active, paused, archived)
    - **app**: Filter by app type (request, workflow, wework, service)
    - **skip**: Number of records to skip (pagination)
    - **limit**: Maximum number of records to return
    """
    service = BackupFlowService(db)
    flows = await service.list_flows(status=status, app=app, skip=skip, limit=limit)
    return flows

@app.get("/api/backup-flows/{flow_id}", response_model=BackupFlowResponse)
async def get_backup_flow(
    flow_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific backup flow by ID"""
    service = BackupFlowService(db)
    flow = await service.get_flow(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    return flow

@app.patch("/api/backup-flows/{flow_id}", response_model=BackupFlowResponse)
async def update_backup_flow(
    flow_id: str,
    flow_update: BackupFlowUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a backup flow"""
    service = BackupFlowService(db)
    try:
        updated_flow = await service.update_flow(flow_id, flow_update)
        if not updated_flow:
            raise HTTPException(status_code=404, detail="Backup flow not found")
        return updated_flow
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/backup-flows/{flow_id}/autosave", status_code=200)
async def autosave_backup_flow(
    flow_id: str,
    data: BackupFlowAutosave,
    db: AsyncSession = Depends(get_db)
):
    """Auto-save partial wizard step data to the backup flow."""
    service = BackupFlowService(db)
    ok = await service.autosave_flow(flow_id, data)
    if not ok:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    return {"saved": True}

@app.delete("/api/backup-flows/{flow_id}", status_code=204)
async def delete_backup_flow(
    flow_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a backup flow"""
    service = BackupFlowService(db)
    success = await service.delete_flow(flow_id)
    if not success:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    return None


@app.post("/api/backup-flows/{flow_id}/publish", response_model=BackupFlowResponse)
async def publish_backup_flow(
    flow_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Publish a flow: set is_draft=0, is_published=1"""
    service = BackupFlowService(db)
    flow = await service.publish_flow(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    return flow

@app.post("/api/backup-flows/{flow_id}/run", status_code=202)
async def run_backup_flow(
    flow_id: str,
    triggered_by: str = "manual",
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger a backup flow execution
    
    Returns immediately with run_id. Actual backup runs asynchronously.
    """
    service = BackupFlowService(db)
    run = await service.trigger_flow_run(flow_id, triggered_by)
    if not run:
        raise HTTPException(status_code=404, detail="Backup flow not found")
    
    return {
        "run_id": str(run.id),
        "flow_id": str(run.flow_id),
        "status": run.status,
        "message": "Backup flow triggered successfully"
    }

@app.get("/api/backup-flows/{flow_id}/runs")
async def get_flow_runs(
    flow_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Get execution history for a backup flow"""
    service = BackupFlowService(db)
    runs = await service.get_flow_runs(flow_id, limit=limit)
    return runs


# ── Source app endpoints ────────────────────────────────────────────────────

@app.get("/api/source-apps", response_model=List[BackupSourceAppResponse])
async def list_source_apps(db: AsyncSession = Depends(get_db)):
    """List all active source app API definitions."""
    service = BackupSourceAppService(db)
    return await service.list_source_apps()


@app.get("/api/source-apps/{app_id}", response_model=BackupSourceAppResponse)
async def get_source_app(app_id: str, db: AsyncSession = Depends(get_db)):
    """Get full API step definitions for a specific source app."""
    service = BackupSourceAppService(db)
    app = await service.get_source_app(app_id)
    if not app:
        raise HTTPException(status_code=404, detail=f"Source app '{app_id}' not found")
    return app


# ── Settings endpoints ───────────────────────────────────────────────────────

@app.get("/api/settings/google")
async def get_google_settings(db: AsyncSession = Depends(get_db)):
    """Return current Google OAuth config (client_secret is masked)."""
    cfg = await AppConfigService(db).get_google_config()
    return {
        "client_id": cfg["client_id"],
        "client_secret": "••••••••" if cfg["client_secret"] else "",
        "redirect_uri": cfg["redirect_uri"],
        "configured": cfg["configured"],
    }


@app.put("/api/settings/google", status_code=200)
async def save_google_settings(
    body: GoogleOAuthConfig,
    db: AsyncSession = Depends(get_db),
):
    """Save Google OAuth credentials to the database (encrypted)."""
    cs = AppConfigService(db)
    await cs.set("google_client_id", body.client_id, is_secret=False,
                 description="Google OAuth 2.0 Client ID")
    # Only overwrite the secret when the frontend sends a real value
    if body.client_secret and body.client_secret != "__KEEP__":
        await cs.set("google_client_secret", body.client_secret, is_secret=True,
                     description="Google OAuth 2.0 Client Secret")
    await cs.set("google_redirect_uri", body.redirect_uri, is_secret=False,
                 description="Google OAuth 2.0 Redirect URI")
    return {"message": "Google OAuth configuration saved successfully"}


# ── Google OAuth & Drive endpoints ──────────────────────────────────────────

@app.get("/api/google/auth-url")
async def google_auth_url(db: AsyncSession = Depends(get_db)):
    """
    Return a Google OAuth consent URL.
    The frontend should open this URL in a popup window.
    A random state value is embedded to prevent CSRF.
    """
    svc = GoogleAuthService(db)
    try:
        state = str(uuid.uuid4())
        url = await svc.get_auth_url(state)
        return {"url": url, "state": state}
    except ValueError:
        raise HTTPException(
            status_code=503,
            detail="Google OAuth is not configured. Please set Client ID and Client Secret in Settings."
        )


@app.get("/api/google/callback", response_class=HTMLResponse)
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
        return HTMLResponse(_oauth_result_html(success=False, message="No authorization code received"))

    try:
        svc = GoogleAuthService(db)
        token_data = await svc.exchange_code(code)
        userinfo = await svc.get_userinfo(token_data["access_token"])
        conn = await svc.save_connection(token_data, userinfo)
        return HTMLResponse(
            _oauth_result_html(
                success=True,
                connection_id=str(conn.id),
                email=conn.email,
                display_name=conn.display_name or conn.email,
                picture_url=conn.picture_url or "",
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


@app.get("/api/google/connections", response_model=List[GoogleConnectionResponse])
async def list_google_connections(db: AsyncSession = Depends(get_db)):
    """List all saved Google connections (tokens not exposed). Kept for Backup wizard."""
    svc = GoogleAuthService(db)
    return await svc.list_connections()


@app.delete("/api/google/connections/{connection_id}", status_code=204)
async def delete_google_connection(
    connection_id: str, db: AsyncSession = Depends(get_db)
):
    """Remove a saved Google connection. Kept for Backup wizard."""
    svc = GoogleAuthService(db)
    deleted = await svc.delete_connection(connection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Connection not found")


# ── Generic credential endpoints (provider-agnostic) ─────────────────────────

SUPPORTED_TYPES = {"google"}

@app.get("/api/credentials")
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

    # Google connections
    if type is None or type == "google":
        svc = GoogleAuthService(db)
        conns = await svc.list_connections()
        for c in conns:
            item = c.model_dump() if hasattr(c, "model_dump") else dict(c)
            item["type"] = "google"
            result.append(item)

    # Future providers: elif type in ("onedrive", ...) → append similarly

    return result


@app.delete("/api/credentials/{credential_id}", status_code=204)
async def delete_credential(
    credential_id: str,
    type: str = Query(..., description="Provider type, e.g. 'google'"),
    db: AsyncSession = Depends(get_db),
):
    """Delete a credential by ID for the given provider type."""
    if type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported credential type: {type}")

    if type == "google":
        svc = GoogleAuthService(db)
        deleted = await svc.delete_connection(credential_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Credential not found")


@app.get("/api/google/drives")
async def list_google_drives(
    connection_id: str = Query(..., description="GoogleConnection UUID"),
    db: AsyncSession = Depends(get_db),
):
    """List My Drive + Shared Drives for the given connection."""
    svc = GoogleAuthService(db)
    try:
        return await svc.list_drives(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")


@app.get("/api/google/folders")
async def list_google_folders(
    connection_id: str = Query(...),
    parent_id: str = Query("root"),
    drive_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List sub-folders inside a folder. Defaults to the root of My Drive."""
    svc = GoogleAuthService(db)
    try:
        return await svc.list_folders(connection_id, parent_id=parent_id, drive_id=drive_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
