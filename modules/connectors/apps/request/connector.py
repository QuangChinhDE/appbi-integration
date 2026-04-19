"""
Request connector — wraps RequestManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.request.common.auth import RequestCredentials
from modules.connectors.apps.request.common.client import RequestManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class RequestConnector(BaseConnector):
    """Connector implementation for Base Request."""

    def __init__(self, credentials: RequestCredentials):
        self._credentials = credentials
        self._client: RequestManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('request')
        assert defn is not None, "Request connector not found in registry"
        return defn

    async def _get_client(self) -> RequestManagementClient:
        if self._client is None:
            self._client = RequestManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_all_groups()
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
            return await client.get_all_groups()

        if stream_key == 'requests':
            group_id = str(cfg.get('group_id') or '')
            if not group_id:
                raise ValueError("requests stream requires 'group_id' in config")
            return await client.get_requests(group_id=group_id)

        if stream_key == 'request_details':
            request_id = str(cfg.get('request_id') or '')
            if not request_id:
                raise ValueError("request_details stream requires 'request_id' in config")
            result = await client.get_request(request_id)
            return [result] if isinstance(result, dict) else []

        if stream_key == 'request_custom_tables':
            request_id = str(cfg.get('request_id') or '')
            if not request_id:
                raise ValueError("request_custom_tables stream requires 'request_id' in config")
            result = await client.get_request_with_custom_table(request_id)
            return [result] if isinstance(result, dict) else []

        if stream_key == 'posts':
            request_id = str(cfg.get('request_id') or '')
            if not request_id:
                raise ValueError("posts stream requires 'request_id' in config")
            return await client.get_request_posts(request_id)

        if stream_key == 'comments':
            post_hid = str(cfg.get('post_hid') or '')
            if not post_hid:
                raise ValueError("comments stream requires 'post_hid' in config")
            return await client.get_request_comments(post_hid)

        raise ValueError(f"Unknown stream '{stream_key}' for request connector")

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
            raise ValueError(f"Request connector only supports write_mode='append', got '{write_mode}'")

        if stream_key == 'requests':
            client = await self._get_client()
            default_group_id = str(cfg.get('group_id') or '')
            written = 0
            errors = 0
            for record in records:
                try:
                    await client.create_request(
                        username=str(record.get('username') or cfg.get('username') or ''),
                        group_id=str(record.get('group_id') or default_group_id),
                        name=str(record.get('name') or ''),
                        description=record.get('description'),
                        followers=record.get('followers'),
                        assignees=record.get('assignees'),
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
