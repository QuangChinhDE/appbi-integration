from __future__ import annotations

from typing import Any, Mapping

import httpx

from modules.connectors.apps.base_goal.common.auth import GoalCredentials
from modules.connectors.apps.base_goal.common.constants import ENDPOINTS, SUCCESS_CODES


class GoalApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {k: v for k, v in body.items() if v is not None and v != ""}


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise GoalApiError("Unexpected Goal API response format")


def _extract_list(payload: Mapping[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [dict(item) for item in value if isinstance(item, Mapping)]
    return []


class GoalManagementClient:
    def __init__(self, credentials: GoalCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "GoalManagementClient":
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
            raise GoalApiError(str(payload.get("message") or payload.get("error") or f"Goal API returned code {code}"))
        return payload

    # ── Cycles ────────────────────────────────────────────────────────────

    async def get_cycles(self, **kwargs: Any) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["cycle_list"], kwargs or None)
        return _extract_list(payload, "data", "cycles")

    async def get_cycle(self, path: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["cycle_get"], {"path": path})
        return payload.get("data", payload)

    async def get_cycle_full(self, path: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["cycle_get_full"], {"path": path})
        return payload.get("data", payload)

    async def get_cycle_checkins(self, path: str) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["cycle_checkins"], {"path": path})
        return _extract_list(payload, "data", "checkins")

    async def get_cycle_krs(self, path: str) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["cycle_krs"], {"path": path})
        return _extract_list(payload, "data", "krs")

    async def get_cycle_reviews(self, path: str) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["cycle_reviews"], {"path": path})
        return _extract_list(payload, "data", "reviews")

    # ── Goals ─────────────────────────────────────────────────────────────

    async def get_goal(self, goal_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["goal_get"], {"id": goal_id})
        return payload.get("data", payload)

    async def get_goal_full(self, goal_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["goal_get_full"], {"id": goal_id})
        return payload.get("data", payload)

    # ── Key Results ───────────────────────────────────────────────────────

    async def get_key_result(self, kr_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["kr_get"], {"id": kr_id})
        return payload.get("data", payload)

    # ── Targets ───────────────────────────────────────────────────────────

    async def get_target(self, target_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["target_get"], {"id": target_id})
        return payload.get("data", payload)

    async def get_target_full(self, target_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["target_get_full"], {"id": target_id})
        return payload.get("data", payload)
