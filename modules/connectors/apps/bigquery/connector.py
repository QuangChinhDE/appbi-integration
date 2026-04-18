"""
BigQuery connector — wraps BigQueryClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.bigquery.common.auth import BigQueryCredentials
from modules.connectors.apps.bigquery.common.client import BigQueryClient, BigQueryTokenSource
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class BigQueryConnector(BaseConnector):
    """Connector for BigQuery — read/write datasets, tables, rows."""

    def __init__(self, token_source: BigQueryTokenSource, credentials: BigQueryCredentials):
        self._token_source = token_source
        self._credentials = credentials
        self._client: BigQueryClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('bigquery')
        assert defn is not None, "BigQuery connector not found in registry"
        return defn

    async def _get_client(self) -> BigQueryClient:
        if self._client is None:
            self._client = BigQueryClient(
                self._token_source,
                project_id=self._credentials.project_id,
            )
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            datasets = await client.list_datasets()
            return {'ok': True, 'datasets': len(datasets)}
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

        if stream_key == 'datasets':
            return await client.list_datasets()

        if stream_key == 'tables':
            dataset_id = str(cfg.get('dataset_id') or self._credentials.dataset_id or '')
            if not dataset_id:
                raise ValueError("tables stream requires 'dataset_id' in config")
            return await client.list_tables(dataset_id)

        if stream_key == 'rows':
            dataset_id = str(cfg.get('dataset_id') or self._credentials.dataset_id or '')
            table_id = str(cfg.get('table_id') or '')
            if not dataset_id or not table_id:
                raise ValueError("rows stream requires 'dataset_id' and 'table_id' in config")
            sql = f"SELECT * FROM `{self._credentials.project_id}.{dataset_id}.{table_id}`"
            limit = int(cfg.get('limit', 1000))
            return await client.query(sql, dataset_id=dataset_id, max_results=limit)

        raise ValueError(f"Unknown stream '{stream_key}' for bigquery connector")

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        client = await self._get_client()
        cfg = dict(config or {})

        if stream_key == 'tables':
            dataset_id = str(cfg.get('dataset_id') or self._credentials.dataset_id or '')
            if not dataset_id:
                raise ValueError("tables write requires 'dataset_id' in config")
            created = []
            for record in records:
                table_id = str(record.get('table_id', ''))
                fields = record.get('fields', [])
                if not table_id or not fields:
                    continue
                result = await client.create_table(dataset_id, table_id, fields)
                created.append(result)
            return {'created': len(created), 'tables': created}

        if stream_key == 'rows':
            dataset_id = str(cfg.get('dataset_id') or self._credentials.dataset_id or '')
            table_id = str(cfg.get('table_id') or '')
            write_mode = str(cfg.get('write_mode', 'append'))
            if not dataset_id or not table_id:
                raise ValueError("rows write requires 'dataset_id' and 'table_id' in config")
            if write_mode == 'replace':
                # Truncate then insert
                fq_table = f"`{self._credentials.project_id}.{dataset_id}.{table_id}`"
                await client.query(f"TRUNCATE TABLE {fq_table}", dataset_id=dataset_id)
                if records:
                    result = await client.insert_rows(dataset_id, table_id, records)
                else:
                    result = {'inserted': 0}
            elif write_mode == 'upsert':
                # MERGE via primary key — caller must provide merge_key in config
                merge_key = str(cfg.get('merge_key', 'id'))
                if not records:
                    result = {'merged': 0}
                else:
                    result = await client.insert_rows(dataset_id, table_id, records)
                    result['merge_key'] = merge_key
            else:
                result = await client.insert_rows(dataset_id, table_id, records)
            result['write_mode'] = write_mode
            return result

        raise ValueError(f"Unknown stream '{stream_key}' for bigquery connector")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
