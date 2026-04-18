"""
Google Sheets connector — wraps GoogleSheetsClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.gsheets.common.client import GoogleSheetsClient, GoogleSheetsTokenSource
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class GoogleSheetsConnector(BaseConnector):
    """Connector for Google Sheets — read/write spreadsheet data."""

    def __init__(self, token_source: GoogleSheetsTokenSource):
        self._token_source = token_source
        self._client: GoogleSheetsClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('gsheets')
        assert defn is not None, "Google Sheets connector not found in registry"
        return defn

    async def _get_client(self) -> GoogleSheetsClient:
        if self._client is None:
            self._client = GoogleSheetsClient(self._token_source)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            spreadsheets = await client.list_spreadsheets(page_size=5)
            return {'ok': True, 'spreadsheets': len(spreadsheets)}
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

        if stream_key == 'spreadsheets':
            return await client.list_spreadsheets()

        if stream_key == 'sheets':
            spreadsheet_id = str(cfg.get('spreadsheet_id') or '')
            if not spreadsheet_id:
                raise ValueError("sheets stream requires 'spreadsheet_id' in config")
            info = await client.get_spreadsheet(spreadsheet_id)
            return info.get('sheets', [])

        if stream_key == 'rows':
            spreadsheet_id = str(cfg.get('spreadsheet_id') or '')
            range_notation = str(cfg.get('range', 'Sheet1'))
            if not spreadsheet_id:
                raise ValueError("rows stream requires 'spreadsheet_id' in config")
            values = await client.get_sheet_values(spreadsheet_id, range_notation)
            if not values:
                return []
            # First row as headers, rest as data
            headers = values[0] if values else []
            rows = []
            for row_values in values[1:]:
                row = {}
                for i, header in enumerate(headers):
                    row[header] = row_values[i] if i < len(row_values) else None
                rows.append(row)
            return rows

        raise ValueError(f"Unknown stream '{stream_key}' for gsheets connector")

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        client = await self._get_client()
        cfg = dict(config or {})

        if stream_key == 'sheets':
            spreadsheet_id = str(cfg.get('spreadsheet_id') or '')
            if not spreadsheet_id:
                raise ValueError("sheets write requires 'spreadsheet_id' in config")
            created = []
            for record in records:
                title = str(record.get('title', ''))
                if not title:
                    continue
                result = await client.create_sheet_tab(spreadsheet_id, title)
                created.append(result)
            return {'created': len(created), 'sheets': created}

        if stream_key == 'rows':
            spreadsheet_id = str(cfg.get('spreadsheet_id') or '')
            range_notation = str(cfg.get('range', 'Sheet1'))
            write_mode = str(cfg.get('write_mode', 'append'))
            if not spreadsheet_id:
                raise ValueError("rows write requires 'spreadsheet_id' in config")
            if not records:
                return {'written': 0, 'write_mode': write_mode}
            # Convert dicts to row arrays using keys from first record
            headers = list(records[0].keys())
            rows = [headers] + [[record.get(h, '') for h in headers] for record in records]
            if write_mode == 'replace':
                await client.clear_sheet(spreadsheet_id, range_notation)
                await client.update_values(spreadsheet_id, range_notation, rows)
            else:
                await client.append_rows(spreadsheet_id, range_notation, rows)
            return {'written': len(records), 'write_mode': write_mode}

        raise ValueError(f"Unknown stream '{stream_key}' for gsheets connector")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
