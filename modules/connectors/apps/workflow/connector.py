"""
Workflow connector — wraps WorkflowManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.workflow.common.auth import WorkflowCredentials
from modules.connectors.apps.workflow.common.client import WorkflowManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class WorkflowConnector(BaseConnector):
    """Connector implementation for Base Workflow."""

    def __init__(self, credentials: WorkflowCredentials):
        self._credentials = credentials
        self._client: WorkflowManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('workflow')
        assert defn is not None, "Workflow connector not found in registry"
        return defn

    async def _get_client(self) -> WorkflowManagementClient:
        if self._client is None:
            self._client = WorkflowManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_all_workflows()
            return {'ok': True, 'workflows': len(result) if isinstance(result, list) else 0}
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

        if stream_key == 'workflows':
            return await client.get_all_workflows()

        if stream_key == 'stages':
            workflow_id = str(cfg.get('workflow_id') or '')
            if not workflow_id:
                raise ValueError("stages stream requires 'workflow_id' in config")
            return await client.get_workflow_stages(workflow_id)

        if stream_key == 'jobs':
            workflow_id = str(cfg.get('workflow_id') or '')
            if not workflow_id:
                raise ValueError("jobs stream requires 'workflow_id' in config")
            filters = cfg.get('filters') or {}
            return await client.get_workflow_jobs(workflow_id, filters=filters if filters else None)

        if stream_key == 'job_details':
            job_id = str(cfg.get('job_id') or '')
            if not job_id:
                raise ValueError("job_details stream requires 'job_id' in config")
            result = await client.get_job(job_id)
            return [result] if isinstance(result, dict) else []

        if stream_key == 'job_custom_tables':
            job_id = str(cfg.get('job_id') or '')
            if not job_id:
                raise ValueError("job_custom_tables stream requires 'job_id' in config")
            result = await client.get_job_custom_table(job_id)
            if isinstance(result, dict):
                return [result]
            if isinstance(result, list):
                return [item for item in result if isinstance(item, dict)]
            return []

        if stream_key == 'posts':
            job_id = str(cfg.get('job_id') or '')
            if not job_id:
                raise ValueError("posts stream requires 'job_id' in config")
            return await client.get_job_posts(job_id)

        if stream_key == 'comments':
            post_id = str(cfg.get('post_id') or '')
            if not post_id:
                raise ValueError("comments stream requires 'post_id' in config")
            return await client.get_job_comments(post_id)

        raise ValueError(f"Unknown stream '{stream_key}' for workflow connector")

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
            raise ValueError(f"Workflow connector only supports write_mode='append', got '{write_mode}'")

        if stream_key == 'jobs':
            client = await self._get_client()
            default_workflow_id = str(cfg.get('workflow_id') or '')
            written = 0
            errors = 0
            for record in records:
                try:
                    await client.create_job(
                        creator_username=str(record.get('creator_username') or cfg.get('username') or ''),
                        workflow_id=str(record.get('workflow_id') or default_workflow_id),
                        name=str(record.get('name') or ''),
                        assignees=record.get('assignees'),
                        followers=record.get('followers'),
                        managers=record.get('managers'),
                        description=record.get('description'),
                        deadline=record.get('deadline'),
                        custom_fields=record.get('custom_fields'),
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
