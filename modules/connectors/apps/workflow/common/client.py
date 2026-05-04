from __future__ import annotations

import asyncio
from typing import Any, Iterable, Mapping

import httpx

from modules.connectors.apps.workflow.common.auth import WorkflowCredentials
from modules.connectors.apps.workflow.common.constants import ENDPOINTS, SUCCESS_CODES


class WorkflowApiError(RuntimeError):
    pass


_WORKFLOW_JOBS_TIMEOUT = 240.0
_WORKFLOW_JOBS_TIMEOUT_FALLBACK_LIMIT = 100
_WORKFLOW_JOBS_PAGE_FETCH_CONCURRENCY = 4


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


def _extract_pagination_marker(payload: Any, *keys: str) -> str | None:
    current = normalize_payload(payload)
    containers: list[Mapping[str, Any]] = []
    if isinstance(current, Mapping):
        containers.append(current)
        for key in ("data", "result", "paging", "pagination"):
            nested = current.get(key)
            if isinstance(nested, Mapping):
                containers.append(nested)

    for container in containers:
        for key in keys:
            value = container.get(key)
            if value not in (None, ""):
                return str(value)
    return None


def _extract_int(payload: Any, *keys: str) -> int | None:
    current = normalize_payload(payload)
    containers: list[Mapping[str, Any]] = []
    if isinstance(current, Mapping):
        containers.append(current)
        for key in ("data", "result", "paging", "pagination"):
            nested = current.get(key)
            if isinstance(nested, Mapping):
                containers.append(nested)

    for container in containers:
        for key in keys:
            value = container.get(key)
            if value in (None, ""):
                continue
            try:
                return int(str(value).strip())
            except (TypeError, ValueError):
                continue
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
        *,
        timeout: float | None = None,
        base_urls: Iterable[str] | None = None,
    ) -> Any:
        client = await self._http_client()
        request_body = {
            "access_token_v2": self.credentials.access_token,
            **clean_body(body),
        }
        request_timeout = timeout if timeout is not None else self.timeout
        candidate_base_urls = [str(item) for item in (base_urls or self.credentials.base_urls)]
        if not candidate_base_urls:
            raise WorkflowApiError("Workflow API request has no candidate base URLs")

        last_error: Exception | None = None
        for base_url in candidate_base_urls:
            try:
                response = await client.request(
                    method=method,
                    url=f"{base_url}{endpoint}",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data=request_body,
                    timeout=request_timeout,
                )
                response.raise_for_status()
                return normalize_payload(response.json())
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if base_url != candidate_base_urls[-1]:
                    continue
                raise
            except Exception as exc:
                last_error = exc
                if base_url != candidate_base_urls[-1]:
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
        timeout: float | None = None,
        base_urls: Iterable[str] | None = None,
    ) -> list[dict[str, Any]]:
        page_id = 0
        previous_page_marker: str | None = None
        seen_ids: set[str] = set()
        output: list[dict[str, Any]] = []

        for _ in range(max_pages):
            request_body = dict(clean_body(body))
            request_body["page_id"] = page_id
            payload = await self.request(endpoint, request_body, timeout=timeout, base_urls=base_urls)
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
        request_filters = dict(clean_body(filters))
        requested_limit = int(request_filters.get("limit") or 500)
        request_filters["limit"] = requested_limit
        primary_base_urls = self.credentials.base_urls[:1]

        async def fetch_page(
            page_id: int,
            limit: int,
            *,
            base_urls: Iterable[str] | None,
        ) -> tuple[int, Any, list[dict[str, Any]]]:
            request_body = {"id": workflow_id, **request_filters, "limit": limit, "page_id": page_id}
            payload = await self.request(
                ENDPOINTS["get_workflow_jobs"],
                request_body,
                timeout=_WORKFLOW_JOBS_TIMEOUT,
                base_urls=base_urls,
            )
            return page_id, payload, _coerce_list(payload)

        async def fetch_jobs(limit: int, *, base_urls: Iterable[str] | None) -> list[dict[str, Any]]:
            _, first_payload, first_items = await fetch_page(0, limit, base_urls=base_urls)
            if not first_items:
                return []

            total_items = _extract_int(first_payload, "total_items", "total_items_count", "total")
            page_size = _extract_int(first_payload, "items_per_page", "limit", "per_page") or limit or len(first_items)
            if not total_items or page_size <= 0 or total_items <= len(first_items):
                return first_items

            total_pages = (total_items + page_size - 1) // page_size
            if total_pages <= 1:
                return first_items

            seen_ids: set[str] = set()
            output: list[dict[str, Any]] = []

            def append_items(items: list[dict[str, Any]]) -> None:
                for item in items:
                    item_id = _item_identifier(item, ("job_id", "id", "hid"))
                    if item_id and item_id in seen_ids:
                        continue
                    if item_id:
                        seen_ids.add(item_id)
                    output.append(item)

            append_items(first_items)

            semaphore = asyncio.Semaphore(_WORKFLOW_JOBS_PAGE_FETCH_CONCURRENCY)

            async def fetch_remaining(page_id: int) -> tuple[int, list[dict[str, Any]]]:
                async with semaphore:
                    _, _, items = await fetch_page(page_id, page_size, base_urls=base_urls)
                    return page_id, items

            remaining_pages = await asyncio.gather(*(
                fetch_remaining(page_id)
                for page_id in range(1, total_pages)
            ))
            for _, items in sorted(remaining_pages, key=lambda item: item[0]):
                append_items(items)

            return output

        try:
            return await fetch_jobs(requested_limit, base_urls=primary_base_urls)
        except httpx.ReadTimeout:
            if requested_limit <= _WORKFLOW_JOBS_TIMEOUT_FALLBACK_LIMIT:
                raise
        except Exception:
            return await fetch_jobs(requested_limit, base_urls=self.credentials.base_urls)

        fallback_limit = min(requested_limit, _WORKFLOW_JOBS_TIMEOUT_FALLBACK_LIMIT)
        try:
            return await fetch_jobs(fallback_limit, base_urls=primary_base_urls)
        except httpx.ReadTimeout:
            raise
        except Exception:
            return await fetch_jobs(fallback_limit, base_urls=self.credentials.base_urls)

    async def get_job(self, job_id: str) -> dict[str, Any]:
        return _extract_named_mapping(await self.request(ENDPOINTS["get_job"], {"id": job_id}), "job")

    async def get_job_custom_table(self, job_id: str) -> Any:
        return await self.request(ENDPOINTS["get_job_custom_table"], {"id": job_id})

    async def get_job_posts(
        self,
        job_id: str,
        last_id: str | None = None,
        *,
        paginate: bool = True,
        max_pages: int = 200,
    ) -> list[dict[str, Any]]:
        if not paginate:
            request_body = {"id": job_id}
            if last_id:
                request_body["last_id"] = last_id
            return _extract_named_list(await self.request(ENDPOINTS["get_job_posts"], request_body), "posts", "data")

        current_last_id = str(last_id or '').strip() or None
        seen_page_markers: set[str] = set()
        seen_post_ids: set[str] = set()
        output: list[dict[str, Any]] = []

        for _ in range(max_pages):
            request_body = {"id": job_id}
            if current_last_id:
                request_body["last_id"] = current_last_id

            payload = await self.request(ENDPOINTS["get_job_posts"], request_body)
            page_items = _extract_named_list(payload, "posts", "data")
            if not page_items:
                break

            new_items = 0
            for item in page_items:
                post_id = _item_identifier(item, ("hid", "id", "post_id"))
                if post_id and post_id in seen_post_ids:
                    continue
                if post_id:
                    seen_post_ids.add(post_id)
                output.append(item)
                new_items += 1

            next_last_id = _item_identifier(page_items[-1], ("hid", "id", "post_id"))
            if not next_last_id or next_last_id == current_last_id or next_last_id in seen_page_markers or new_items == 0:
                break

            seen_page_markers.add(next_last_id)
            current_last_id = next_last_id

        return output

    async def get_job_comments(
        self,
        post_id: str,
        *,
        method: str = "page",
        position: str = "",
        paginate: bool = True,
        max_pages: int = 200,
    ) -> list[dict[str, Any]]:
        if not paginate:
            request_body = {"hid": post_id, "method": method}
            if position:
                request_body["position"] = position
            return _extract_named_list(await self.request(ENDPOINTS["get_job_comments"], request_body), "comments", "data")

        current_position = str(position or '').strip()
        seen_positions: set[str] = set()
        seen_comment_ids: set[str] = set()
        output: list[dict[str, Any]] = []

        for _ in range(max_pages):
            request_body = {"hid": post_id, "method": method}
            if current_position:
                request_body["position"] = current_position

            payload = await self.request(ENDPOINTS["get_job_comments"], request_body)
            page_items = _extract_named_list(payload, "comments", "data")
            if not page_items:
                break

            new_items = 0
            for item in page_items:
                comment_id = _item_identifier(item, ("hid", "id", "comment_id"))
                if comment_id and comment_id in seen_comment_ids:
                    continue
                if comment_id:
                    seen_comment_ids.add(comment_id)
                output.append(item)
                new_items += 1

            next_position = _extract_pagination_marker(payload, "position", "next_position", "next", "cursor")
            if not next_position or next_position == current_position or next_position in seen_positions or new_items == 0:
                break

            seen_positions.add(next_position)
            current_position = next_position

        return output

    async def create_job(
        self,
        *,
        creator_username: str,
        workflow_id: str,
        name: str,
        assignees: str | None = None,
        followers: str | None = None,
        managers: str | None = None,
        description: str | None = None,
        deadline: str | None = None,
        custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "creator_username": creator_username,
            "workflow_id": workflow_id,
            "name": name,
            "assignees": assignees,
            "followers": followers,
            "managers": managers,
            "description": description,
            "deadline": deadline,
            **clean_body(custom_fields),
        }
        return await self.request(ENDPOINTS["create_job"], body)