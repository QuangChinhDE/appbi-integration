from __future__ import annotations

from typing import Any, Iterable, Mapping

import httpx

from modules.connectors.apps.workflow.common.auth import WorkflowCredentials
from modules.connectors.apps.workflow.common.constants import ENDPOINTS, SUCCESS_CODES


class WorkflowApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {
        key: value
        for key, value in body.items()
        if value is not None and value != ""
    }


def _unwrap_singleton_list(value: Any) -> Any:
    current = value
    while isinstance(current, list) and len(current) == 1 and isinstance(current[0], (dict, list)):
        current = current[0]
    return current


def normalize_payload(payload: Any) -> Any:
    current = _unwrap_singleton_list(payload)
    if isinstance(current, Mapping):
        code = current.get("code")
        if code is not None and code not in SUCCESS_CODES:
            raise WorkflowApiError(str(current.get("message") or current.get("error") or f"Workflow API returned code {code}"))

        for key in ("data", "result"):
            if key in current and current[key] not in (None, ""):
                current = current[key]
                break

    return _unwrap_singleton_list(current)


def _coerce_list(value: Any) -> list[dict[str, Any]]:
    current = normalize_payload(value)
    if isinstance(current, Mapping):
        for key in ("items", "rows", "workflows", "jobs", "stages", "posts", "comments", "data", "list"):
            nested = current.get(key)
            if isinstance(nested, list):
                current = nested
                break
    if not isinstance(current, list):
        return []

    output: list[dict[str, Any]] = []
    for item in current:
        if isinstance(item, Mapping):
            output.append(dict(item))
    return output


def _coerce_mapping(value: Any) -> dict[str, Any]:
    current = normalize_payload(value)
    if isinstance(current, list) and current and isinstance(current[0], Mapping):
        return dict(current[0])
    if isinstance(current, Mapping):
        return dict(current)
    raise WorkflowApiError("Unexpected Workflow API response format")


def _extract_named_mapping(value: Any, *keys: str) -> dict[str, Any]:
    current = normalize_payload(value)
    if isinstance(current, Mapping):
        for key in keys:
            nested = current.get(key)
            if isinstance(nested, Mapping):
                return dict(nested)
    return _coerce_mapping(current)


def _extract_named_list(value: Any, *keys: str) -> list[dict[str, Any]]:
    current = normalize_payload(value)
    if isinstance(current, Mapping):
        for key in keys:
            nested = current.get(key)
            if isinstance(nested, list):
                return [dict(item) for item in nested if isinstance(item, Mapping)]
    return _coerce_list(current)


def _extract_cursor(payload: Any) -> str | None:
    current = normalize_payload(payload)
    if not isinstance(current, Mapping):
        return None
    for key in ("next_page_id", "nextPageId", "next", "cursor", "page_id"):
        value = current.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def _item_identifier(item: Mapping[str, Any], candidates: Iterable[str]) -> str | None:
    for key in candidates:
        value = item.get(key)
        if value not in (None, ""):
            return str(value)
    return None


class WorkflowManagementClient:
    def __init__(self, credentials: WorkflowCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "WorkflowManagementClient":
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
    ) -> Any:
        client = await self._http_client()
        request_body = {
            "access_token_v2": self.credentials.access_token,
            **clean_body(body),
        }

        last_error: Exception | None = None
        for base_url in self.credentials.base_urls:
            try:
                response = await client.request(
                    method=method,
                    url=f"{base_url}{endpoint}",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data=request_body,
                )
                response.raise_for_status()
                return normalize_payload(response.json())
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code == 404 and base_url != self.credentials.base_urls[-1]:
                    continue
                raise
            except Exception as exc:
                last_error = exc
                if base_url != self.credentials.base_urls[-1]:
                    continue
                raise

        if last_error is not None:
            raise last_error
        raise WorkflowApiError("Workflow API request failed without a response")

    async def request_cursor_paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        *,
        item_id_candidates: Iterable[str],
        max_pages: int = 200,
    ) -> list[dict[str, Any]]:
        page_id = 0
        previous_page_marker: str | None = None
        seen_ids: set[str] = set()
        output: list[dict[str, Any]] = []

        for _ in range(max_pages):
            request_body = dict(clean_body(body))
            request_body["page_id"] = page_id
            payload = await self.request(endpoint, request_body)
            items = _coerce_list(payload)
            if not items:
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

            next_cursor = _extract_cursor(payload)
            if new_items == 0:
                break

            if next_cursor:
                if next_cursor == previous_page_marker:
                    break
                previous_page_marker = next_cursor
                try:
                    page_id = int(next_cursor)
                except (TypeError, ValueError):
                    page_id += 1
                continue

            page_id += 1

        return output

    async def get_all_workflows(self) -> list[dict[str, Any]]:
        return await self.request_cursor_paginated(
            ENDPOINTS["get_all_workflows"],
            item_id_candidates=("workflow_id", "id"),
        )

    async def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        return _extract_named_mapping(await self.request(ENDPOINTS["get_workflow"], {"id": workflow_id}), "workflow")

    async def get_workflow_stages(self, workflow_id: str) -> list[dict[str, Any]]:
        return _extract_named_list(await self.request(ENDPOINTS["get_workflow_stages"], {"id": workflow_id}), "stages")

    async def get_workflow_jobs(
        self,
        workflow_id: str,
        filters: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return await self.request_cursor_paginated(
            ENDPOINTS["get_workflow_jobs"],
            {"id": workflow_id, **clean_body(filters)},
            item_id_candidates=("job_id", "id", "hid"),
        )

    async def get_job(self, job_id: str) -> dict[str, Any]:
        return _extract_named_mapping(await self.request(ENDPOINTS["get_job"], {"id": job_id}), "job")

    async def get_job_custom_table(self, job_id: str) -> Any:
        return await self.request(ENDPOINTS["get_job_custom_table"], {"id": job_id})

    async def get_job_posts(self, job_id: str, last_id: str | None = None) -> list[dict[str, Any]]:
        request_body = {"id": job_id}
        if last_id:
            request_body["last_id"] = last_id
        return _extract_named_list(await self.request(ENDPOINTS["get_job_posts"], request_body), "posts", "data")

    async def get_job_comments(
        self,
        post_id: str,
        *,
        method: str = "page",
        position: str = "",
    ) -> list[dict[str, Any]]:
        request_body = {"hid": post_id, "method": method}
        if position:
            request_body["position"] = position
        return _extract_named_list(await self.request(ENDPOINTS["get_job_comments"], request_body), "comments", "data")