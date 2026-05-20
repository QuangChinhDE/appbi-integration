from __future__ import annotations

import asyncio
import mimetypes
import os
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import unquote, urljoin, urlparse

import httpx

from modules.backup.backend.extractors._helpers import sanitize_name
from modules.backup.backend.extractors.destination_writers import BackupDestinationWriter


ATTACHMENT_URL_FIELDS = (
    'ext_download',
    'src',
    'url',
    'download',
    'link',
    'download_url',
    'web_url',
    'file_url',
)
ATTACHMENT_HYPERLINK_COLUMNS = (
    'file_url',
    'url',
    'src',
    'ext_download',
    'link',
    'download',
    'download_url',
    'web_url',
    'download_final_url',
)
ATTACHMENT_DOWNLOAD_TIMEOUT = 120.0
ATTACHMENT_DOWNLOAD_ATTEMPTS = 3
MAX_PARALLEL_ATTACHMENT_DOWNLOADS = 6


def build_attachment_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=ATTACHMENT_DOWNLOAD_TIMEOUT,
        follow_redirects=True,
    )


def build_attachment_record(
    item: Mapping[str, Any],
    *,
    attachment_source: str = '',
    id_fields: Iterable[str] = ('id', 'file_id', 'hid', 'fid'),
    fid_fields: Iterable[str] = ('fid',),
    name_fields: Iterable[str] = ('name', 'file_name', 'filename', 'title'),
    size_fields: Iterable[str] = ('size', 'filesize'),
    uploaded_by_fields: Iterable[str] = ('username', 'uploaded_by', 'creator_name', 'created_by'),
    mime_type_fields: Iterable[str] = ('mime_type', 'type'),
) -> dict[str, Any]:
    normalized = dict(item or {})
    candidate_urls = dict(_build_attachment_url_candidates(normalized))

    row = {
        'attachment_source': attachment_source,
        'file_id': _pick_first(normalized, id_fields),
        'fid': _pick_first(normalized, fid_fields),
        'file_name': _pick_first(normalized, name_fields),
        'file_url': next(iter(candidate_urls.values()), ''),
        'file_size': _pick_first(normalized, size_fields),
        'uploaded_by': _pick_first(normalized, uploaded_by_fields),
        'mime_type': _pick_first(normalized, mime_type_fields),
    }
    for field in ATTACHMENT_URL_FIELDS:
        row[field] = _stringify_url_value(normalized.get(field))
    row['candidate_url_count'] = len(candidate_urls)
    row['download_status'] = ''
    row['download_source'] = ''
    row['downloaded_filename'] = ''
    row['downloaded_file_id'] = ''
    row['downloaded_size'] = ''
    row['download_final_url'] = ''
    row['download_error'] = ''
    return row


def build_attachment_dedupe_key(record: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(
        str(record.get(field) or '').strip()
        for field in (
            'attachment_source',
            'file_id',
            'fid',
            'file_name',
            'file_url',
            'url',
            'src',
            'ext_download',
            'link',
            'download',
            'download_url',
            'web_url',
        )
    )


def derive_attachment_base_urls(*base_urls: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for base_url in base_urls:
        candidate = str(base_url or '').strip()
        if not candidate:
            continue
        if candidate not in seen:
            seen.add(candidate)
            normalized.append(candidate)
        parsed = urlparse(candidate)
        if parsed.scheme and parsed.netloc:
            origin = f'{parsed.scheme}://{parsed.netloc}'
            if origin not in seen:
                seen.add(origin)
                normalized.append(origin)
    return normalized


async def download_attachment_to_destination(
    *,
    writer: BackupDestinationWriter,
    folder_id: str,
    file_record: dict[str, Any],
    http_client: httpx.AsyncClient,
    download_sem: asyncio.Semaphore,
    base_urls: Sequence[str] | None = None,
    used_names: set[str],
) -> dict[str, Any] | None:
    candidates = _resolve_attachment_url_candidates(file_record, base_urls=base_urls)
    file_record['candidate_url_count'] = len(candidates)
    if not candidates:
        file_record['download_status'] = 'missing_link'
        file_record['download_error'] = 'No downloadable URL found in attachment payload'
        return None

    errors: list[str] = []
    for source_field, url in candidates:
        if not _is_supported_download_url(url):
            continue
        for attempt in range(1, ATTACHMENT_DOWNLOAD_ATTEMPTS + 1):
            try:
                async with download_sem:
                    response = await http_client.get(url)
                response.raise_for_status()
                if _is_login_page_response(response):
                    raise ValueError('URL redirected to Base Account login page')

                content = response.content
                declared_size = _declared_attachment_size(file_record)
                if not content and declared_size != 0:
                    raise ValueError('Attachment response was empty')

                filename = _ensure_unique_filename(_guess_attachment_filename(file_record), used_names)
                mime_type = _pick_attachment_mime_type(response, filename, file_record)
                file_id = await writer.upload_bytes(folder_id, filename, content, mime_type)

                file_record['download_status'] = 'downloaded'
                file_record['download_source'] = source_field
                file_record['downloaded_filename'] = filename
                file_record['downloaded_file_id'] = file_id
                file_record['downloaded_size'] = len(content)
                file_record['download_final_url'] = str(response.url)
                file_record['download_error'] = ''
                return {
                    'file_id': file_id,
                    'filename': filename,
                    'size_bytes': len(content),
                }
            except Exception as exc:
                if attempt < ATTACHMENT_DOWNLOAD_ATTEMPTS and _is_retryable_download_error(exc):
                    await asyncio.sleep(0.25 * attempt)
                    continue
                errors.append(f'{source_field}: {_format_download_error(exc)}')
                break

    file_record['download_status'] = 'failed'
    file_record['download_error'] = ' | '.join(errors)
    return None


async def download_attachment_records(
    *,
    writer: BackupDestinationWriter,
    folder_id: str,
    records: list[dict[str, Any]],
    http_client: httpx.AsyncClient,
    download_sem: asyncio.Semaphore,
    base_urls: Sequence[str] | None = None,
    used_names: set[str] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    uploaded_files: list[dict[str, Any]] = []
    local_used_names = used_names if used_names is not None else set()
    failed_count = 0

    for record in records:
        uploaded = await download_attachment_to_destination(
            writer=writer,
            folder_id=folder_id,
            file_record=record,
            http_client=http_client,
            download_sem=download_sem,
            base_urls=base_urls,
            used_names=local_used_names,
        )
        if uploaded is None:
            failed_count += 1
            continue
        uploaded_files.append(uploaded)

    return uploaded_files, failed_count


def _pick_first(payload: Mapping[str, Any], candidates: Iterable[str]) -> str:
    for key in candidates:
        value = payload.get(key)
        if value not in (None, ''):
            return str(value).strip()
    return ''


def _stringify_url_value(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, Mapping):
        for key in ('url', 'link', 'download_url', 'web_url', 'src', 'ext_download'):
            nested = value.get(key)
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
        return ''
    if value not in (None, ''):
        return str(value).strip()
    return ''


def _build_attachment_url_candidates(record: Mapping[str, Any]) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    for field in ATTACHMENT_URL_FIELDS:
        url = _stringify_url_value(record.get(field))
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        candidates.append((field, url))
    return candidates


def _resolve_attachment_url_candidates(
    record: Mapping[str, Any],
    *,
    base_urls: Sequence[str] | None = None,
) -> list[tuple[str, str]]:
    normalized_base_urls = derive_attachment_base_urls(*(base_urls or ()))
    candidates: list[tuple[str, str]] = []
    seen_urls: set[str] = set()

    for source_field, raw_url in _build_attachment_url_candidates(record):
        if raw_url.startswith('//'):
            resolved_protocol_url = f'https:{raw_url}'
            if resolved_protocol_url not in seen_urls:
                seen_urls.add(resolved_protocol_url)
                candidates.append((source_field, resolved_protocol_url))
            continue

        if _is_supported_download_url(raw_url):
            if raw_url not in seen_urls:
                seen_urls.add(raw_url)
                candidates.append((source_field, raw_url))
            continue

        for base_url in normalized_base_urls:
            resolved_url = urljoin(base_url.rstrip('/') + '/', raw_url.lstrip('/'))
            if not _is_supported_download_url(resolved_url) or resolved_url in seen_urls:
                continue
            seen_urls.add(resolved_url)
            candidates.append((source_field, resolved_url))

    return candidates


def _guess_attachment_filename(record: Mapping[str, Any]) -> str:
    for key in ('downloaded_filename', 'file_name', 'name', 'filename', 'title'):
        candidate = sanitize_name(str(record.get(key) or '').strip())
        if candidate:
            return candidate

    for _, url in _build_attachment_url_candidates(record):
        path_name = sanitize_name(unquote(os.path.basename(urlparse(url).path)))
        if path_name:
            return path_name

    fid = sanitize_name(str(record.get('fid') or record.get('file_id') or record.get('id') or '').strip())
    if fid:
        return fid
    return 'attachment.bin'


def _ensure_unique_filename(filename: str, used_names: set[str]) -> str:
    sanitized = sanitize_name(filename) or 'attachment.bin'
    stem, ext = os.path.splitext(sanitized)
    candidate = sanitized
    lowered = candidate.lower()
    suffix = 2
    while lowered in used_names:
        candidate = f'{stem} ({suffix}){ext}'
        lowered = candidate.lower()
        suffix += 1
    used_names.add(lowered)
    return candidate


def _pick_attachment_mime_type(
    response: httpx.Response,
    filename: str,
    record: Mapping[str, Any],
) -> str:
    explicit = str(record.get('mime_type') or '').strip()
    if explicit:
        return explicit
    content_type = str(response.headers.get('content-type') or '').split(';', 1)[0].strip()
    if content_type:
        return content_type
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or 'application/octet-stream'


def _format_download_error(exc: Exception) -> str:
    message = str(exc).strip()
    if not message:
        return exc.__class__.__name__
    return f'{exc.__class__.__name__}: {message}'


def _declared_attachment_size(record: Mapping[str, Any]) -> int | None:
    for key in ('file_size', 'size', 'filesize'):
        value = record.get(key)
        if value in (None, ''):
            continue
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            continue
    return None


def _is_supported_download_url(url: str) -> bool:
    parsed = urlparse(str(url or '').strip())
    return parsed.scheme in ('http', 'https')


def _is_retryable_download_error(exc: Exception) -> bool:
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        return status_code == 429 or 500 <= status_code < 600
    if isinstance(exc, ValueError):
        message = str(exc).lower()
        return 'attachment response was empty' in message
    return False


def _is_login_page_response(response: httpx.Response) -> bool:
    content_type = str(response.headers.get('content-type') or '').lower()
    if 'text/html' not in content_type:
        return False
    final_url = str(response.url)
    body = response.text[:512].lower()
    return (
        'base account' in body
        or 'account.base.com.vn' in final_url
        or '/a/login' in final_url
    )
