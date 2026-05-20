from __future__ import annotations

from typing import Any, Iterable, Mapping

import httpx

from modules.connectors.apps.base_crm.common.auth import CrmCredentials
from modules.connectors.apps.base_crm.common.constants import (
    DEAL_ENDPOINTS,
    LEAD_ENDPOINTS,
    SUCCESS_CODES,
)


class CrmApiError(RuntimeError):
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
    raise CrmApiError("Unexpected CRM API response format")


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


class CrmManagementClient:
    def __init__(self, credentials: CrmCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "CrmManagementClient":
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

    async def _request(
        self,
        base_url: str,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        client = await self._http_client()
        response = await client.request(
            method="POST",
            url=f"{base_url}{endpoint}",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "access_token": self.credentials.access_token,
                "password": self.credentials.password,
                **clean_body(body),
            },
        )
        response.raise_for_status()
        payload = _coerce_mapping(response.json())

        error_code = payload.get("error_code")
        if error_code not in SUCCESS_CODES:
            raise CrmApiError(str(payload.get("message") or payload.get("error") or f"CRM API returned error_code {error_code}"))

        return payload

    async def lead_request(self, endpoint: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return await self._request(self.credentials.lead_base_url, endpoint, body)

    async def deal_request(self, endpoint: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return await self._request(self.credentials.deal_base_url, endpoint, body)

    async def _deal_paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        *,
        list_keys: tuple[str, ...],
        item_id_candidates: Iterable[str] = ("id",),
        max_pages: int = 200,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        page = 1
        seen_ids: set[str] = set()
        output: list[dict[str, Any]] = []

        for _ in range(max_pages):
            payload = await self.deal_request(endpoint, {**clean_body(body), "page": page, "limit": limit})
            data = payload.get("response", payload)
            if isinstance(data, Mapping):
                items = _extract_named_list(data, *list_keys)
            else:
                items = []
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

    # ── Lead ──────────────────────────────────────────────────────────────

    async def get_lead_services(self) -> list[dict[str, Any]]:
        payload = await self.lead_request(LEAD_ENDPOINTS["lead_services"])
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "services") if isinstance(data, Mapping) else []

    async def get_leads(self, service_id: str, *, page: int = 1) -> list[dict[str, Any]]:
        payload = await self.lead_request(LEAD_ENDPOINTS["lead_list"], {"service_id": service_id, "page": page})
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "leads") if isinstance(data, Mapping) else []

    async def get_lead(self, lead_id: str) -> dict[str, Any]:
        payload = await self.lead_request(LEAD_ENDPOINTS["lead_get"], {"lead_id": lead_id})
        data = payload.get("response", payload)
        return data.get("data", data) if isinstance(data, Mapping) else data

    async def get_lead_feeds(self, lead_id: str) -> list[dict[str, Any]]:
        payload = await self.lead_request(LEAD_ENDPOINTS["lead_feed_list"], {"lead_id": lead_id})
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "feeds") if isinstance(data, Mapping) else []

    # ── Pipeline ──────────────────────────────────────────────────────────

    async def get_all_pipelines(self) -> list[dict[str, Any]]:
        payload = await self.deal_request(DEAL_ENDPOINTS["pipeline_all"])
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "pipelines") if isinstance(data, Mapping) else []

    async def get_pipeline(self, pipeline_id: str) -> dict[str, Any]:
        payload = await self.deal_request(DEAL_ENDPOINTS["pipeline_get"], {"id": pipeline_id})
        data = payload.get("response", payload)
        return data.get("data", data) if isinstance(data, Mapping) else data

    async def get_pipeline_stages(self, pipeline_id: str) -> list[dict[str, Any]]:
        payload = await self.deal_request(DEAL_ENDPOINTS["pipeline_get_stages"], {"id": pipeline_id})
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "stages") if isinstance(data, Mapping) else []

    async def get_pipeline_segments(self, pipeline_id: str) -> list[dict[str, Any]]:
        payload = await self.deal_request(DEAL_ENDPOINTS["pipeline_get_segments"], {"id": pipeline_id})
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "segments") if isinstance(data, Mapping) else []

    async def get_pipeline_deals(self, pipeline_id: str, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._deal_paginated(
            DEAL_ENDPOINTS["pipeline_deals"],
            {"id": pipeline_id, **kwargs},
            list_keys=("data", "deals"),
        )

    # ── Deal ──────────────────────────────────────────────────────────────

    async def get_deal(self, deal_id: str) -> dict[str, Any]:
        payload = await self.deal_request(DEAL_ENDPOINTS["deal_get"], {"id": deal_id})
        data = payload.get("response", payload)
        return data.get("data", data) if isinstance(data, Mapping) else data

    async def get_deal_activities(self, deal_id: str) -> list[dict[str, Any]]:
        payload = await self.deal_request(DEAL_ENDPOINTS["deal_get_activities"], {"id": deal_id})
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "activities") if isinstance(data, Mapping) else []

    # ── Account ───────────────────────────────────────────────────────────

    async def get_account_services(self) -> list[dict[str, Any]]:
        payload = await self.deal_request(DEAL_ENDPOINTS["account_service_all"])
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "services") if isinstance(data, Mapping) else []

    async def get_accounts(self, service_id: str, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._deal_paginated(
            DEAL_ENDPOINTS["account_list"],
            {"service_id": service_id, **kwargs},
            list_keys=("data", "accounts"),
        )

    async def get_account(self, account_id: str) -> dict[str, Any]:
        payload = await self.deal_request(DEAL_ENDPOINTS["account_get"], {"id": account_id})
        data = payload.get("response", payload)
        return data.get("data", data) if isinstance(data, Mapping) else data

    # ── Contact ───────────────────────────────────────────────────────────

    async def get_contact_services(self) -> list[dict[str, Any]]:
        payload = await self.deal_request(DEAL_ENDPOINTS["contact_service_all"])
        data = payload.get("response", payload)
        return _extract_named_list(data, "data", "services") if isinstance(data, Mapping) else []

    async def get_contacts(self, service_id: str, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._deal_paginated(
            DEAL_ENDPOINTS["contact_list"],
            {"service_id": service_id, **kwargs},
            list_keys=("data", "contacts"),
        )

    async def get_contact(self, contact_id: str) -> dict[str, Any]:
        payload = await self.deal_request(DEAL_ENDPOINTS["contact_get"], {"id": contact_id})
        data = payload.get("response", payload)
        return data.get("data", data) if isinstance(data, Mapping) else data
