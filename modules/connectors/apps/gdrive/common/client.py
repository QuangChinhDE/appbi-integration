"""
Google Drive REST client.

Extracted and refactored from modules/connectors/apps/request/backup/extractor.py
so all modules (backup, pipeline, automation) can share the same Drive helpers.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

import httpx

from modules.connectors.apps.gdrive.common.constants import (
    DRIVES_API,
    FILES_API,
    FOLDER_MIME,
    SHEET_MIME,
    UPLOAD_API,
)


# ── Token provider types ─────────────────────────────────────────────────────

GoogleDriveTokenProvider = Callable[[bool], Awaitable[str]]
GoogleDriveTokenSource = Union[str, GoogleDriveTokenProvider]
GoogleDriveTokenLoader = Callable[[bool], Awaitable[tuple[str, Optional[datetime]]]]
GDRIVE_TOKEN_PROACTIVE_REFRESH_WINDOW = timedelta(minutes=10)


class GoogleDriveApiError(RuntimeError):
    pass


# ── Token helpers ─────────────────────────────────────────────────────────────

async def _resolve_token(source: GoogleDriveTokenSource, force_refresh: bool = False) -> str:
    if callable(source):
        return await source(force_refresh)
    return source


def _normalize_expiry(expires_at: Optional[datetime]) -> Optional[datetime]:
    if expires_at is not None and expires_at.tzinfo is None:
        return expires_at.replace(tzinfo=timezone.utc)
    return expires_at


def build_cached_token_provider(
    load_token: GoogleDriveTokenLoader,
    refresh_window: timedelta = GDRIVE_TOKEN_PROACTIVE_REFRESH_WINDOW,
) -> GoogleDriveTokenProvider:
    """Build a cached token provider with proactive refresh."""
    cached_token: Optional[str] = None
    cached_expiry: Optional[datetime] = None

    async def provider(force_refresh: bool = False) -> str:
        nonlocal cached_token, cached_expiry

        expires_at = _normalize_expiry(cached_expiry)
        proactive_refresh = (
            cached_token is not None
            and expires_at is not None
            and expires_at <= datetime.now(timezone.utc) + refresh_window
        )

        if force_refresh or cached_token is None or proactive_refresh:
            cached_token, cached_expiry = await load_token(force_refresh or proactive_refresh)

        if cached_token is None:
            raise GoogleDriveApiError("Google Drive access token could not be loaded")

        return cached_token

    return provider


# ── Low-level HTTP ────────────────────────────────────────────────────────────

async def _gdrive_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    token_source: GoogleDriveTokenSource,
    **kwargs: Any,
) -> httpx.Response:
    """Make a GDrive API request with automatic 401-retry and token refresh."""
    base_headers = dict(kwargs.pop("headers", {}) or {})
    attempts = 2 if callable(token_source) else 1
    response: Optional[httpx.Response] = None

    for attempt in range(attempts):
        token = await _resolve_token(token_source, force_refresh=attempt > 0)
        headers = {**base_headers, "Authorization": f"Bearer {token}"}
        response = await client.request(method, url, headers=headers, **kwargs)
        if response.status_code != 401:
            return response

    assert response is not None
    return response


# ── Name helpers ──────────────────────────────────────────────────────────────

def sanitize_name(name: str) -> str:
    """Remove characters invalid in Drive folder/file names."""
    return re.sub(r'[/\\:*?"<>|]', "_", name or "").strip(". ")


def truncate_name(name: str, max_length: int = 50) -> str:
    if len(name) <= max_length:
        return name
    return name[:max_length] + "..."


def normalize_sheet_filename(filename: str) -> str:
    lowered = filename.lower()
    for ext in (".xlsx", ".xls", ".csv", ".tsv"):
        if lowered.endswith(ext):
            return filename[: -len(ext)]
    return filename


def is_google_sheets_destination(destination_type: Optional[str]) -> bool:
    return str(destination_type or "").strip().lower() == "gsheets"


# ── Google Drive Management Client ───────────────────────────────────────────

class GoogleDriveClient:
    """High-level Google Drive operations using REST v3 API."""

    def __init__(self, token_source: GoogleDriveTokenSource, *, timeout: float = 30.0):
        self.token_source = token_source
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "GoogleDriveClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    # ── Drives ────────────────────────────────────────────────────────────

    async def list_drives(self) -> list[dict[str, Any]]:
        """List shared drives accessible to the authenticated user."""
        client = await self._http()
        drives: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, str] = {"pageSize": "100"}
            if page_token:
                params["pageToken"] = page_token
            resp = await _gdrive_request(client, "GET", DRIVES_API, self.token_source, params=params)
            resp.raise_for_status()
            data = resp.json()
            for d in data.get("drives", []):
                drives.append({"drive_id": d["id"], "name": d.get("name", "")})
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return drives

    # ── Folders ───────────────────────────────────────────────────────────

    async def find_folders(
        self,
        name: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> list[dict[str, str]]:
        """Find all folders with exact name inside parent."""
        safe_name = name.replace("\\", "\\\\").replace("'", "\\'")
        params: dict[str, str] = {
            "q": (
                f"name='{safe_name}' and '{parent_id}' in parents "
                f"and mimeType='{FOLDER_MIME}' and trashed=false"
            ),
            "fields": "files(id,name)",
            "pageSize": "100",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if drive_id and drive_id != "root":
            params["driveId"] = drive_id
            params["corpora"] = "drive"
        else:
            params["corpora"] = "allDrives"

        client = await self._http()
        resp = await _gdrive_request(client, "GET", FILES_API, self.token_source, params=params)
        resp.raise_for_status()
        return [
            {"id": f["id"], "name": f.get("name", "")}
            for f in resp.json().get("files", [])
            if isinstance(f, dict) and f.get("id")
        ]

    async def find_folder(
        self, name: str, parent_id: str, *, drive_id: str | None = None
    ) -> str | None:
        """Find a folder by exact name. Returns ID or None."""
        folders = await self.find_folders(name, parent_id, drive_id=drive_id)
        return folders[0]["id"] if folders else None

    async def create_folder(self, name: str, parent_id: str) -> str:
        """Create a new folder. Returns its Drive ID."""
        client = await self._http()
        resp = await _gdrive_request(
            client, "POST", FILES_API, self.token_source,
            headers={"Content-Type": "application/json"},
            json={"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]},
            params={"supportsAllDrives": "true"},
        )
        resp.raise_for_status()
        return resp.json()["id"]

    async def get_or_create_folder(
        self, name: str, parent_id: str, *, drive_id: str | None = None
    ) -> str:
        """Get-or-create a folder. Returns its Drive ID."""
        existing = await self.find_folder(name, parent_id, drive_id=drive_id)
        if existing:
            return existing
        return await self.create_folder(name, parent_id)

    async def archive_item(self, item_id: str, *, ignore_missing: bool = False) -> bool:
        """Move an item to trash."""
        client = await self._http()
        resp = await _gdrive_request(
            client, "PATCH", f"{FILES_API}/{item_id}", self.token_source,
            headers={"Content-Type": "application/json"},
            params={"supportsAllDrives": "true"},
            json={"trashed": True},
        )
        if ignore_missing and resp.status_code == 404:
            return False
        resp.raise_for_status()
        return True

    async def recreate_folder(
        self, name: str, parent_id: str, *, drive_id: str | None = None
    ) -> tuple[str, int]:
        """Archive existing folder(s) with same name, then create fresh."""
        existing = await self.find_folders(name, parent_id, drive_id=drive_id)
        archived = 0
        for folder in existing:
            if await self.archive_item(folder["id"], ignore_missing=True):
                archived += 1

        if existing:
            remaining = await self.find_folders(name, parent_id, drive_id=drive_id)
            if remaining:
                raise GoogleDriveApiError(
                    f"Cannot recreate '{name}': {len(remaining)} folder(s) still remain. "
                    "Move old folders to trash manually or grant appropriate Drive permissions."
                )

        new_id = await self.create_folder(name, parent_id)
        return new_id, archived

    # ── Files ─────────────────────────────────────────────────────────────

    async def list_files(
        self,
        parent_id: str,
        *,
        drive_id: str | None = None,
        mime_type: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """List files in a folder."""
        q_parts = [f"'{parent_id}' in parents", "trashed=false"]
        if mime_type:
            q_parts.append(f"mimeType='{mime_type}'")
        params: dict[str, str] = {
            "q": " and ".join(q_parts),
            "fields": "files(id,name,mimeType,size,modifiedTime,createdTime),nextPageToken",
            "pageSize": str(page_size),
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if drive_id and drive_id != "root":
            params["driveId"] = drive_id
            params["corpora"] = "drive"
        else:
            params["corpora"] = "allDrives"

        client = await self._http()
        files: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            if page_token:
                params["pageToken"] = page_token
            resp = await _gdrive_request(client, "GET", FILES_API, self.token_source, params=params)
            resp.raise_for_status()
            data = resp.json()
            files.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return files

    async def get_file_metadata(self, file_id: str) -> dict[str, Any]:
        """Get metadata for a single file."""
        client = await self._http()
        resp = await _gdrive_request(
            client, "GET", f"{FILES_API}/{file_id}", self.token_source,
            params={
                "fields": "id,name,mimeType,size,modifiedTime,createdTime,parents",
                "supportsAllDrives": "true",
            },
        )
        resp.raise_for_status()
        return resp.json()

    async def upload_bytes(
        self,
        filename: str,
        content: bytes,
        mime_type: str,
        parent_id: str,
        *,
        convert_to_sheet: bool = False,
    ) -> str:
        """Upload bytes as a file. Returns new file ID."""
        metadata: dict[str, Any] = {
            "name": normalize_sheet_filename(filename) if convert_to_sheet else filename,
            "parents": [parent_id],
        }
        if convert_to_sheet:
            metadata["mimeType"] = SHEET_MIME

        meta_json = json.dumps(metadata)
        boundary = "gdrive_multipart_boundary"
        body = (
            f"--{boundary}\r\n"
            f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{meta_json}\r\n"
            f"--{boundary}\r\n"
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8") + content + f"\r\n--{boundary}--".encode("utf-8")

        client = await self._http()
        resp = await _gdrive_request(
            client, "POST", UPLOAD_API, self.token_source,
            headers={"Content-Type": f"multipart/related; boundary={boundary}"},
            params={"uploadType": "multipart", "supportsAllDrives": "true"},
            content=body,
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.json()["id"]

    async def upload_tabular_bytes(
        self,
        filename: str,
        content: bytes,
        parent_id: str,
        *,
        destination_type: str | None = None,
    ) -> str:
        """Upload an Excel file, optionally converting to Google Sheets."""
        from modules.connectors.apps.gdrive.common.constants import XLSX_MIME
        return await self.upload_bytes(
            filename, content, XLSX_MIME, parent_id,
            convert_to_sheet=is_google_sheets_destination(destination_type),
        )

    async def download_bytes(self, file_id: str) -> bytes:
        """Download the raw bytes for a Drive file."""
        client = await self._http()
        resp = await _gdrive_request(
            client, "GET", f"{FILES_API}/{file_id}", self.token_source,
            params={"alt": "media", "supportsAllDrives": "true"},
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.content

    async def delete_file(self, file_id: str) -> None:
        """Permanently delete a file."""
        client = await self._http()
        resp = await _gdrive_request(
            client, "DELETE", f"{FILES_API}/{file_id}", self.token_source,
            params={"supportsAllDrives": "true"},
        )
        resp.raise_for_status()

    async def move_file(self, file_id: str, new_parent_id: str, old_parent_id: str) -> dict[str, Any]:
        """Move a file to a different folder."""
        client = await self._http()
        resp = await _gdrive_request(
            client, "PATCH", f"{FILES_API}/{file_id}", self.token_source,
            params={
                "addParents": new_parent_id,
                "removeParents": old_parent_id,
                "supportsAllDrives": "true",
            },
        )
        resp.raise_for_status()
        return resp.json()
