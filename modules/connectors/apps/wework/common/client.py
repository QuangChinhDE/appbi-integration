from __future__ import annotations

from typing import Any, Iterable, Mapping

import httpx

from modules.connectors.apps.wework.common.auth import WeworkCredentials
from modules.connectors.apps.wework.common.constants import ENDPOINTS, SUCCESS_CODES


class WeworkApiError(RuntimeError):
    pass


CONTENT_KEYS = {
    "project",
    "projects",
    "task",
    "tasks",
    "subtasks",
    "tasklists",
    "tasklist",
    "dept",
    "depts",
    "department",
    "departments",
    "milestones",
}


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


def _flatten_mapping_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    output: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, Mapping):
            output.append(dict(item))
            continue
        if isinstance(item, list):
            output.extend(_flatten_mapping_list(item))
    return output


def _item_identifier(item: Mapping[str, Any], candidates: Iterable[str]) -> str | None:
    for key in candidates:
        value = item.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def normalize_payload(payload: Any) -> Any:
    current = _unwrap_singleton_list(payload)
    if isinstance(current, Mapping):
        code = current.get("code")
        if code is not None and code not in SUCCESS_CODES:
            raise WeworkApiError(str(current.get("message") or current.get("error") or f"Wework API returned code {code}"))

        if not any(key in current for key in CONTENT_KEYS):
            for key in ("data", "result"):
                nested = current.get(key)
                if nested not in (None, ""):
                    current = _unwrap_singleton_list(nested)
                    break

    return _unwrap_singleton_list(current)


def _coerce_mapping(value: Any) -> dict[str, Any]:
    current = normalize_payload(value)
    if isinstance(current, list) and current and isinstance(current[0], Mapping):
        return dict(current[0])
    if isinstance(current, Mapping):
        return dict(current)
    raise WeworkApiError("Unexpected Wework API response format")


def _extract_named_list(value: Any, *keys: str) -> list[dict[str, Any]]:
    current = normalize_payload(value)
    if isinstance(current, Mapping):
        for key in keys:
            nested = current.get(key)
            flattened = _flatten_mapping_list(nested)
            if flattened:
                return flattened
    return _flatten_mapping_list(current)


def _extract_named_mapping(value: Any, *keys: str) -> dict[str, Any]:
    current = normalize_payload(value)
    if isinstance(current, Mapping):
        for key in keys:
            nested = current.get(key)
            if isinstance(nested, Mapping):
                return dict(nested)
    return _coerce_mapping(current)


def merge_task_collections(*collections: Any) -> list[dict[str, Any]]:
    seen_ids: set[str] = set()
    output: list[dict[str, Any]] = []

    for collection in collections:
        for item in _flatten_mapping_list(collection if isinstance(collection, list) else [collection] if isinstance(collection, Mapping) else collection):
            item_id = _item_identifier(item, ("id", "task_id", "hid"))
            if item_id and item_id in seen_ids:
                continue
            if item_id:
                seen_ids.add(item_id)
            output.append(item)

    return output


class WeworkManagementClient:
    def __init__(self, credentials: WeworkCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "WeworkManagementClient":
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
        return normalize_payload(response.json())

    async def request_page_paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        *,
        list_keys: tuple[str, ...],
        item_id_candidates: Iterable[str],
        page_start: int = 0,
        max_pages: int = 200,
    ) -> list[dict[str, Any]]:
        page = page_start
        seen_ids: set[str] = set()
        output: list[dict[str, Any]] = []

        for _ in range(max_pages):
            payload = await self.request(endpoint, {**clean_body(body), "page": page})
            items = _extract_named_list(payload, *list_keys)
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

            if new_items == 0:
                break
            page += 1

        return output

    async def get_all_departments(self) -> list[dict[str, Any]]:
        return _extract_named_list(await self.request(ENDPOINTS["get_all_departments"]), "depts", "departments", "data")

    async def get_department(self, department_id: str) -> dict[str, Any]:
        return _extract_named_mapping(await self.request(ENDPOINTS["get_department"], {"id": department_id}), "dept", "department", "data")

    async def get_all_projects(self) -> list[dict[str, Any]]:
        return _extract_named_list(await self.request(ENDPOINTS["get_all_projects"]), "projects", "data")

    async def get_project_full(self, project_id: str) -> dict[str, Any]:
        return _coerce_mapping(await self.request(ENDPOINTS["get_project_full"], {"id": project_id}))

    async def get_project_snapshot(self, project_id: str) -> dict[str, Any]:
        payload = await self.get_project_full(project_id)
        return {
            "project": _extract_named_mapping(payload, "project"),
            "tasklists": _extract_named_list(payload, "tasklists"),
            "tasks": _extract_named_list(payload, "tasks"),
            "subtasks": _extract_named_list(payload, "subtasks"),
            "milestones": _extract_named_list(payload, "milestones"),
            "raw": payload,
        }

    async def get_task(self, task_id: str) -> dict[str, Any]:
        return _extract_named_mapping(await self.request(ENDPOINTS["get_task"], {"id": task_id}), "task", "data")

    async def get_project_tasks(
        self,
        project_id: str,
        *,
        username: str,
        filters: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return await self.request_page_paginated(
            ENDPOINTS["get_project_tasks"],
            {"id": project_id, "username": username, **clean_body(filters)},
            list_keys=("tasks", "data"),
            item_id_candidates=("id", "task_id", "hid"),
        )

    async def get_tasklist(self, tasklist_id: str) -> dict[str, Any]:
        return _extract_named_mapping(await self.request(ENDPOINTS["get_tasklist"], {"id": tasklist_id}), "tasklist", "data")

    async def create_department(
        self,
        *,
        username: str,
        name: str,
        description: str | None = None,
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        body = {
            "username": username,
            "name": name,
            "description": description,
            "parent_id": parent_id,
        }
        return await self.request(ENDPOINTS["create_department"], body)

    async def create_project(
        self,
        *,
        username: str,
        metatype: str,
        name: str,
        external: str,
        description: str | None = None,
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        body = {
            "username": username,
            "metatype": metatype,
            "name": name,
            "external": external,
            "description": description,
            "parent_id": parent_id,
        }
        return await self.request(ENDPOINTS["create_project"], body)

    async def create_task(
        self,
        *,
        username: str,
        project_id: str,
        name: str,
        assignee: str | None = None,
        description: str | None = None,
        deadline: str | None = None,
        tasklist_id: str | None = None,
    ) -> dict[str, Any]:
        # Note: WeWork task/create uses `id` as the project id.
        body = {
            "username": username,
            "id": project_id,
            "name": name,
            "assignee": assignee,
            "description": description,
            "deadline": deadline,
            "tasklist_id": tasklist_id,
        }
        return await self.request(ENDPOINTS["create_task"], body)

    async def create_subtask(
        self,
        *,
        username: str,
        parent_id: str,
        name: str,
        assignee: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        body = {
            "username": username,
            "parent_id": parent_id,
            "name": name,
            "assignee": assignee,
            "description": description,
        }
        return await self.request(ENDPOINTS["create_subtask"], body)