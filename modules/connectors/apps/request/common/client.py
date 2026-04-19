from __future__ import annotations

from typing import Any, Iterable, Mapping

import httpx

from modules.connectors.apps.request.common.auth import RequestCredentials
from modules.connectors.apps.request.common.constants import ENDPOINTS, SUCCESS_CODES


class RequestApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {
        key: value
        for key, value in body.items()
        if value is not None and value != ""
    }


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise RequestApiError("Unexpected Request API response format")


def _extract_named_list(payload: Mapping[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [dict(item) for item in value if isinstance(item, Mapping)]
    return []


def _item_identifier(item: Mapping[str, Any], candidates: Iterable[str]) -> str | None:
    for key in candidates:
        value = item.get(key)
        if value not in (None, ""):
            return str(value)
    return None


class RequestManagementClient:
    def __init__(self, credentials: RequestCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "RequestManagementClient":
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
        method: str = "POST",
    ) -> dict[str, Any]:
        client = await self._http_client()
        response = await client.request(
            method=method,
            url=f"{self.credentials.base_url}{endpoint}",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "access_token_v2": self.credentials.access_token,
                **clean_body(body),
            },
        )
        response.raise_for_status()
        payload = _coerce_mapping(response.json())

        code = payload.get("code")
        if code not in SUCCESS_CODES:
            raise RequestApiError(str(payload.get("message") or payload.get("error") or f"Request API returned code {code}"))

        return payload

    async def request_page_paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        *,
        list_keys: tuple[str, ...],
        item_id_candidates: Iterable[str],
        page_start: int = 0,
        fallback_page_start: int | None = None,
        max_pages: int = 200,
    ) -> list[dict[str, Any]]:
        page = page_start
        seen_ids: set[str] = set()
        output: list[dict[str, Any]] = []
        attempted_fallback = False

        for _ in range(max_pages):
            payload = await self.request(endpoint, {**clean_body(body), "page": page})
            items = _extract_named_list(payload, *list_keys)
            if not items:
                if not output and fallback_page_start is not None and not attempted_fallback and fallback_page_start != page_start:
                    attempted_fallback = True
                    page = fallback_page_start
                    continue
                break

            new_items = 0
            for item in items:
                item_id = _item_identifier(item, item_id_candidates)
                if item_id and item_id in seen_ids:
                    continue
                if item_id:
                    seen_ids.add(item_id)
                output.append(item)
                new_items += 1

            if new_items == 0:
                break
            page += 1

        return output

    async def get_all_groups(self) -> list[dict[str, Any]]:
        return await self.request_page_paginated(
            ENDPOINTS["get_all_groups"],
            list_keys=("groups", "data"),
            item_id_candidates=("id", "group_id"),
            page_start=0,
            fallback_page_start=1,
        )

    async def get_group(self, group_id: str) -> dict[str, Any]:
        return await self.request(ENDPOINTS["get_group"], {"id": group_id})

    async def get_requests(
        self,
        *,
        group_id: str,
        limit: int = 50,
        filters: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return await self.request_page_paginated(
            ENDPOINTS["get_requests"],
            {"group": group_id, "limit": limit, **clean_body(filters)},
            list_keys=("requests", "data"),
            item_id_candidates=("id",),
            page_start=0,
        )

    async def get_request(self, request_id: str) -> dict[str, Any]:
        return await self.request(ENDPOINTS["get_request"], {"id": request_id})

    async def get_request_with_custom_table(self, request_id: str) -> dict[str, Any]:
        return await self.request(ENDPOINTS["get_request_with_custom_table"], {"id": request_id})

    async def get_request_posts(self, request_id: str) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        last_id = ""

        for _ in range(200):
            payload = await self.request(ENDPOINTS["get_posts"], {"id": request_id, "lastId": last_id, "last_id": last_id})
            posts = _extract_named_list(payload, "posts", "data")
            if not posts:
                break

            new_items = 0
            for post in posts:
                post_id = _item_identifier(post, ("id", "hid"))
                if post_id and post_id in seen_ids:
                    continue
                if post_id:
                    seen_ids.add(post_id)
                output.append(post)
                new_items += 1

            if new_items == 0:
                break
            last_id = str(posts[-1].get("id") or "")
            if not last_id:
                break

        return output

    async def get_request_comments(
        self,
        post_hid: str,
        *,
        method: str = "prev",
        position: str = "0",
    ) -> list[dict[str, Any]]:
        payload = await self.request(
            ENDPOINTS["get_comments"],
            {"hid": post_hid, "method": method, "position": position},
        )
        return _extract_named_list(payload, "comments", "data")

    async def create_request(
        self,
        *,
        username: str,
        group_id: str,
        name: str,
        description: str | None = None,
        followers: str | None = None,
        assignees: str | None = None,
        custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "username": username,
            "group_id": group_id,
            "name": name,
            "description": description,
            "followers": followers,
            "assignees": assignees,
            **clean_body(custom_fields),
        }
        return await self.request(ENDPOINTS["create_request"], body)