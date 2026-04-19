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
        cfg = dict(config or {})
        write_mode = str(cfg.get('write_mode') or 'append').lower()
        if write_mode != 'append':
            raise ValueError(f"WeWork connector only supports write_mode='append', got '{write_mode}'")

        client = await self._get_client()
        default_username = str(cfg.get('username') or '')
        default_project_id = str(cfg.get('project_id') or '')
        written = 0
        errors = 0

        if stream_key == 'departments':
            for record in records:
                try:
                    await client.create_department(
                        username=str(record.get('username') or default_username),
                        name=str(record.get('name') or ''),
                        description=record.get('description'),
                        parent_id=record.get('parent_id'),
                    )
                    written += 1
                except Exception:
                    errors += 1
            return {'written': written, 'errors': errors}

        if stream_key == 'projects':
            for record in records:
                try:
                    await client.create_project(
                        username=str(record.get('username') or default_username),
                        metatype=str(record.get('metatype') or 'project'),
                        name=str(record.get('name') or ''),
                        external=str(record.get('external') or '0'),
                        description=record.get('description'),
                        parent_id=record.get('parent_id'),
                    )
                    written += 1
                except Exception:
                    errors += 1
            return {'written': written, 'errors': errors}

        if stream_key == 'tasks':
            for record in records:
                try:
                    await client.create_task(
                        username=str(record.get('username') or default_username),
                        project_id=str(record.get('project_id') or default_project_id),
                        name=str(record.get('name') or ''),
                        assignee=record.get('assignee'),
                        description=record.get('description'),
                        deadline=record.get('deadline'),
                        tasklist_id=record.get('tasklist_id'),
                    )
                    written += 1
                except Exception:
                    errors += 1
            return {'written': written, 'errors': errors}

        if stream_key == 'subtasks':
            for record in records:
                try:
                    await client.create_subtask(
                        username=str(record.get('username') or default_username),
                        parent_id=str(record.get('parent_id') or record.get('task_id') or ''),
                        name=str(record.get('name') or ''),
                        assignee=record.get('assignee'),
                        description=record.get('description'),
                    )
                    written += 1
                except Exception:
                    errors += 1
            return {'written': written, 'errors': errors}

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
