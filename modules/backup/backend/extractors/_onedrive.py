"""OneDrive standalone helpers for backup extractors."""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Optional, TypeVar

import httpx

from modules.connectors.apps.onedrive.common.client import (
    OneDriveClient,
    OneDriveTokenLoader,
    OneDriveTokenProvider,
    OneDriveTokenSource,
    build_cached_token_provider,
)

__all__ = [
    "OneDriveTokenProvider",
    "OneDriveTokenSource",
    "build_cached_onedrive_token_provider",
    "onedrive_find_folders",
    "onedrive_find_folder",
    "onedrive_list_files",
    "onedrive_create_folder",
    "onedrive_recreate_folder",
    "onedrive_archive_item",
    "onedrive_download_bytes",
    "onedrive_upload_bytes",
    "onedrive_upload_tabular_bytes",
]

build_cached_onedrive_token_provider = build_cached_token_provider

_ONEDRIVE_MUTATION_MAX_ATTEMPTS = 5
_T = TypeVar("_T")


def _is_retryable_onedrive_mutation_error(exc: httpx.HTTPStatusError) -> bool:
    return exc.response.status_code in {429, 500, 502, 503, 504}


async def _run_onedrive_mutation_with_retry(operation: Callable[[], Awaitable[_T]]) -> _T:
    delay_seconds = 1.0
    for attempt in range(1, _ONEDRIVE_MUTATION_MAX_ATTEMPTS + 1):
        try:
            return await operation()
        except httpx.HTTPStatusError as exc:
            if attempt >= _ONEDRIVE_MUTATION_MAX_ATTEMPTS or not _is_retryable_onedrive_mutation_error(exc):
                raise
            await asyncio.sleep(delay_seconds)
            delay_seconds = min(delay_seconds * 2, 8.0)

    raise RuntimeError("unreachable")


async def onedrive_find_folders(
    token: OneDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> list[dict[str, str]]:
    async with OneDriveClient(token) as client:
        return await client.find_folders(name, parent_id, drive_id=drive_id)


async def onedrive_find_folder(
    token: OneDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> Optional[str]:
    async with OneDriveClient(token) as client:
        return await client.find_folder(name, parent_id, drive_id=drive_id)


async def onedrive_list_files(
    token: OneDriveTokenSource,
    parent_id: str,
    *,
    drive_id: str | None = None,
    mime_type: str | None = None,
    page_size: int = 100,
) -> list[dict[str, Any]]:
    async with OneDriveClient(token) as client:
        return await client.list_files(
            parent_id,
            drive_id=drive_id,
            mime_type=mime_type,
            page_size=page_size,
        )


async def onedrive_create_folder(
    token: OneDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> str:
    async def operation() -> str:
        async with OneDriveClient(token) as client:
            return await client.get_or_create_folder(name, parent_id, drive_id=drive_id)

    return await _run_onedrive_mutation_with_retry(operation)


async def onedrive_recreate_folder(
    token: OneDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> tuple[str, int]:
    async def operation() -> tuple[str, int]:
        async with OneDriveClient(token) as client:
            return await client.recreate_folder(name, parent_id, drive_id=drive_id)

    return await _run_onedrive_mutation_with_retry(operation)


async def onedrive_archive_item(
    token: OneDriveTokenSource,
    item_id: str,
    *,
    drive_id: str | None = None,
    ignore_missing: bool = False,
) -> bool:
    async def operation() -> bool:
        async with OneDriveClient(token) as client:
            return await client.archive_item(item_id, ignore_missing=ignore_missing, drive_id=drive_id)

    return await _run_onedrive_mutation_with_retry(operation)


async def onedrive_download_bytes(
    token: OneDriveTokenSource,
    file_id: str,
    *,
    drive_id: str | None = None,
) -> bytes:
    async with OneDriveClient(token, timeout=120.0) as client:
        return await client.download_bytes(file_id, drive_id=drive_id)


async def onedrive_upload_bytes(
    token: OneDriveTokenSource,
    filename: str,
    content: bytes,
    mime_type: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> str:
    async def operation() -> str:
        async with OneDriveClient(token, timeout=120.0) as client:
            return await client.upload_bytes(
                filename,
                content,
                mime_type,
                parent_id,
                drive_id=drive_id,
            )

    return await _run_onedrive_mutation_with_retry(operation)


async def onedrive_upload_tabular_bytes(
    token: OneDriveTokenSource,
    filename: str,
    content: bytes,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> str:
    async def operation() -> str:
        async with OneDriveClient(token, timeout=120.0) as client:
            return await client.upload_tabular_bytes(
                filename,
                content,
                parent_id,
                drive_id=drive_id,
            )

    return await _run_onedrive_mutation_with_retry(operation)

