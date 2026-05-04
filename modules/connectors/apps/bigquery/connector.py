"""
BigQuery connector — wraps BigQueryClient with the BaseConnector interface.

Write semantics for the `rows` destination stream:

* append  – streaming insertAll into the target table. Auto-creates the table
  if it does not yet exist, using a schema inferred from the first batch of
  records (or the explicit `schema_fields` supplied via dest_config).
* replace – drops the table and re-creates it with the inferred schema before
  streaming the new batch. This avoids the BigQuery streaming-buffer issues
  that bite TRUNCATE + insertAll.
* upsert  – requires `merge_key` in dest_config. Deletes any existing rows
  whose merge-key matches the incoming batch, then inserts the batch.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.bigquery.common.auth import BigQueryCredentials
from modules.connectors.apps.bigquery.common.client import (
    BigQueryApiError,
    BigQueryClient,
    BigQueryTokenSource,
)
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


def _sanitize_column(name: str) -> str:
    """BigQuery column names must match [A-Za-z_][A-Za-z0-9_]* and be <=300 chars."""
    cleaned = re.sub(r'[^A-Za-z0-9_]', '_', str(name).strip())
    if not cleaned or cleaned[0].isdigit():
        cleaned = f'_{cleaned}'
    return cleaned[:300]


def _infer_bq_type(value: Any) -> str:
    if value is None:
        return 'STRING'
    if isinstance(value, bool):
        return 'BOOL'
    if isinstance(value, int):
        return 'INT64'
    if isinstance(value, float):
        return 'FLOAT64'
    if isinstance(value, datetime):
        return 'TIMESTAMP'
    if isinstance(value, date):
        return 'DATE'
    if isinstance(value, (list, dict)):
        return 'STRING'
    return 'STRING'


def _merge_type(existing: str, incoming: str) -> str:
    if existing == incoming:
        return existing
    if {existing, incoming} <= {'INT64', 'FLOAT64'}:
        return 'FLOAT64'
    return 'STRING'


def _infer_schema(records: list[dict[str, Any]]) -> list[dict[str, str]]:
    columns: dict[str, str] = {}
    order: list[str] = []
    for record in records:
        if not isinstance(record, Mapping):
            continue
        for key, value in record.items():
            col = _sanitize_column(str(key))
            inferred = _infer_bq_type(value)
            if col not in columns:
                columns[col] = inferred
                order.append(col)
            else:
                columns[col] = _merge_type(columns[col], inferred)
    return [
        {'name': col, 'type': columns[col], 'mode': 'NULLABLE'}
        for col in order
    ]


def _normalize_schema_fields(raw: Any) -> list[dict[str, str]] | None:
    if not raw:
        return None
    fields: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        name = str(item.get('name') or '').strip()
        if not name:
            continue
        field_type = str(item.get('type') or 'STRING').strip().upper()
        if field_type == 'NUMBER':
            field_type = 'FLOAT64'
        if field_type == 'BOOLEAN':
            field_type = 'BOOL'
        if field_type in {'OBJECT', 'ARRAY', 'MIXED', 'NULL', 'UNKNOWN'}:
            field_type = 'STRING'
        mode = str(item.get('mode') or 'NULLABLE').strip().upper()
        fields.append({'name': _sanitize_column(name), 'type': field_type, 'mode': mode})
    return fields or None


def _coerce_value(value: Any, field_type: str) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        try:
            return json.dumps(value, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if field_type == 'BOOL' and not isinstance(value, bool):
        return bool(value)
    if field_type == 'INT64' and not isinstance(value, bool):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if field_type == 'FLOAT64':
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return value


def _normalize_record(
    record: Mapping[str, Any],
    schema: list[dict[str, Any]],
) -> dict[str, Any]:
    type_by_col = {str(f['name']): str(f.get('type') or 'STRING').upper() for f in schema}
    normalized: dict[str, Any] = {}
    for key, value in record.items():
        col = _sanitize_column(str(key))
        field_type = type_by_col.get(col, 'STRING')
        normalized[col] = _coerce_value(value, field_type)
    return normalized


def _sql_literal(value: Any) -> str:
    """Render a Python value as a BigQuery SQL literal for use in DML."""
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value).replace('\\', '\\\\').replace("'", "\\'")
    return f"'{text}'"


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
            created: list[dict[str, Any]] = []
            for record in records:
                table_id = str(record.get('table_id', ''))
                fields = record.get('fields', [])
                if not table_id or not fields:
                    continue
                result = await client.create_table(dataset_id, table_id, fields)
                created.append(result)
            return {'created': len(created), 'written': len(created), 'tables': created}

        if stream_key == 'rows':
            return await self._write_rows(records, cfg)

        raise ValueError(f"Unknown stream '{stream_key}' for bigquery connector")

    async def _write_rows(
        self,
        records: list[dict[str, Any]],
        cfg: Mapping[str, Any],
    ) -> dict[str, Any]:
        client = await self._get_client()
        dataset_id = str(cfg.get('dataset_id') or self._credentials.dataset_id or '').strip()
        table_id = str(cfg.get('table_id') or '').strip()
        write_mode = str(cfg.get('write_mode', 'append')).strip().lower()
        if not dataset_id or not table_id:
            raise ValueError("rows write requires 'dataset_id' and 'table_id' in config")

        explicit_schema = _normalize_schema_fields(cfg.get('schema_fields'))

        existing_schema: dict[str, Any] | None = None
        try:
            existing_schema = await client.get_table_schema(dataset_id, table_id)
        except BigQueryApiError as exc:
            if exc.status_code == 404:
                existing_schema = None
            else:
                raise

        if write_mode == 'replace' and existing_schema is not None:
            await client.delete_table(dataset_id, table_id)
            existing_schema = None

        if existing_schema is None:
            schema = explicit_schema or _infer_schema(records) or [
                {'name': 'payload', 'type': 'STRING', 'mode': 'NULLABLE'}
            ]
            await client.create_table(dataset_id, table_id, schema)
        else:
            schema = list(existing_schema.get('fields') or [])
            if not schema:
                schema = explicit_schema or _infer_schema(records) or []

        normalized_records = [
            _normalize_record(r, schema)
            for r in records
            if isinstance(r, Mapping)
        ]

        if write_mode == 'upsert':
            merge_key = str(cfg.get('merge_key') or '').strip()
            if not merge_key:
                raise ValueError("rows upsert requires 'merge_key' in dest_config")
            merge_col = _sanitize_column(merge_key)
            keys = [r.get(merge_col) for r in normalized_records if r.get(merge_col) is not None]
            if keys:
                literals = ', '.join(_sql_literal(k) for k in keys)
                fq = f"`{self._credentials.project_id}.{dataset_id}.{table_id}`"
                await client.query(
                    f"DELETE FROM {fq} WHERE {merge_col} IN ({literals})",
                    dataset_id=dataset_id,
                )
            result = await client.insert_rows(dataset_id, table_id, normalized_records)
            result['write_mode'] = 'upsert'
            result['merge_key'] = merge_col
            result['written'] = result.get('inserted', 0)
            return result

        result = await client.insert_rows(dataset_id, table_id, normalized_records)
        result['write_mode'] = write_mode
        result['written'] = result.get('inserted', 0)
        return result

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
