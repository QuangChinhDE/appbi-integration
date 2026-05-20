"""Microsoft Graph OneDrive client used by Backup destinations."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional, Union
from urllib.parse import quote

import httpx

from modules.connectors.apps.onedrive.common.constants import (
    FOLDER_MIME,
    GRAPH_API,
    ROOT_ITEM_ID,
    XLSX_MIME,
)


OneDriveTokenProvider = Callable[[bool], Awaitable[str]]
OneDriveTokenSource = Union[str, OneDriveTokenProvider]
OneDriveTokenLoader = Callable[[bool], Awaitable[tuple[str, Optional[datetime]]]]
ONEDRIVE_TOKEN_PROACTIVE_REFRESH_WINDOW = timedelta(minutes=10)
ONEDRIVE_SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024
ONEDRIVE_UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024


class OneDriveApiError(RuntimeError):
    pass


async def _resolve_token(source: OneDriveTokenSource, force_refresh: bool = False) -> str:
    if callable(source):
        return await source(force_refresh)
    return source


def _normalize_expiry(expires_at: Optional[datetime]) -> Optional[datetime]:
    if expires_at is not None and expires_at.tzinfo is None:
        return expires_at.replace(tzinfo=timezone.utc)
    return expires_at


def build_cached_token_provider(
    load_token: OneDriveTokenLoader,
    refresh_window: timedelta = ONEDRIVE_TOKEN_PROACTIVE_REFRESH_WINDOW,
) -> OneDriveTokenProvider:
    cached_token: Optional[str] = None
    cached_expiry: Optional[datetime] = None
    refresh_lock = asyncio.Lock()

    async def provider(force_refresh: bool = False) -> str:
        nonlocal cached_token, cached_expiry

        expires_at = _normalize_expiry(cached_expiry)
        proactive_refresh = (
            cached_token is not None
            and expires_at is not None
            and expires_at <= datetime.now(timezone.utc) + refresh_window
        )

        if force_refresh or cached_token is None or proactive_refresh:
            async with refresh_lock:
                expires_at = _normalize_expiry(cached_expiry)
                proactive_refresh = (
                    cached_token is not None
                    and expires_at is not None
                    and expires_at <= datetime.now(timezone.utc) + refresh_window
                )
                if force_refresh or cached_token is None or proactive_refresh:
                    cached_token, cached_expiry = await load_token(force_refresh or proactive_refresh)

        if cached_token is None:
            raise OneDriveApiError("OneDrive access token could not be loaded")
        return cached_token

    return provider


async def _onedrive_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    token_source: OneDriveTokenSource,
    **kwargs: Any,
) -> httpx.Response:
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


def _is_root_item(item_id: str | None) -> bool:
    return not item_id or str(item_id).strip().lower() == ROOT_ITEM_ID


def _drive_base(drive_id: str | None = None) -> str:
    if drive_id and str(drive_id).strip().lower() != ROOT_ITEM_ID:
        return f"{GRAPH_API}/drives/{quote(str(drive_id), safe='')}"
    return f"{GRAPH_API}/me/drive"


def _item_url(item_id: str | None, *, drive_id: str | None = None) -> str:
    base = _drive_base(drive_id)
    if _is_root_item(item_id):
        return f"{base}/root"
    return f"{base}/items/{quote(str(item_id), safe='')}"


def _upload_content_url(parent_id: str | None, filename: str, *, drive_id: str | None = None) -> str:
    base = _drive_base(drive_id)
    safe_name = quote(filename.replace("/", "_"), safe="")
    if _is_root_item(parent_id):
        return f"{base}/root:/{safe_name}:/content"
    return f"{base}/items/{quote(str(parent_id), safe='')}:/{safe_name}:/content"


def _upload_session_url(parent_id: str | None, filename: str, *, drive_id: str | None = None) -> str:
    base = _drive_base(drive_id)
    safe_name = quote(filename.replace("/", "_"), safe="")
    if _is_root_item(parent_id):
        return f"{base}/root:/{safe_name}:/createUploadSession"
    return f"{base}/items/{quote(str(parent_id), safe='')}:/{safe_name}:/createUploadSession"


def _to_backup_item(item: dict[str, Any]) -> dict[str, Any]:
    is_folder = isinstance(item.get("folder"), dict)
    file_info = item.get("file") if isinstance(item.get("file"), dict) else {}
    return {
        "id": item.get("id"),
        "name": item.get("name") or "",
        "mimeType": FOLDER_MIME if is_folder else file_info.get("mimeType"),
        "size": item.get("size"),
        "createdTime": item.get("createdDateTime"),
        "modifiedTime": item.get("lastModifiedDateTime"),
        "webUrl": item.get("webUrl"),
    }


class OneDriveClient:
    """Small Microsoft Graph client for folder/file operations needed by Backup."""

    def __init__(self, token_source: OneDriveTokenSource, *, timeout: float = 30.0):
        self.token_source = token_source
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "OneDriveClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout, follow_redirects=True)
        return self._client

    async def list_files(
        self,
        parent_id: str,
        *,
        drive_id: str | None = None,
        mime_type: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        client = await self._http()
        url = f"{_item_url(parent_id, drive_id=drive_id)}/children"
        params: dict[str, str] | None = {
            "$top": str(page_size),
            "$select": "id,name,folder,file,size,createdDateTime,lastModifiedDateTime,webUrl",
        }
        items: list[dict[str, Any]] = []

        while url:
            resp = await _onedrive_request(client, "GET", url, self.token_source, params=params)
            resp.raise_for_status()
            payload = resp.json()
            for raw in payload.get("value", []):
                if not isinstance(raw, dict) or not raw.get("id"):
                    continue
                item = _to_backup_item(raw)
                if mime_type and item.get("mimeType") != mime_type:
                    continue
                items.append(item)
            url = payload.get("@odata.nextLink")
            params = None

        return items

    async def find_folders(
        self,
        name: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> list[dict[str, str]]:
        items = await self.list_files(parent_id, drive_id=drive_id, mime_type=FOLDER_MIME)
        expected = str(name or "").strip()
        return [
            {
                "id": str(item["id"]),
                "name": str(item.get("name") or ""),
                "webUrl": str(item.get("webUrl") or ""),
            }
            for item in items
            if str(item.get("name") or "").strip() == expected
        ]

    async def find_folder(
        self,
        name: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> str | None:
        folders = await self.find_folders(name, parent_id, drive_id=drive_id)
        return folders[0]["id"] if folders else None

    async def create_folder(
        self,
        name: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> dict[str, str]:
        client = await self._http()
        resp = await _onedrive_request(
            client,
            "POST",
            f"{_item_url(parent_id, drive_id=drive_id)}/children",
            self.token_source,
            headers={"Content-Type": "application/json"},
            json={
                "name": name,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "rename",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "id": str(data["id"]),
            "name": str(data.get("name") or name),
            "webUrl": str(data.get("webUrl") or ""),
        }

    async def get_or_create_folder(
        self,
        name: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> str:
        existing = await self.find_folder(name, parent_id, drive_id=drive_id)
        if existing:
            return existing
        folder = await self.create_folder(name, parent_id, drive_id=drive_id)
        return folder["id"]

    async def archive_item(
        self,
        item_id: str,
        *,
        ignore_missing: bool = False,
        drive_id: str | None = None,
    ) -> bool:
        client = await self._http()
        resp = await _onedrive_request(
            client,
            "DELETE",
            _item_url(item_id, drive_id=drive_id),
            self.token_source,
        )
        if ignore_missing and resp.status_code == 404:
            return False
        resp.raise_for_status()
        return True

    async def recreate_folder(
        self,
        name: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> tuple[str, int]:
        existing = await self.find_folders(name, parent_id, drive_id=drive_id)
        archived = 0
        for folder in existing:
            if await self.archive_item(folder["id"], ignore_missing=True, drive_id=drive_id):
                archived += 1

        if existing:
            remaining = await self.find_folders(name, parent_id, drive_id=drive_id)
            if remaining:
                raise OneDriveApiError(
                    f"Cannot recreate '{name}': {len(remaining)} folder(s) still remain."
                )

        folder = await self.create_folder(name, parent_id, drive_id=drive_id)
        return folder["id"], archived

    async def upload_bytes(
        self,
        filename: str,
        content: bytes,
        mime_type: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> str:
        if len(content) <= ONEDRIVE_SIMPLE_UPLOAD_LIMIT:
            return await self._simple_upload(filename, content, mime_type, parent_id, drive_id=drive_id)
        return await self._upload_session(filename, content, mime_type, parent_id, drive_id=drive_id)

    async def _simple_upload(
        self,
        filename: str,
        content: bytes,
        mime_type: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> str:
        client = await self._http()
        resp = await _onedrive_request(
            client,
            "PUT",
            _upload_content_url(parent_id, filename, drive_id=drive_id),
            self.token_source,
            headers={"Content-Type": mime_type},
            content=content,
            timeout=120.0,
        )
        resp.raise_for_status()
        return str(resp.json()["id"])

    async def _upload_session(
        self,
        filename: str,
        content: bytes,
        mime_type: str,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> str:
        client = await self._http()
        session_resp = await _onedrive_request(
            client,
            "POST",
            _upload_session_url(parent_id, filename, drive_id=drive_id),
            self.token_source,
            headers={"Content-Type": "application/json"},
            json={"item": {"@microsoft.graph.conflictBehavior": "replace", "name": filename}},
        )
        session_resp.raise_for_status()
        upload_url = session_resp.json().get("uploadUrl")
        if not upload_url:
            raise OneDriveApiError("OneDrive upload session did not return uploadUrl")

        total = len(content)
        start = 0
        final_payload: dict[str, Any] | None = None
        while start < total:
            end = min(start + ONEDRIVE_UPLOAD_CHUNK_SIZE, total) - 1
            chunk = content[start : end + 1]
            resp = await client.put(
                upload_url,
                headers={
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {start}-{end}/{total}",
                    "Content-Type": mime_type,
                },
                content=chunk,
                timeout=120.0,
            )
            resp.raise_for_status()
            if resp.status_code in (200, 201):
                final_payload = resp.json()
            start = end + 1

        if not final_payload or not final_payload.get("id"):
            raise OneDriveApiError("OneDrive upload session completed without file metadata")
        return str(final_payload["id"])

    async def upload_tabular_bytes(
        self,
        filename: str,
        content: bytes,
        parent_id: str,
        *,
        drive_id: str | None = None,
    ) -> str:
        return await self.upload_bytes(filename, content, XLSX_MIME, parent_id, drive_id=drive_id)

    async def download_bytes(
        self,
        file_id: str,
        *,
        drive_id: str | None = None,
    ) -> bytes:
        client = await self._http()
        resp = await _onedrive_request(
            client,
            "GET",
            f"{_item_url(file_id, drive_id=drive_id)}/content",
            self.token_source,
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.content

