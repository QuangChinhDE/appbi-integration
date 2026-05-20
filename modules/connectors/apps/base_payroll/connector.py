"""
Payroll connector — wraps PayrollManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.base_payroll.common.auth import PayrollCredentials
from modules.connectors.apps.base_payroll.common.client import PayrollManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class PayrollConnector(BaseConnector):
    """Connector implementation for Base Payroll."""

    def __init__(self, credentials: PayrollCredentials):
        self._credentials = credentials
        self._client: PayrollManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('base_payroll')
        assert defn is not None, "Payroll connector not found in registry"
        return defn

    async def _get_client(self) -> PayrollManagementClient:
        if self._client is None:
            self._client = PayrollManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_cycles()
            return {'ok': True, 'cycles': len(result) if isinstance(result, list) else 0}
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
        filters = {k: v for k, v in cfg.items() if k in ('updated_from', 'updated_to', 'report_month', 'report_year')}

        if stream_key == 'cycles':
            return await client.get_cycles(**filters)

        if stream_key == 'payrolls':
            cycle_id = str(cfg.get('cycle_id') or '')
            if not cycle_id:
                raise ValueError("payrolls stream requires 'cycle_id' in config")
            return await client.get_payrolls(cycle_id, **filters)

        if stream_key == 'records':
            cycle_id = cfg.get('cycle_id')
            payroll_id = cfg.get('payroll_id')
            if not cycle_id and not payroll_id:
                raise ValueError("records stream requires 'cycle_id' or 'payroll_id' in config")
            return await client.get_records(
                cycle_id=str(cycle_id) if cycle_id else None,
                payroll_id=str(payroll_id) if payroll_id else None,
                **filters,
            )

        raise ValueError(f"Unknown stream '{stream_key}' for payroll connector")

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
