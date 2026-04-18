"""
Google Sheets REST client using Sheets API v4 via httpx.
"""
from __future__ import annotations

from typing import Any, Callable, Awaitable, Optional, Union

import httpx

from modules.connectors.apps.gsheets.common.constants import (
    DRIVE_FILES_API,
    SHEETS_API,
    SPREADSHEET_MIME,
)


GoogleSheetsTokenSource = Union[str, Callable[[bool], Awaitable[str]]]


class GoogleSheetsApiError(RuntimeError):
    pass


async def _resolve_token(source: GoogleSheetsTokenSource, force_refresh: bool = False) -> str:
    if callable(source):
        return await source(force_refresh)
    return source


async def _sheets_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    token_source: GoogleSheetsTokenSource,
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


class GoogleSheetsClient:
    """High-level Google Sheets operations using REST v4 API."""

    def __init__(self, token_source: GoogleSheetsTokenSource, *, timeout: float = 30.0):
        self.token_source = token_source
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "GoogleSheetsClient":
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

    # ── Spreadsheets (via Drive API for listing) ──────────────────────────

    async def list_spreadsheets(self, *, page_size: int = 100) -> list[dict[str, Any]]:
        """List spreadsheets accessible to the authenticated user."""
        client = await self._http()
        files: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, str] = {
                "q": f"mimeType='{SPREADSHEET_MIME}' and trashed=false",
                "fields": "files(id,name,modifiedTime,createdTime),nextPageToken",
                "pageSize": str(page_size),
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
                "corpora": "allDrives",
            }
            if page_token:
                params["pageToken"] = page_token
            resp = await _sheets_request(client, "GET", DRIVE_FILES_API, self.token_source, params=params)
            resp.raise_for_status()
            data = resp.json()
            for f in data.get("files", []):
                files.append({
                    "spreadsheet_id": f["id"],
                    "name": f.get("name", ""),
                    "modified_time": f.get("modifiedTime"),
                    "created_time": f.get("createdTime"),
                })
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return files

    async def get_spreadsheet(self, spreadsheet_id: str) -> dict[str, Any]:
        """Get spreadsheet metadata including sheet tabs."""
        client = await self._http()
        resp = await _sheets_request(
            client, "GET", f"{SHEETS_API}/{spreadsheet_id}", self.token_source,
            params={"fields": "spreadsheetId,properties,sheets.properties"},
        )
        resp.raise_for_status()
        data = resp.json()
        sheets = []
        for s in data.get("sheets", []):
            props = s.get("properties", {})
            sheets.append({
                "sheet_id": props.get("sheetId"),
                "title": props.get("title", ""),
                "index": props.get("index", 0),
                "row_count": props.get("gridProperties", {}).get("rowCount", 0),
                "column_count": props.get("gridProperties", {}).get("columnCount", 0),
            })
        return {
            "spreadsheet_id": data.get("spreadsheetId"),
            "title": data.get("properties", {}).get("title", ""),
            "sheets": sheets,
        }

    # ── Sheet tabs ────────────────────────────────────────────────────────

    async def get_sheet_values(
        self,
        spreadsheet_id: str,
        range_notation: str = "Sheet1",
        *,
        value_render: str = "FORMATTED_VALUE",
    ) -> list[list[Any]]:
        """Read cell values from a sheet range."""
        client = await self._http()
        resp = await _sheets_request(
            client, "GET",
            f"{SHEETS_API}/{spreadsheet_id}/values/{range_notation}",
            self.token_source,
            params={"valueRenderOption": value_render},
        )
        resp.raise_for_status()
        return resp.json().get("values", [])

    async def append_rows(
        self,
        spreadsheet_id: str,
        range_notation: str,
        rows: list[list[Any]],
        *,
        value_input: str = "USER_ENTERED",
    ) -> dict[str, Any]:
        """Append rows to a sheet."""
        client = await self._http()
        resp = await _sheets_request(
            client, "POST",
            f"{SHEETS_API}/{spreadsheet_id}/values/{range_notation}:append",
            self.token_source,
            headers={"Content-Type": "application/json"},
            params={
                "valueInputOption": value_input,
                "insertDataOption": "INSERT_ROWS",
            },
            json={"values": rows},
        )
        resp.raise_for_status()
        return resp.json()

    async def update_values(
        self,
        spreadsheet_id: str,
        range_notation: str,
        rows: list[list[Any]],
        *,
        value_input: str = "USER_ENTERED",
    ) -> dict[str, Any]:
        """Update (overwrite) cell values in a range."""
        client = await self._http()
        resp = await _sheets_request(
            client, "PUT",
            f"{SHEETS_API}/{spreadsheet_id}/values/{range_notation}",
            self.token_source,
            headers={"Content-Type": "application/json"},
            params={"valueInputOption": value_input},
            json={"values": rows},
        )
        resp.raise_for_status()
        return resp.json()

    async def clear_sheet(self, spreadsheet_id: str, range_notation: str) -> dict[str, Any]:
        """Clear all values in a range."""
        client = await self._http()
        resp = await _sheets_request(
            client, "POST",
            f"{SHEETS_API}/{spreadsheet_id}/values/{range_notation}:clear",
            self.token_source,
            headers={"Content-Type": "application/json"},
            json={},
        )
        resp.raise_for_status()
        return resp.json()

    async def create_spreadsheet(self, title: str, sheet_titles: list[str] | None = None) -> dict[str, Any]:
        """Create a new spreadsheet."""
        sheets = []
        for i, name in enumerate(sheet_titles or ["Sheet1"]):
            sheets.append({"properties": {"title": name, "index": i}})

        client = await self._http()
        resp = await _sheets_request(
            client, "POST", SHEETS_API, self.token_source,
            headers={"Content-Type": "application/json"},
            json={"properties": {"title": title}, "sheets": sheets},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "spreadsheet_id": data.get("spreadsheetId"),
            "title": data.get("properties", {}).get("title", ""),
            "url": data.get("spreadsheetUrl", ""),
        }

    async def create_sheet_tab(self, spreadsheet_id: str, title: str) -> dict[str, Any]:
        """Add a new sheet tab to an existing spreadsheet."""
        client = await self._http()
        resp = await _sheets_request(
            client, "POST",
            f"{SHEETS_API}/{spreadsheet_id}:batchUpdate",
            self.token_source,
            headers={"Content-Type": "application/json"},
            json={
                "requests": [{"addSheet": {"properties": {"title": title}}}],
            },
        )
        resp.raise_for_status()
        replies = resp.json().get("replies", [])
        if replies:
            props = replies[0].get("addSheet", {}).get("properties", {})
            return {"sheet_id": props.get("sheetId"), "title": props.get("title", title)}
        return {"title": title}
