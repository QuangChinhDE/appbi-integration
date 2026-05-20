from __future__ import annotations

from typing import Any, Mapping

import httpx

from modules.connectors.apps.base_meeting.common.auth import MeetingCredentials
from modules.connectors.apps.base_meeting.common.constants import ENDPOINTS, SUCCESS_CODES


class MeetingApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {k: v for k, v in body.items() if v is not None and v != ""}


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise MeetingApiError("Unexpected Meeting API response format")


def _extract_list(payload: Mapping[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [dict(item) for item in value if isinstance(item, Mapping)]
    return []


class MeetingManagementClient:
    """Meeting uses access_token (NOT access_token_v2) and page-based pagination."""

    def __init__(self, credentials: MeetingCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "MeetingManagementClient":
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
            data={"access_token": self.credentials.access_token, **clean_body(body)},
        )
        response.raise_for_status()
        payload = _coerce_mapping(response.json())
        code = payload.get("code")
        if code not in SUCCESS_CODES:
            raise MeetingApiError(str(payload.get("message") or payload.get("error") or f"Meeting API returned code {code}"))
        return payload

    async def _paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        *,
        list_keys: tuple[str, ...] = ("data",),
        ipp: int = 50,
        max_pages: int = 200,
    ) -> list[dict[str, Any]]:
        page = 0
        output: list[dict[str, Any]] = []
        for _ in range(max_pages):
            payload = await self.request(endpoint, {**clean_body(body), "page": page, "ipp": ipp})
            items = _extract_list(payload, *list_keys)
            if not items:
                break
            output.extend(items)
            if len(items) < ipp:
                break
            page += 1
        return output

    async def get_groups(self) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["group_list"], list_keys=("data", "groups"))

    async def get_meetings(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["meeting_list"], kwargs or None, list_keys=("data", "meetings"))

    async def get_repeated_meetings(self) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["repeated_meeting_list"], list_keys=("data", "meetings"))
