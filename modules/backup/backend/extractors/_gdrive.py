"""
Google Drive standalone helpers for backup extractors.

Thin wrappers around GoogleDriveClient from the gdrive connector module.
All backup extractors import GDrive helpers from HERE instead of keeping
a duplicated copy inside each connector app.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from modules.connectors.apps.gdrive.common.client import (
    GoogleDriveClient,
    GoogleDriveTokenLoader,
    GoogleDriveTokenProvider,
    GoogleDriveTokenSource,
    build_cached_token_provider,
)

# Re-export types and token builder under backup-familiar names
__all__ = [
    "GoogleDriveTokenProvider",
    "GoogleDriveTokenSource",
    "build_cached_gdrive_token_provider",
    "gdrive_find_folders",
    "gdrive_find_folder",
    "gdrive_list_files",
    "gdrive_create_folder",
    "gdrive_recreate_folder",
    "gdrive_archive_item",
    "gdrive_download_bytes",
    "gdrive_upload_bytes",
    "gdrive_upload_tabular_bytes",
]

build_cached_gdrive_token_provider = build_cached_token_provider


# ── Standalone wrappers ──────────────────────────────────────────────────────
# Each wrapper creates a temporary GoogleDriveClient, which mirrors the
# original behaviour (one httpx.AsyncClient per call). The function
# signatures intentionally match the old request/backup/extractor.py API so
# the four extractor files need only import-path changes.
# ─────────────────────────────────────────────────────────────────────────────

async def gdrive_find_folders(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> List[Dict[str, str]]:
    async with GoogleDriveClient(token) as client:
        return await client.find_folders(name, parent_id, drive_id=drive_id)


async def gdrive_find_folder(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> Optional[str]:
    async with GoogleDriveClient(token) as client:
        return await client.find_folder(name, parent_id, drive_id=drive_id)


async def gdrive_list_files(
    token: GoogleDriveTokenSource,
    parent_id: str,
    *,
    drive_id: str | None = None,
    mime_type: str | None = None,
    page_size: int = 100,
) -> List[Dict[str, Any]]:
    async with GoogleDriveClient(token) as client:
        return await client.list_files(
            parent_id,
            drive_id=drive_id,
            mime_type=mime_type,
            page_size=page_size,
        )


async def gdrive_create_folder(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> str:
    async with GoogleDriveClient(token) as client:
        return await client.get_or_create_folder(name, parent_id, drive_id=drive_id)


async def gdrive_recreate_folder(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> tuple[str, int]:
    async with GoogleDriveClient(token) as client:
        return await client.recreate_folder(name, parent_id, drive_id=drive_id)


async def gdrive_archive_item(
    token: GoogleDriveTokenSource,
    item_id: str,
    *,
    ignore_missing: bool = False,
) -> bool:
    async with GoogleDriveClient(token) as client:
        return await client.archive_item(item_id, ignore_missing=ignore_missing)


async def gdrive_download_bytes(
    token: GoogleDriveTokenSource,
    file_id: str,
) -> bytes:
    async with GoogleDriveClient(token, timeout=120.0) as client:
        return await client.download_bytes(file_id)


async def gdrive_upload_bytes(
    token: GoogleDriveTokenSource,
    filename: str,
    content: bytes,
    mime_type: str,
    parent_id: str,
    *,
    convert_to_google_sheet: bool = False,
) -> str:
    async with GoogleDriveClient(token, timeout=120.0) as client:
        return await client.upload_bytes(
            filename, content, mime_type, parent_id,
            convert_to_sheet=convert_to_google_sheet,
        )


async def gdrive_upload_tabular_bytes(
    token: GoogleDriveTokenSource,
    filename: str,
    content: bytes,
    parent_id: str,
    *,
    destination_type: Optional[str] = None,
) -> str:
    async with GoogleDriveClient(token, timeout=120.0) as client:
        return await client.upload_tabular_bytes(
            filename, content, parent_id,
            destination_type=destination_type,
        )
