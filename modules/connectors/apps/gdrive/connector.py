"""
Google Drive connector — wraps GoogleDriveClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.gdrive.common.auth import GoogleDriveCredentials
from modules.connectors.apps.gdrive.common.client import GoogleDriveClient, GoogleDriveTokenSource
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class GoogleDriveConnector(BaseConnector):
    """Connector for Google Drive — read/write drives, folders, files."""

    def __init__(self, token_source: GoogleDriveTokenSource, credentials: GoogleDriveCredentials | None = None):
        self._token_source = token_source
        self._credentials = credentials
        self._client: GoogleDriveClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('gdrive')
        assert defn is not None, "Google Drive connector not found in registry"
        return defn

    async def _get_client(self) -> GoogleDriveClient:
        if self._client is None:
            self._client = GoogleDriveClient(self._token_source)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            drives = await client.list_drives()
            return {'ok': True, 'drives': len(drives)}
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

        if stream_key == 'drives':
            return await client.list_drives()

        if stream_key == 'folders':
            parent_id = str(cfg.get('parent_id') or 'root')
            drive_id = cfg.get('drive_id')
            return await client.list_files(parent_id, drive_id=drive_id, mime_type='application/vnd.google-apps.folder')

        if stream_key == 'files':
            parent_id = str(cfg.get('parent_id') or 'root')
            drive_id = cfg.get('drive_id')
            return await client.list_files(parent_id, drive_id=drive_id)

        raise ValueError(f"Unknown stream '{stream_key}' for gdrive connector")

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        client = await self._get_client()
        cfg = dict(config or {})

        if stream_key == 'folders':
            parent_id = str(cfg.get('parent_id') or 'root')
            created = []
            for record in records:
                name = str(record.get('name', ''))
                if not name:
                    continue
                folder_id = await client.get_or_create_folder(name, parent_id, drive_id=cfg.get('drive_id'))
                created.append({'id': folder_id, 'name': name})
            return {'created': len(created), 'folders': created}

        if stream_key == 'files':
            parent_id = str(cfg.get('parent_id') or 'root')
            uploaded = []
            for record in records:
                name = str(record.get('name', ''))
                content = record.get('content', b'')
                mime_type = str(record.get('mime_type', 'application/octet-stream'))
                if not name or not content:
                    continue
                if isinstance(content, str):
                    content = content.encode('utf-8')
                file_id = await client.upload_bytes(name, content, mime_type, parent_id)
                uploaded.append({'id': file_id, 'name': name})
            return {'uploaded': len(uploaded), 'files': uploaded}

        raise ValueError(f"Unknown stream '{stream_key}' for gdrive connector")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
