"""
Meeting connector — wraps MeetingManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.base_meeting.common.auth import MeetingCredentials
from modules.connectors.apps.base_meeting.common.client import MeetingManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class MeetingConnector(BaseConnector):
    """Connector implementation for Base Meeting (read-only)."""

    def __init__(self, credentials: MeetingCredentials):
        self._credentials = credentials
        self._client: MeetingManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('base_meeting')
        assert defn is not None, "Meeting connector not found in registry"
        return defn

    async def _get_client(self) -> MeetingManagementClient:
        if self._client is None:
            self._client = MeetingManagementClient(self._credentials)
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

        if stream_key == 'groups':
            return await client.get_groups()

        if stream_key == 'meetings':
            filters = {k: v for k, v in cfg.items() if k in ('group_id',)}
            return await client.get_meetings(**filters)

        if stream_key == 'repeated_meetings':
            return await client.get_repeated_meetings()

        raise ValueError(f"Unknown stream '{stream_key}' for meeting connector")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
