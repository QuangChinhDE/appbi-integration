"""
Table connector — wraps TableManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.base_table.common.auth import TableCredentials
from modules.connectors.apps.base_table.common.client import TableManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class TableConnector(BaseConnector):
    """Connector implementation for Base Table."""

    def __init__(self, credentials: TableCredentials):
        self._credentials = credentials
        self._client: TableManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('base_table')
        assert defn is not None, "Table connector not found in registry"
        return defn

    async def _get_client(self) -> TableManagementClient:
        if self._client is None:
            self._client = TableManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            # Table requires a table_id to read; just verify the API is reachable
            await client.request("/table/records", {"table_id": "__test__", "limit": 1})
            return {'ok': True}
        except Exception as exc:
            error_msg = str(exc)
            # A response error means the API is reachable (auth works)
            if "code" in error_msg.lower():
                return {'ok': True, 'note': 'API reachable, table_id needed for data'}
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

        if stream_key == 'records':
            table_id = str(cfg.get('table_id') or '')
            if not table_id:
                raise ValueError("records stream requires 'table_id' in config")
            filters = {k: v for k, v in cfg.items() if k != 'table_id'}
            return await client.get_records(table_id, **filters)

        raise ValueError(f"Unknown stream '{stream_key}' for table connector")

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        if stream_key == 'records':
            client = await self._get_client()
            cfg = dict(config or {})
            table_id = str(cfg.get('table_id') or '')
            username = str(cfg.get('username') or '')
            if not table_id or not username:
                raise ValueError("records write requires 'table_id' and 'username' in config")

            created = 0
            errors = 0
            for record in records:
                try:
                    name = record.pop('_name', record.pop('name', ''))
                    await client.create_record(table_id, username, name, **record)
                    created += 1
                except Exception:
                    errors += 1
            return {'written': created, 'errors': errors}

        stream = self.definition.get_stream(stream_key)
        if stream is None:
            raise ValueError(f"Stream '{stream_key}' not found")
        raise NotImplementedError(f"write_stream for '{stream_key}' not yet implemented")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
