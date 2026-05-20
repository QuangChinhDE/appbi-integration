"""
Timeoff connector — wraps TimeoffManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.base_timeoff.common.auth import TimeoffCredentials
from modules.connectors.apps.base_timeoff.common.client import TimeoffManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class TimeoffConnector(BaseConnector):
    """Connector implementation for Base Timeoff (read-only)."""

    def __init__(self, credentials: TimeoffCredentials):
        self._credentials = credentials
        self._client: TimeoffManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('base_timeoff')
        assert defn is not None, "Timeoff connector not found in registry"
        return defn

    async def _get_client(self) -> TimeoffManagementClient:
        if self._client is None:
            self._client = TimeoffManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_groups()
            return {'ok': True, 'groups': len(result) if isinstance(result, list) else 0}
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

        if stream_key == 'timeoffs':
            filters = {k: v for k, v in cfg.items() if k in (
                'users', 'start_date_from', 'start_date_to',
                'end_date_from', 'end_date_to', 'q', 's',
            )}
            return await client.get_timeoffs(**filters)

        if stream_key == 'groups':
            return await client.get_groups()

        raise ValueError(f"Unknown stream '{stream_key}' for timeoff connector")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
