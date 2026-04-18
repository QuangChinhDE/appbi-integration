"""
Income connector — wraps IncomeManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.income.common.auth import IncomeCredentials
from modules.connectors.apps.income.common.client import IncomeManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class IncomeConnector(BaseConnector):
    """Connector implementation for Base Income."""

    def __init__(self, credentials: IncomeCredentials):
        self._credentials = credentials
        self._client: IncomeManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('income')
        assert defn is not None, "Income connector not found in registry"
        return defn

    async def _get_client(self) -> IncomeManagementClient:
        if self._client is None:
            self._client = IncomeManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            # Income requires a username to list; verify API is reachable
            await client.request("/incomes/get", {"username": "__test__", "limit": 1})
            return {'ok': True}
        except Exception as exc:
            error_msg = str(exc)
            if "code" in error_msg.lower():
                return {'ok': True, 'note': 'API reachable'}
            return {'ok': False, 'error': error_msg}

    async def read_stream(
        self,
        stream_key: str,
        *,
        config: Mapping[str, Any] | None = None,
        cursor: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        client = await self._get_client()
        cfg = dict(config or {})

        if stream_key == 'incomes':
            username = str(cfg.get('username') or '')
            if not username:
                raise ValueError("incomes stream requires 'username' in config")
            filters = {k: v for k, v in cfg.items() if k != 'username'}
            return await client.get_incomes(username, **filters)

        if stream_key == 'inflows':
            username = str(cfg.get('username') or '')
            if not username:
                raise ValueError("inflows stream requires 'username' in config")
            filters = {k: v for k, v in cfg.items() if k != 'username'}
            return await client.get_inflows(username, **filters)

        raise ValueError(f"Unknown stream '{stream_key}' for income connector")

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
