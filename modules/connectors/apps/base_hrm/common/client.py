from __future__ import annotations

from typing import Any, Iterable, Mapping

import httpx

from modules.connectors.apps.base_hrm.common.auth import HrmCredentials
from modules.connectors.apps.base_hrm.common.constants import ENDPOINTS, SUCCESS_CODES


class HrmApiError(RuntimeError):
    pass


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    return {k: v for k, v in body.items() if v is not None and v != ""}


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise HrmApiError("Unexpected HRM API response format")


def _extract_list(payload: Mapping[str, Any], *keys: str) -> list[dict[str, Any]]:
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


class HrmManagementClient:
    def __init__(self, credentials: HrmCredentials, timeout: float = 30.0):
        self.credentials = credentials
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "HrmManagementClient":
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
            raise HrmApiError(str(payload.get("message") or payload.get("error") or f"HRM API returned code {code}"))
        return payload

    async def _paginated(
        self,
        endpoint: str,
        body: Mapping[str, Any] | None = None,
        *,
        list_keys: tuple[str, ...] = ("data",),
        item_id_candidates: Iterable[str] = ("id",),
        max_pages: int = 200,
    ) -> list[dict[str, Any]]:
        page = 0
        seen_ids: set[str] = set()
        output: list[dict[str, Any]] = []
        for _ in range(max_pages):
            payload = await self.request(endpoint, {**clean_body(body), "page": page})
            items = _extract_list(payload, *list_keys)
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

    # ── Employee ──────────────────────────────────────────────────────────

    async def get_employees(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["employee_list"], kwargs, list_keys=("data", "employees"))

    async def get_employee(self, employee_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["employee_get"], {"id": employee_id})
        return payload.get("data", payload)

    # ── Organization ──────────────────────────────────────────────────────

    async def get_areas(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["area_list"], kwargs, list_keys=("data", "areas"))

    async def get_offices(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["office_list"], kwargs, list_keys=("data", "offices"))

    async def get_positions(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["position_list"], kwargs, list_keys=("data", "positions"))

    async def get_position_types(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["position_types"])
        return _extract_list(payload, "data", "types")

    async def get_teams(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["team_list"], kwargs, list_keys=("data", "teams"))

    # ── Employment info ───────────────────────────────────────────────────

    async def get_career_records(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["career_records"], kwargs, list_keys=("data",))

    async def get_contracts(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["contract_list"])
        return _extract_list(payload, "data", "contracts")

    async def get_contract_types(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["contract_types"])
        return _extract_list(payload, "data", "types")

    async def get_employee_types(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["employee_types"], kwargs, list_keys=("data",))

    async def get_work_histories(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["employee_works"], kwargs, list_keys=("data",))

    # ── Education & relations ─────────────────────────────────────────────

    async def get_educations(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["employee_educations"], kwargs, list_keys=("data",))

    async def get_relations(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["employee_relations"], kwargs, list_keys=("data",))

    # ── Merit ─────────────────────────────────────────────────────────────

    async def get_merit_types(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["merit_types"])
        return _extract_list(payload, "data", "types")

    async def get_merit_templates(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["merit_templates"])
        return _extract_list(payload, "data", "templates")

    async def get_merit_awards(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["merit_awards"])
        return _extract_list(payload, "data", "awards")

    async def get_merit_certs(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["merit_certs"])
        return _extract_list(payload, "data", "certs")

    async def get_merit_records(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["merit_records"])
        return _extract_list(payload, "data", "records")

    async def get_merit_rules(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["merit_rules"])
        return _extract_list(payload, "data", "rules")

    # ── Payroll & attendance ──────────────────────────────────────────────

    async def get_payroll_cycles(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["payroll_cycles"], kwargs, list_keys=("data",))

    async def get_payroll_records(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["payroll_records"], kwargs, list_keys=("data",))

    async def get_timesheets(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["timesheet_list"])
        return _extract_list(payload, "data", "timesheets")

    async def get_timesheet(self, timesheet_id: str) -> dict[str, Any]:
        payload = await self.request(ENDPOINTS["timesheet_get"], {"id": timesheet_id})
        return payload.get("data", payload)

    # ── Tax, insurance & legal ────────────────────────────────────────────

    async def get_taxes(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["tax_list"], kwargs, list_keys=("data",))

    async def get_insurances(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["insurance_list"], kwargs, list_keys=("data",))

    async def get_legal_info(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._paginated(ENDPOINTS["employee_legals"], kwargs, list_keys=("data",))

    # ── Check-in client ───────────────────────────────────────────────────

    async def get_checkin_clients(self) -> list[dict[str, Any]]:
        payload = await self.request(ENDPOINTS["checkin_client_list"])
        return _extract_list(payload, "data", "clients")
