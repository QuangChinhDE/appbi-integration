from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Iterable, Protocol

import pandas as pd

from modules.backup.backend.extractors._gdrive import (
    gdrive_create_folder,
    gdrive_download_bytes,
    gdrive_find_folders,
    gdrive_list_files,
    gdrive_recreate_folder,
    gdrive_upload_bytes,
    gdrive_upload_tabular_bytes,
)
from modules.backup.backend.extractors._helpers import build_excel_bytes, sanitize_name
from modules.connectors.apps.gdrive.common.constants import FOLDER_MIME


_MAX_PARALLEL_GDRIVE_MUTATIONS = 6


@dataclass(frozen=True)
class BackupDestinationConfig:
    flow_id: str
    flow_name: str | None
    destination_type: str
    root_folder_id: str
    app_folder_name: str
    drive_id: str | None = None


class BackupDestinationWriter(Protocol):
    destination_type: str

    async def prepare_app_folder(self, *, reuse_existing: bool = False) -> tuple[str, int]:
        ...

    async def create_folder(self, name: str, parent_id: str) -> str:
        ...

    def get_folder_url(self, folder_id: str) -> str:
        ...

    async def upload_excel(
        self,
        folder_id: str,
        filename: str,
        records: list[dict[str, Any]],
        *,
        hyperlink_columns: Iterable[str] | None = None,
    ) -> tuple[str, int]:
        ...

    async def upload_text(self, folder_id: str, filename: str, text: str) -> str:
        ...

    async def upload_bytes(
        self,
        folder_id: str,
        filename: str,
        content: bytes,
        mime_type: str,
    ) -> str:
        ...


class GoogleDriveBackupWriter:
    destination_type = 'gdrive'

    def __init__(self, get_token, config: BackupDestinationConfig):
        self._get_token = get_token
        self._config = config
        self._mutation_sem = asyncio.Semaphore(_MAX_PARALLEL_GDRIVE_MUTATIONS)

    async def _run_mutation(self, operation):
        async with self._mutation_sem:
            return await operation()

    async def prepare_app_folder(self, *, reuse_existing: bool = False) -> tuple[str, int]:
        app_folder_name = sanitize_name(self._config.app_folder_name)
        existing_folders = await gdrive_find_folders(
            self._get_token,
            app_folder_name,
            self._config.root_folder_id,
            drive_id=self._config.drive_id,
        )

        if len(existing_folders) > 1:
            raise ValueError(
                f'Multiple "{app_folder_name}" folders already exist in the selected Google Drive destination. '
                'Choose a clean target folder or archive the duplicates before running this backup flow.'
            )

        if existing_folders:
            manifest = await self._read_existing_manifest(existing_folders[0]['id'])
            owner_flow_id = str((manifest or {}).get('flow_id') or '').strip()
            if owner_flow_id and owner_flow_id != self._config.flow_id:
                owner_flow_name = str((manifest or {}).get('flow_name') or '').strip()
                raise ValueError(
                    f'The selected Google Drive target already contains a "{app_folder_name}" backup folder '
                    f'for flow "{owner_flow_name or owner_flow_id}". Choose a different destination folder '
                    'for this backup flow to avoid overwriting another backup.'
                )

        if reuse_existing:
            if existing_folders:
                return str(existing_folders[0]['id']), 0
            async def create_folder() -> str:
                return await gdrive_create_folder(
                    self._get_token,
                    app_folder_name,
                    self._config.root_folder_id,
                    drive_id=self._config.drive_id,
                )

            folder_id = await self._run_mutation(create_folder)
            return folder_id, 0

        async def recreate_folder() -> tuple[str, int]:
            return await gdrive_recreate_folder(
                self._get_token,
                app_folder_name,
                self._config.root_folder_id,
                drive_id=self._config.drive_id,
            )

        return await self._run_mutation(recreate_folder)

    async def create_folder(self, name: str, parent_id: str) -> str:
        async def operation() -> str:
            return await gdrive_create_folder(
                self._get_token,
                sanitize_name(name),
                parent_id,
                drive_id=self._config.drive_id,
            )

        return await self._run_mutation(operation)

    def get_folder_url(self, folder_id: str) -> str:
        return f'https://drive.google.com/drive/folders/{folder_id}'

    async def upload_excel(
        self,
        folder_id: str,
        filename: str,
        records: list[dict[str, Any]],
        *,
        hyperlink_columns: Iterable[str] | None = None,
    ) -> tuple[str, int]:
        df = pd.DataFrame(records or [])
        content = build_excel_bytes(df, hyperlink_columns=hyperlink_columns)
        async def operation() -> str:
            return await gdrive_upload_tabular_bytes(
                self._get_token,
                filename,
                content,
                folder_id,
                destination_type=self._config.destination_type,
            )

        file_id = await self._run_mutation(operation)
        return file_id, len(records or [])

    async def upload_text(self, folder_id: str, filename: str, text: str) -> str:
        async def operation() -> str:
            return await gdrive_upload_bytes(
                self._get_token,
                filename,
                text.encode('utf-8'),
                'text/plain',
                folder_id,
            )

        return await self._run_mutation(operation)

    async def upload_bytes(
        self,
        folder_id: str,
        filename: str,
        content: bytes,
        mime_type: str,
    ) -> str:
        async def operation() -> str:
            return await gdrive_upload_bytes(
                self._get_token,
                filename,
                content,
                mime_type,
                folder_id,
            )

        return await self._run_mutation(operation)

    async def _read_existing_manifest(self, app_folder_id: str) -> dict[str, Any] | None:
        common_folder = await self._find_named_child(app_folder_id, '0. Danh mục chung')
        if not common_folder or common_folder.get('mimeType') != FOLDER_MIME:
            return None

        manifest_file = await self._find_named_child(str(common_folder['id']), 'backup_manifest.json')
        if not manifest_file:
            return None

        try:
            raw_content = await gdrive_download_bytes(self._get_token, str(manifest_file['id']))
            return json.loads(raw_content.decode('utf-8'))
        except Exception:
            return None

    async def _find_named_child(self, parent_id: str, name: str) -> dict[str, Any] | None:
        items = await gdrive_list_files(
            self._get_token,
            parent_id,
            drive_id=self._config.drive_id,
            page_size=200,
        )
        for item in items:
            if str(item.get('name') or '').strip() == name:
                return item
        return None


def build_backup_destination_writer(
    *,
    destination_type: str | None,
    get_token,
    root_folder_id: str,
    drive_id: str | None,
    flow_id: str,
    flow_name: str | None,
    app_folder_name: str,
) -> BackupDestinationWriter:
    normalized_destination = str(destination_type or '').strip().lower()
    if normalized_destination != 'gdrive':
        raise ValueError(
            f'Backup currently supports Google Drive only. Destination "{destination_type}" is not implemented yet.'
        )

    return GoogleDriveBackupWriter(
        get_token,
        BackupDestinationConfig(
            flow_id=flow_id,
            flow_name=flow_name,
            destination_type=normalized_destination,
            root_folder_id=root_folder_id,
            drive_id=drive_id,
            app_folder_name=app_folder_name,
        ),
    )