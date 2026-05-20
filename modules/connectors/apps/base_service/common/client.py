from __future__ import annotations

from typing import Any, Mapping

import httpx

from modules.connectors.apps.base_service.common.auth import ServiceCredentials
from modules.connectors.apps.base_service.common.constants import ENDPOINTS, SUCCESS_CODE


class ServiceApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {
        key: value
        for key, value in body.items()
        if value is not None and value != ""
    }


def build_prefixed_fields(
    fields: Mapping[str, Any] | None,
    prefix: str,
) -> dict[str, Any]:
    if not fields:
        return {}

    output: dict[str, Any] = {}
    for key, value in fields.items():
        if value is None or value == "":
            continue
        field_name = key if key.startswith(prefix) else f"{prefix}{key}"
        output[field_name] = value
    return output


def select_response(response: Mapping[str, Any], selector: str | None = None) -> Any:
    if not selector:
        return dict(response)

    current: Any = response
    for part in selector.split("."):
        if isinstance(current, Mapping) and part in current:
            current = current[part]
        else:
            raise ServiceApiError(
                f"Selector '{selector}' not found in response. Available keys: {', '.join(response.keys())}"
            )
    return current


class ServiceManagementClient:
    def __init__(self, credentials: ServiceCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "ServiceManagementClient":
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
        request_body = {
            "access_token_v2": self.credentials.access_token,
            **clean_body(body),
        }

        response = await client.request(
            method=method,
            url=f"{self.credentials.base_url}{endpoint}",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=request_body,
        )
        response.raise_for_status()

        payload = response.json()
        if not isinstance(payload, dict):
            raise ServiceApiError("Unexpected API response format")
        if payload.get("code") != SUCCESS_CODE:
            raise ServiceApiError(payload.get("message") or "Unknown API error")
        return payload

    async def request_paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        property_name: str = "data",
        start_page: int = 0,
    ) -> list[dict[str, Any]]:
        page = start_page
        output: list[dict[str, Any]] = []

        while True:
            payload = await self.request(endpoint, {**clean_body(body), "page": page})
            items = payload.get(property_name, [])
            if not isinstance(items, list) or not items:
                break
            output.extend(item for item in items if isinstance(item, dict))
            page += 1

        return output

    async def test_connection(self) -> dict[str, Any]:
        return await self.get_all_groups()

    async def get_all_services(self, selector: str | None = None) -> Any:
        response = await self.request(ENDPOINTS["get_all_services"])
        return select_response(response, selector)

    async def get_all_compounds(self, selector: str | None = None) -> Any:
        response = await self.request(ENDPOINTS["get_all_compounds"])
        return select_response(response, selector)

    async def get_all_groups(self, selector: str | None = None) -> Any:
        response = await self.request(ENDPOINTS["get_all_groups"])
        return select_response(response, selector)

    async def get_service_blocks(self, service_id: str, selector: str | None = None) -> Any:
        response = await self.request(
            ENDPOINTS["get_service_blocks"],
            {"service_id": service_id},
        )
        return select_response(response, selector)

    async def get_all_tickets(self, service_id: str, selector: str | None = None) -> Any:
        response = await self.request(
            ENDPOINTS["get_all_tickets"],
            {"service_id": service_id},
        )
        return select_response(response, selector)

    async def get_ticket_details(self, ticket_id: str, selector: str | None = None) -> Any:
        response = await self.request(
            ENDPOINTS["get_ticket_details"],
            {"id": ticket_id},
        )
        return select_response(response, selector)

    async def get_ticket_activity_logs(
        self,
        filters: Mapping[str, Any] | None = None,
        selector: str | None = None,
    ) -> Any:
        response = await self.request(ENDPOINTS["get_ticket_activity_logs"], filters)
        return select_response(response, selector)

    async def get_possible_transitions(
        self,
        ticket_id: str,
        username: str,
        selector: str | None = None,
    ) -> Any:
        response = await self.request(
            ENDPOINTS["get_possible_transitions"],
            {"ticket_id": ticket_id, "username": username},
        )
        return select_response(response, selector)

    async def create_ticket(
        self,
        *,
        username: str,
        service_id: str,
        block_id: str,
        name: str,
        assignees: str | None = None,
        followers: str | None = None,
        managers: str | None = None,
        root_content: str | None = None,
        custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "username": username,
            "service_id": service_id,
            "block_id": block_id,
            "name": name,
            "assignees": assignees,
            "followers": followers,
            "managers": managers,
            "root_content": root_content,
            **build_prefixed_fields(custom_fields, "service_"),
        }
        return await self.request(ENDPOINTS["create_ticket"], body)

    async def update_ticket(
        self,
        *,
        service_id: str,
        ticket_id: str,
        username: str,
        name: str,
        update_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "service_id": service_id,
            "ticket_id": ticket_id,
            "username": username,
            "name": name,
            **clean_body(update_fields),
        }
        return await self.request(ENDPOINTS["update_ticket"], body)

    async def update_ticket_custom_fields(
        self,
        *,
        service_id: str,
        ticket_id: str,
        username: str,
        custom_field_ids: str,
        custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "service_id": service_id,
            "ticket_id": ticket_id,
            "username": username,
            "custom_field_ids": custom_field_ids,
            **build_prefixed_fields(custom_fields, "service_"),
        }
        return await self.request(ENDPOINTS["update_ticket_custom_fields"], body)

    async def assign_ticket(
        self,
        *,
        ticket_id: str,
        username: str,
        assignees: str,
    ) -> dict[str, Any]:
        return await self.request(
            ENDPOINTS["assign_ticket"],
            {"ticket_id": ticket_id, "username": username, "assignees": assignees},
        )

    async def execute_ticket(
        self,
        *,
        ticket_id: str,
        username: str,
        additional_fields: Mapping[str, Any] | None = None,
        ticket_custom_fields: Mapping[str, Any] | None = None,
        block_custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "ticket_id": ticket_id,
            "username": username,
            **clean_body(additional_fields),
            **build_prefixed_fields(ticket_custom_fields, "service_"),
            **build_prefixed_fields(block_custom_fields, "custom_"),
        }
        return await self.request(ENDPOINTS["execute_ticket"], body)

    async def move_ticket_to_block(
        self,
        *,
        ticket_id: str,
        username: str,
        next_block_id: str,
        additional_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "ticket_id": ticket_id,
            "username": username,
            "next_block_id": next_block_id,
            **clean_body(additional_fields),
        }
        return await self.request(ENDPOINTS["move_ticket_to_block"], body)

    async def move_ticket_back(
        self,
        *,
        ticket_id: str,
        username: str,
        additional_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = {
            "ticket_id": ticket_id,
            "username": username,
            **clean_body(additional_fields),
        }
        return await self.request(ENDPOINTS["move_ticket_back"], body)