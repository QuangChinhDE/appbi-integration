"""
HRM connector — wraps HrmManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.base_hrm.common.auth import HrmCredentials
from modules.connectors.apps.base_hrm.common.client import HrmManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class HrmConnector(BaseConnector):
    """Connector implementation for Base HRM."""

    def __init__(self, credentials: HrmCredentials):
        self._credentials = credentials
        self._client: HrmManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('base_hrm')
        assert defn is not None, "HRM connector not found in registry"
        return defn

    async def _get_client(self) -> HrmManagementClient:
        if self._client is None:
            self._client = HrmManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_employees()
            return {'ok': True, 'employees': len(result) if isinstance(result, list) else 0}
        except Exception as exc:
            return {'ok': False, 'error': str(exc)}

    async def read_stream(
        self,
        stream_key: str,
        *,
        config: Mapping[str, Any] | None = None,
        cursor: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        client = await self._get_client()
        cfg = dict(config or {})
        filters = {k: v for k, v in cfg.items() if k in ('updated_from', 'updated_to')}

        stream_map: dict[str, Any] = {
            'employees': lambda: client.get_employees(**filters),
            'areas': lambda: client.get_areas(**filters),
            'offices': lambda: client.get_offices(**filters),
            'positions': lambda: client.get_positions(**filters),
            'teams': lambda: client.get_teams(**filters),
            'career_records': lambda: client.get_career_records(**filters),
            'contracts': lambda: client.get_contracts(),
            'employee_types': lambda: client.get_employee_types(**filters),
            'work_histories': lambda: client.get_work_histories(**filters),
            'payroll_cycles': lambda: client.get_payroll_cycles(**filters),
            'payroll_records': lambda: client.get_payroll_records(**filters),
            'timesheets': lambda: client.get_timesheets(),
            'taxes': lambda: client.get_taxes(**filters),
            'insurances': lambda: client.get_insurances(**filters),
            'legal_info': lambda: client.get_legal_info(**filters),
            'educations': lambda: client.get_educations(**filters),
            'relations': lambda: client.get_relations(**filters),
            'merit_types': lambda: client.get_merit_types(),
            'merit_templates': lambda: client.get_merit_templates(),
            'merit_rules': lambda: client.get_merit_rules(),
            'merit_awards': lambda: client.get_merit_awards(),
            'merit_certs': lambda: client.get_merit_certs(),
            'merit_records': lambda: client.get_merit_records(),
            'checkin_clients': lambda: client.get_checkin_clients(),
        }

        handler = stream_map.get(stream_key)
        if handler is None:
            raise ValueError(f"Unknown stream '{stream_key}' for hrm connector")
        return await handler()

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        stream = self.definition.get_stream(stream_key)
        if stream is None:
            raise ValueError(f"Stream '{stream_key}' not found")
        if not stream.can_write:
            raise NotImplementedError(f"Stream '{stream_key}' does not support writes")
        raise NotImplementedError(f"write_stream for '{stream_key}' not yet implemented")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
