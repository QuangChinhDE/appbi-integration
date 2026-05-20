from __future__ import annotations

from typing import Any, Mapping

import httpx

from modules.connectors.apps.base_income.common.auth import IncomeCredentials
from modules.connectors.apps.base_income.common.constants import ENDPOINTS, SUCCESS_CODES


class IncomeApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {k: v for k, v in body.items() if v is not None and v != ""}


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise IncomeApiError("Unexpected Income API response format")


def _extract_list(payload: Mapping[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [dict(item) for item in value if isinstance(item, Mapping)]
    return []


class IncomeManagementClient:
    def __init__(self, credentials: IncomeCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "IncomeManagementClient":
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
            raise IncomeApiError(str(payload.get("message") or payload.get("error") or f"Income API returned code {code}"))
        return payload

    async def _paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        *,
        list_keys: tuple[str, ...] = ("data",),
        max_pages: int = 200,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        page = 1
        output: list[dict[str, Any]] = []
        for _ in range(max_pages):
            payload = await self.request(endpoint, {**clean_body(body), "page": page, "limit": limit})
            items = _extract_list(payload, *list_keys)
            if not items:
                break
            output.extend(items)
            page += 1
        return output

    # ── Income ────────────────────────────────────────────────────────────

    async def get_income(self, income_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["income_get"], {"id": income_id})
        return payload.get("data", payload)

    async def get_incomes(self, username: str, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(
            ENDPOINTS["incomes_get"],
            {"username": username, **kwargs},
            list_keys=("data", "incomes"),
        )

    async def get_incomes_last_update(self, updated_from: str, start: str, end: str, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(
            ENDPOINTS["incomes_last_update"],
            {"updated_from": updated_from, "start": start, "end": end, **kwargs},
            list_keys=("data", "incomes"),
        )

    # ── Inflow ────────────────────────────────────────────────────────────

    async def get_inflow(self, inflow_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["inflow_get"], {"id": inflow_id})
        return payload.get("data", payload)

    async def get_inflows(self, username: str, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(
            ENDPOINTS["inflows_get"],
            {"username": username, **kwargs},
            list_keys=("data", "inflows"),
        )

    async def get_inflows_last_update(self, updated_from: str, start: str, end: str, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(
            ENDPOINTS["inflows_last_update"],
            {"updated_from": updated_from, "start": start, "end": end, **kwargs},
            list_keys=("data", "inflows"),
        )
