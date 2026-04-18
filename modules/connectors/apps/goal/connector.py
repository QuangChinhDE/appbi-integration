"""
Goal connector — wraps GoalManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.goal.common.auth import GoalCredentials
from modules.connectors.apps.goal.common.client import GoalManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class GoalConnector(BaseConnector):
    """Connector implementation for Base Goal."""

    def __init__(self, credentials: GoalCredentials):
        self._credentials = credentials
        self._client: GoalManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('goal')
        assert defn is not None, "Goal connector not found in registry"
        return defn

    async def _get_client(self) -> GoalManagementClient:
        if self._client is None:
            self._client = GoalManagementClient(self._credentials)
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

        if stream_key == 'cycles':
            return await client.get_cycles(**{k: v for k, v in cfg.items() if k in ('year', 'type')})

        if stream_key == 'cycle_checkins':
            path = str(cfg.get('path') or '')
            if not path:
                raise ValueError("cycle_checkins stream requires 'path' in config")
            return await client.get_cycle_checkins(path)

        if stream_key == 'cycle_krs':
            path = str(cfg.get('path') or '')
            if not path:
                raise ValueError("cycle_krs stream requires 'path' in config")
            return await client.get_cycle_krs(path)

        if stream_key == 'cycle_reviews':
            path = str(cfg.get('path') or '')
            if not path:
                raise ValueError("cycle_reviews stream requires 'path' in config")
            return await client.get_cycle_reviews(path)

        if stream_key == 'targets':
            target_id = str(cfg.get('target_id') or '')
            if not target_id:
                raise ValueError("targets stream requires 'target_id' in config")
            result = await client.get_target_full(target_id)
            return [result] if isinstance(result, dict) else []

        if stream_key == 'goals':
            goal_id = str(cfg.get('goal_id') or '')
            if not goal_id:
                raise ValueError("goals stream requires 'goal_id' in config")
            result = await client.get_goal_full(goal_id)
            return [result] if isinstance(result, dict) else []

        if stream_key == 'key_results':
            kr_id = str(cfg.get('kr_id') or '')
            if not kr_id:
                raise ValueError("key_results stream requires 'kr_id' in config")
            result = await client.get_key_result(kr_id)
            return [result] if isinstance(result, dict) else []

        raise ValueError(f"Unknown stream '{stream_key}' for goal connector")

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
