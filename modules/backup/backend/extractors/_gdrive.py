"""
Google Drive standalone helpers for backup extractors.

Thin wrappers around GoogleDriveClient from the gdrive connector module.
All backup extractors import GDrive helpers from HERE instead of keeping
a duplicated copy inside each connector app.
"""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Dict, List, Optional, TypeVar, Union

import httpx

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

_GDRIVE_MUTATION_MAX_ATTEMPTS = 5
_GDRIVE_MUTATION_RETRYABLE_403_REASONS = {
    'rateLimitExceeded',
    'userRateLimitExceeded',
    'sharingRateLimitExceeded',
}

_T = TypeVar('_T')


def _extract_gdrive_error_reasons(response: httpx.Response) -> set[str]:
    try:
        payload = response.json()
    except Exception:
        return set()

    error = payload.get('error')
    if not isinstance(error, dict):
        return set()

    reasons: set[str] = set()
    details = error.get('errors')
    if isinstance(details, list):
        for item in details:
            if not isinstance(item, dict):
                continue
            reason = str(item.get('reason') or '').strip()
            if reason:
                reasons.add(reason)
    return reasons


def _is_retryable_gdrive_mutation_error(exc: httpx.HTTPStatusError) -> bool:
    status_code = exc.response.status_code
    if status_code == 429:
        return True
    if status_code != 403:
        return False
    reasons = _extract_gdrive_error_reasons(exc.response)
    return any(reason in _GDRIVE_MUTATION_RETRYABLE_403_REASONS for reason in reasons)


async def _run_gdrive_mutation_with_retry(operation: Callable[[], Awaitable[_T]]) -> _T:
    delay_seconds = 1.0
    for attempt in range(1, _GDRIVE_MUTATION_MAX_ATTEMPTS + 1):
        try:
            return await operation()
        except httpx.HTTPStatusError as exc:
            if attempt >= _GDRIVE_MUTATION_MAX_ATTEMPTS or not _is_retryable_gdrive_mutation_error(exc):
                raise
            await asyncio.sleep(delay_seconds)
            delay_seconds = min(delay_seconds * 2, 8.0)

    raise RuntimeError('unreachable')


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
    async def operation() -> str:
        async with GoogleDriveClient(token) as client:
            return await client.get_or_create_folder(name, parent_id, drive_id=drive_id)

    return await _run_gdrive_mutation_with_retry(operation)


async def gdrive_recreate_folder(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> tuple[str, int]:
    async def operation() -> tuple[str, int]:
        async with GoogleDriveClient(token) as client:
            return await client.recreate_folder(name, parent_id, drive_id=drive_id)

    return await _run_gdrive_mutation_with_retry(operation)


async def gdrive_archive_item(
    token: GoogleDriveTokenSource,
    item_id: str,
    *,
    ignore_missing: bool = False,
) -> bool:
    async def operation() -> bool:
        async with GoogleDriveClient(token) as client:
            return await client.archive_item(item_id, ignore_missing=ignore_missing)

    return await _run_gdrive_mutation_with_retry(operation)


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
    async def operation() -> str:
        async with GoogleDriveClient(token, timeout=120.0) as client:
            return await client.upload_bytes(
                filename, content, mime_type, parent_id,
                convert_to_sheet=convert_to_google_sheet,
            )

    return await _run_gdrive_mutation_with_retry(operation)


async def gdrive_upload_tabular_bytes(
    token: GoogleDriveTokenSource,
    filename: str,
    content: bytes,
    parent_id: str,
    *,
    destination_type: Optional[str] = None,
) -> str:
    async def operation() -> str:
        async with GoogleDriveClient(token, timeout=120.0) as client:
            return await client.upload_tabular_bytes(
                filename, content, parent_id,
                destination_type=destination_type,
            )

    return await _run_gdrive_mutation_with_retry(operation)
