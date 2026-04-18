"""
WeWork connector — wraps WeworkManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.wework.common.auth import WeworkCredentials
from modules.connectors.apps.wework.common.client import WeworkManagementClient, merge_task_collections
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class WeworkConnector(BaseConnector):
    """Connector implementation for Base WeWork."""

    def __init__(self, credentials: WeworkCredentials):
        self._credentials = credentials
        self._client: WeworkManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('wework')
        assert defn is not None, "WeWork connector not found in registry"
        return defn

    async def _get_client(self) -> WeworkManagementClient:
        if self._client is None:
            self._client = WeworkManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_all_departments()
            return {'ok': True, 'departments': len(result) if isinstance(result, list) else 0}
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

        if stream_key == 'departments':
            return await client.get_all_departments()

        if stream_key == 'projects':
            return await client.get_all_projects()

        if stream_key == 'tasks':
            project_id = str(cfg.get('project_id') or '')
            if not project_id:
                raise ValueError("tasks stream requires 'project_id' in config")
            # get_project_snapshot returns tasks + subtasks merged
            snapshot = await client.get_project_snapshot(project_id)
            tasks = snapshot.get('tasks') or []
            return tasks

        if stream_key == 'subtasks':
            project_id = str(cfg.get('project_id') or '')
            if not project_id:
                raise ValueError("subtasks stream requires 'project_id' in config")
            snapshot = await client.get_project_snapshot(project_id)
            subtasks = snapshot.get('subtasks') or []
            return subtasks

        if stream_key == 'tasklists':
            project_id = str(cfg.get('project_id') or '')
            if not project_id:
                raise ValueError("tasklists stream requires 'project_id' in config")
            snapshot = await client.get_project_snapshot(project_id)
            tasklists = snapshot.get('tasklists') or []
            return tasklists

        raise ValueError(f"Unknown stream '{stream_key}' for wework connector")

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
