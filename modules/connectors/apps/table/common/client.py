from __future__ import annotations

from typing import Any, Mapping

import httpx

from modules.connectors.apps.table.common.auth import TableCredentials
from modules.connectors.apps.table.common.constants import ENDPOINTS, SUCCESS_CODES


class TableApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {k: v for k, v in body.items() if v is not None and v != ""}


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise TableApiError("Unexpected Table API response format")


class TableManagementClient:
    def __init__(self, credentials: TableCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "TableManagementClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _http_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def request(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        client = await self._http_client()
        response = await client.request(
            method="POST",
            url=f"{self.credentials.base_url}{endpoint}",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"access_token_v2": self.credentials.access_token, **clean_body(body)},
        )
        response.raise_for_status()
        payload = _coerce_mapping(response.json())
        code = payload.get("code")
        if code not in SUCCESS_CODES:
            raise TableApiError(str(payload.get("message") or payload.get("error") or f"Table API returned code {code}"))
        return payload

    async def get_records(self, table_id: str, **kwargs: Any) -> list[dict[str, Any]]:
        """Get records from a table with optional pagination and filters."""
        all_records: list[dict[str, Any]] = []
        page_id = kwargs.pop("page_id", None)
        limit = kwargs.pop("limit", 500)

        for _ in range(200):
            body: dict[str, Any] = {"table_id": table_id, "limit": limit, **clean_body(kwargs)}
            if page_id:
                body["page_id"] = page_id
            payload = await self.request(ENDPOINTS["table_records"], body)
            data = payload.get("data")
            if isinstance(data, list):
                items = [dict(item) for item in data if isinstance(item, Mapping)]
            else:
                items = []
            if not items:
                break
            all_records.extend(items)
            page_id = payload.get("page_id") or payload.get("next_page_id")
            if not page_id:
                break

        return all_records

    async def create_record(self, table_id: str, username: str, name: str, **fields: Any) -> dict[str, Any]:
        body = {"table_id": table_id, "username": username, "_name": name, **fields}
        return await self.request(ENDPOINTS["record_create"], body)

    async def edit_record(self, record_id: str, table_id: str, username: str, **fields: Any) -> dict[str, Any]:
        body = {"id": record_id, "table_id": table_id, "username": username, **fields}
        return await self.request(ENDPOINTS["record_edit"], body)
