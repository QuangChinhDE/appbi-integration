"""
Workflow-specific backup extractor.

Produces the hierarchical folder structure:

    Base Workflow/
    ├── Workflows/
    │   └── [ID] Workflow Name/
    │       ├── 0. Hướng dẫn/
    │       │   └── README.txt
    │       ├── 1. Cấu hình workflow/
    │       │   ├── Thông tin workflow.xlsx
    │       │   └── Danh sách stage.xlsx
    │       ├── 2. Danh sách công việc/
    │       │   └── Danh sách job.xlsx
    │       └── 3. Jobs/
    │           └── [ID] Job Name/
    │               ├── 1. Thông tin/
    │               │   ├── Thông tin job.xlsx
    │               │   ├── Thông tin job log.xlsx
    │               │   └── Thông tin job moves.xlsx
    │               ├── 2. Dữ liệu nhập/
    │               │   ├── custom_fields.xlsx
    │               │   ├── input table.xlsx
    │               │   ├── input table kèm base table.xlsx
    │               │   └── select master.xlsx
    │               ├── 3. Nội dung/
    │               │   └── post_and_comment.txt
    │               └── 4. Tệp đính kèm/
    │                   └── Thông tin files.xlsx
    ├── 0. Danh mục chung/
    │   ├── Danh sách workflow.xlsx
    │   └── backup_manifest.json
"""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
from datetime import datetime
from typing import Any
from urllib.parse import unquote, urlparse

import httpx

from modules.backup.backend.extractors._helpers import (
    sanitize_name,
    strip_html,
    truncate_name,
    ts_to_str,
)
from modules.backup.backend.extractors._gdrive import build_cached_gdrive_token_provider
from modules.backup.backend.extractors.destination_writers import (
    BackupDestinationWriter,
    build_backup_destination_writer,
)
from modules.connectors.apps.workflow.common.auth import WorkflowCredentials
from modules.connectors.apps.workflow.common.client import WorkflowManagementClient
from modules.connectors.backend.shared.runtime import ConnectorRuntimeService
from modules.connectors.backend.shared.validation import ConnectorBindingValidationService
from modules.credentials.backend.services.google_auth_service import (
    GoogleAuthService,
    validate_service_account_drive_destination,
)
from packages.database.src import async_session
from packages.database.src.models import BackupFlow, BackupFlowRun

logger = logging.getLogger(__name__)

# ── Helpers ──────────────────────────────────────────────────────────────────

_NAME_FIELDS = ('name', 'title', 'display_name', 'label')
_ID_FIELDS = ('workflow_id', 'id')
_JOB_ID_FIELDS = ('job_id', 'id', 'hid')
_JOB_NAME_FIELDS = ('name', 'title', 'code')
_DETAIL_FOLDER_LINK_FIELD = 'Link thư mục chi tiết'
_ATTACHMENT_URL_FIELDS = ('ext_download', 'src', 'url', 'download', 'link')
_MAX_PARALLEL_WORKFLOWS = 5
_MAX_PARALLEL_JOBS = 20
_MAX_PARALLEL_ATTACHMENT_DOWNLOADS = 6
_ATTACHMENT_DOWNLOAD_TIMEOUT = 120.0
_ATTACHMENT_DOWNLOAD_ATTEMPTS = 3
_MAX_RECORDED_ISSUES = 20


def _pick_id(record: dict, candidates: tuple[str, ...]) -> str:
    for key in candidates:
        val = record.get(key)
        if val not in (None, ''):
            return str(val)
    return ''


def _pick_name(record: dict, candidates: tuple[str, ...] = _NAME_FIELDS) -> str:
    for key in candidates:
        val = record.get(key)
        if val and str(val).strip():
            return str(val).strip()
    return ''


def _build_readme(workflow: dict) -> str:
    wf_id = _pick_id(workflow, _ID_FIELDS)
    wf_name = _pick_name(workflow)
    lines = [
        f"Workflow: {wf_name}",
        f"ID: {wf_id}",
        "",
        "Cấu trúc thư mục:",
        "  0. Hướng dẫn      — File README này",
        "  1. Cấu hình workflow — Thông tin workflow và danh sách stage",
        "  2. Danh sách công việc — Tổng hợp danh sách job",
        "  3. Jobs           — Chi tiết từng job (thông tin, dữ liệu nhập, nội dung, tệp đính kèm)",
        "",
        f"Thời gian backup: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC",
    ]
    return "\n".join(lines)


def _flatten_custom_fields(job_detail: dict) -> list[dict]:
    """Extract custom field values from job detail into a flat table."""
    form = job_detail.get('form') or job_detail.get('custom_fields') or []
    if not isinstance(form, list):
        return []
    rows = []
    for field in form:
        if not isinstance(field, dict):
            continue
        rows.append({
            'field_name': field.get('label') or field.get('name') or '',
            'field_type': field.get('type') or '',
            'value': str(field.get('value') or field.get('selected') or ''),
        })
    return rows


def _extract_input_tables(job_detail: dict) -> list[dict]:
    """Extract input-table type fields from job form."""
    form = job_detail.get('form') or job_detail.get('custom_fields') or []
    if not isinstance(form, list):
        return []
    rows = []
    for field in form:
        if not isinstance(field, dict):
            continue
        if field.get('type') == 'input-table':
            value = field.get('value')
            if isinstance(value, list):
                for row_data in value:
                    if isinstance(row_data, dict):
                        rows.append({'table_label': field.get('label') or '', **row_data})
            elif isinstance(value, dict):
                rows.append({'table_label': field.get('label') or '', **value})
    return rows


def _extract_input_tables_with_base(job_detail: dict) -> list[dict]:
    """Extract input-table fields paired with their base-table schemas."""
    form = job_detail.get('form') or job_detail.get('custom_fields') or []
    if not isinstance(form, list):
        return []
    rows = []
    for field in form:
        if not isinstance(field, dict):
            continue
        if field.get('type') == 'input-table':
            columns = field.get('columns') or field.get('fields') or []
            value = field.get('value')
            if isinstance(value, list):
                for row_data in value:
                    if isinstance(row_data, dict):
                        rows.append({
                            'table_label': field.get('label') or '',
                            'columns_schema': json.dumps(columns, ensure_ascii=False) if columns else '',
                            **row_data,
                        })
    return rows


def _extract_select_masters(job_detail: dict) -> list[dict]:
    """Extract select-master type fields from job form."""
    form = job_detail.get('form') or job_detail.get('custom_fields') or []
    if not isinstance(form, list):
        return []
    rows = []
    for field in form:
        if not isinstance(field, dict):
            continue
        if field.get('type') == 'select-master':
            value = field.get('value') or field.get('selected')
            rows.append({
                'field_label': field.get('label') or '',
                'selected_value': str(value) if value else '',
            })
    return rows


def _build_posts_text(posts: list[dict], all_comments: dict[str, list[dict]]) -> str:
    """Combine posts and their comments into a single text document."""
    lines: list[str] = []
    for post in posts:
        post_id = _pick_id(post, ('hid', 'id', 'post_id'))
        author = post.get('username') or post.get('author') or ''
        content = strip_html(str(post.get('content') or post.get('body') or ''))
        created = post.get('created_at') or post.get('created') or ''
        if isinstance(created, (int, float)):
            created = ts_to_str(created)

        lines.append(f"--- Post {post_id} ---")
        lines.append(f"Tác giả: {author}")
        lines.append(f"Thời gian: {created}")
        lines.append(content or "(không có nội dung)")
        lines.append("")

        comments = all_comments.get(post_id, [])
        for comment in comments:
            c_author = comment.get('username') or comment.get('author') or ''
            c_content = strip_html(str(comment.get('content') or comment.get('body') or ''))
            c_created = comment.get('created_at') or comment.get('created') or ''
            if isinstance(c_created, (int, float)):
                c_created = ts_to_str(c_created)
            lines.append(f"  > Bình luận bởi {c_author} lúc {c_created}")
            lines.append(f"    {c_content}")
            lines.append("")

        lines.append("")
    return "\n".join(lines) or "(không có bài viết)"


def _looks_like_attachment_record(record: dict[str, Any]) -> bool:
    if not isinstance(record, dict):
        return False
    if any(str(record.get(field) or '').strip() for field in _ATTACHMENT_URL_FIELDS):
        return True
    file_id = str(record.get('fid') or record.get('file_id') or '').strip()
    file_name = _pick_name(record, ('name', 'file_name', 'filename', 'title'))
    return bool(file_id and file_name)


def _attachment_record_key(record: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        str(record.get(field) or '').strip()
        for field in ('id', 'fid', 'name', 'url', 'src', 'ext_download', 'link', 'download')
    )


def _collect_job_file_entries(job_detail: dict) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, ...]] = set()

    def _collect(source: str, value: Any) -> None:
        if isinstance(value, dict):
            items = [value]
        elif isinstance(value, list):
            items = value
        else:
            return
        for item in items:
            if not isinstance(item, dict) or not _looks_like_attachment_record(item):
                continue
            entry_key = _attachment_record_key(item)
            if entry_key in seen:
                continue
            seen.add(entry_key)
            entry = dict(item)
            entry['_attachment_source'] = source
            entries.append(entry)

    _collect('files', job_detail.get('files'))
    _collect('attachment', job_detail.get('attachment'))
    _collect('attachments', job_detail.get('attachments'))

    logs = job_detail.get('logs')
    if isinstance(logs, list):
        for index, log in enumerate(logs):
            if not isinstance(log, dict):
                continue
            _collect(f'logs[{index}].attachment', log.get('attachment'))
            data = log.get('data')
            if isinstance(data, dict):
                _collect(f'logs[{index}].data.attachment', data.get('attachment'))

    return entries


def _build_attachment_url_candidates(record: dict[str, Any]) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    for field in _ATTACHMENT_URL_FIELDS:
        url = str(record.get(field) or '').strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        candidates.append((field, url))
    return candidates


def _guess_attachment_filename(record: dict[str, Any]) -> str:
    for key in ('name', 'file_name', 'filename', 'title'):
        candidate = sanitize_name(str(record.get(key) or '').strip())
        if candidate:
            return candidate

    for _, url in _build_attachment_url_candidates(record):
        path_name = sanitize_name(unquote(os.path.basename(urlparse(url).path)))
        if path_name:
            return path_name

    fid = sanitize_name(str(record.get('fid') or record.get('id') or '').strip())
    if fid:
        return fid
    return 'attachment.bin'


def _ensure_unique_filename(filename: str, used_names: set[str]) -> str:
    sanitized = sanitize_name(filename) or 'attachment.bin'
    stem, ext = os.path.splitext(sanitized)
    candidate = sanitized
    suffix = 2
    lowered = candidate.lower()
    while lowered in used_names:
        candidate = f'{stem} ({suffix}){ext}'
        lowered = candidate.lower()
        suffix += 1
    used_names.add(lowered)
    return candidate


def _is_login_page_response(response: httpx.Response) -> bool:
    content_type = str(response.headers.get('content-type') or '').lower()
    if 'text/html' not in content_type:
        return False
    final_url = str(response.url)
    body = response.text[:512]
    return (
        'Đăng nhập - Base Account' in body
        or 'base account' in body.lower()
        or 'account.base.com.vn' in final_url
        or '/a/login' in final_url
    )


def _pick_attachment_mime_type(response: httpx.Response, filename: str) -> str:
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


def _declared_attachment_size(record: dict[str, Any]) -> int | None:
    value = record.get('size')
    if value in (None, ''):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
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


async def _download_attachment_to_destination(
    *,
    writer: BackupDestinationWriter,
    folder_id: str,
    file_record: dict[str, Any],
    http_client: httpx.AsyncClient,
    download_sem: asyncio.Semaphore,
    used_names: set[str],
) -> dict[str, Any] | None:
    candidates = _build_attachment_url_candidates(file_record)
    file_record['candidate_url_count'] = len(candidates)
    if not candidates:
        file_record['download_status'] = 'missing_link'
        file_record['download_error'] = 'No downloadable URL found in attachment payload'
        return None

    errors: list[str] = []
    for source_field, url in candidates:
        if not _is_supported_download_url(url):
            continue
        for attempt in range(1, _ATTACHMENT_DOWNLOAD_ATTEMPTS + 1):
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
                mime_type = _pick_attachment_mime_type(response, filename)
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
                if attempt < _ATTACHMENT_DOWNLOAD_ATTEMPTS and _is_retryable_download_error(exc):
                    await asyncio.sleep(0.25 * attempt)
                    continue
                errors.append(f'{source_field}: {_format_download_error(exc)}')
                break

    file_record['download_status'] = 'failed'
    file_record['download_error'] = ' | '.join(errors)
    return None


def _build_attachment_rows(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for f in entries:
        file_urls = dict(_build_attachment_url_candidates(f))
        rows.append({
            'attachment_source': f.get('_attachment_source') or '',
            'file_id': f.get('id') or f.get('file_id') or '',
            'fid': f.get('fid') or '',
            'file_name': f.get('name') or f.get('file_name') or f.get('filename') or '',
            'file_url': next(iter(file_urls.values()), ''),
            'file_size': f.get('size') or '',
            'uploaded_by': f.get('username') or f.get('uploaded_by') or '',
            'url': f.get('url') or '',
            'src': f.get('src') or '',
            'ext_download': f.get('ext_download') or '',
            'link': f.get('link') or '',
            'download': f.get('download') or '',
            'candidate_url_count': len(file_urls),
            'download_status': '',
            'download_source': '',
            'downloaded_filename': '',
            'downloaded_file_id': '',
            'downloaded_size': '',
            'download_final_url': '',
            'download_error': '',
        })
    return rows


def _extract_job_files(job_detail: dict) -> list[dict]:
    """Extract file/attachment info from job detail."""
    return _build_attachment_rows(_collect_job_file_entries(job_detail))


def _extract_post_comment_files(posts: list[dict[str, Any]], all_comments: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, ...]] = set()

    def _append_entries(prefix: str, payload: dict[str, Any]) -> None:
        for entry in _collect_job_file_entries(payload):
            source = f'{prefix}.{entry.get("_attachment_source") or "attachment"}'
            dedupe_key = (source, *_attachment_record_key(entry))
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            copied_entry = dict(entry)
            copied_entry['_attachment_source'] = source
            entries.append(copied_entry)

    for post in posts:
        post_id = _pick_id(post, ('hid', 'id', 'post_id')) or 'unknown'
        _append_entries(f'post[{post_id}]', post)
        for comment_index, comment in enumerate(all_comments.get(post_id, []), start=1):
            comment_id = _pick_id(comment, ('id', 'comment_id', 'hid')) or str(comment_index)
            _append_entries(f'post[{post_id}].comment[{comment_id}]', comment)

    return _build_attachment_rows(entries)


def _extract_job_log(job_detail: dict) -> list[dict]:
    """Extract activity log entries from job detail."""
    logs = job_detail.get('logs') or job_detail.get('activity_log') or job_detail.get('history') or []
    if not isinstance(logs, list):
        return []
    rows = []
    for entry in logs:
        if not isinstance(entry, dict):
            continue
        rows.append({
            'action': entry.get('action') or entry.get('type') or '',
            'username': entry.get('username') or entry.get('user') or '',
            'content': strip_html(str(entry.get('content') or entry.get('description') or '')),
            'created_at': ts_to_str(entry.get('created_at') or entry.get('created') or ''),
        })
    return rows


def _extract_job_moves(job_detail: dict) -> list[dict]:
    """Extract stage transition history from job detail."""
    moves = job_detail.get('moves') or job_detail.get('stage_history') or job_detail.get('transitions') or []
    if not isinstance(moves, list):
        return []
    rows = []
    for move in moves:
        if not isinstance(move, dict):
            continue
        rows.append({
            'from_stage': move.get('from_stage') or move.get('from') or '',
            'to_stage': move.get('to_stage') or move.get('to') or '',
            'moved_by': move.get('username') or move.get('mover') or '',
            'moved_at': ts_to_str(move.get('created_at') or move.get('moved_at') or ''),
        })
    return rows


def _normalize_retry_job_map(value: Any) -> dict[str, set[str]]:
    if not isinstance(value, dict):
        return {}

    output: dict[str, set[str]] = {}
    for workflow_id, job_ids in value.items():
        normalized_workflow_id = str(workflow_id or '').strip()
        if not normalized_workflow_id:
            continue

        if isinstance(job_ids, str):
            normalized_job_ids = {job_ids.strip()} if job_ids.strip() else set()
        elif isinstance(job_ids, (list, tuple, set)):
            normalized_job_ids = {
                str(job_id).strip()
                for job_id in job_ids
                if str(job_id).strip()
            }
        else:
            normalized_job_ids = set()

        output[normalized_workflow_id] = normalized_job_ids

    return output


def _build_retry_run_label(source_run_id: str | None) -> str:
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    source_suffix = sanitize_name(str(source_run_id or '').strip()[:8]) or 'unknown'
    return f'run-lai-loi-{timestamp}-tu-{source_suffix}'


def _build_issue(stage: str, error: str, **extra: Any) -> dict[str, Any]:
    issue = {
        'stage': str(stage or '').strip() or 'unknown',
        'error': str(error or '').strip() or 'Unknown error',
    }
    for key, value in extra.items():
        if value in (None, '', [], {}):
            continue
        issue[key] = value
    return issue


def _compact_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(issues) <= _MAX_RECORDED_ISSUES:
        return issues
    remaining = len(issues) - _MAX_RECORDED_ISSUES
    return issues[:_MAX_RECORDED_ISSUES] + [
        _build_issue('truncated', f'{remaining} additional issue(s) omitted from the stored summary')
    ]


def _coerce_custom_table_rows(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        rows: list[dict[str, Any]] = []
        for item in value:
            if isinstance(item, dict):
                rows.append(dict(item))
            elif item not in (None, ''):
                rows.append({'value': item})
        return rows

    if isinstance(value, dict):
        for key in ('rows', 'data', 'items', 'list'):
            nested = value.get(key)
            if isinstance(nested, list):
                return _coerce_custom_table_rows(nested)
        return [dict(value)] if value else []

    if value not in (None, ''):
        return [{'value': value}]
    return []


def _extract_custom_table_sheets(raw_custom_table: Any) -> dict[str, list[dict[str, Any]]]:
    payload = raw_custom_table
    if isinstance(payload, dict) and isinstance(payload.get('custom_table'), dict):
        payload = payload.get('custom_table')

    if not isinstance(payload, dict):
        return {}

    output: dict[str, list[dict[str, Any]]] = {}
    for table_name, table_value in payload.items():
        rows = _coerce_custom_table_rows(table_value)
        if not rows:
            continue
        normalized_name = sanitize_name(str(table_name or '').strip()) or 'custom_table'
        output[normalized_name] = rows
    return output


# ── Log updater ──────────────────────────────────────────────────────────────


async def _update_log(db, run: BackupFlowRun, message: str) -> None:
    """Append a timestamped line to the run log and commit."""
    ts = datetime.utcnow().strftime('%H:%M:%S')
    run.logs = f"{run.logs or ''}\n[{ts}] {message}".strip()
    await db.commit()


# ── Upload helpers ───────────────────────────────────────────────────────────
# ── Main runner ──────────────────────────────────────────────────────────────


async def run_workflow_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        flow = await db.get(BackupFlow, flow_id)
        run = await db.get(BackupFlowRun, run_id)
        if flow is None or run is None:
            return

        client: WorkflowManagementClient | None = None
        attachment_http_client: httpx.AsyncClient | None = None
        try:
            # ── Bootstrap ────────────────────────────────────────────
            runtime_service = ConnectorRuntimeService(db)
            source_binding = await runtime_service.get_binding_for_credential_id(
                flow.source_credential_id,
            )
            destination_binding = await runtime_service.get_binding_for_credential_id(
                flow.destination_credential_id,
                overrides_config=dict(flow.destination_target or {}),
            )

            ConnectorBindingValidationService.validate_destination_app_id(
                destination_binding.credential.app_id,
                module_key='backup',
                pipeline_destination_only=False,
            )

            run.status = 'running'
            run.logs = '[RUNNING] Starting Workflow backup'
            await db.commit()

            destination_auth = {**destination_binding.auth, **destination_binding.config}
            validate_service_account_drive_destination(destination_auth)

            google_auth_service = GoogleAuthService(db)

            async def load_gdrive_token(force_refresh: bool = False):
                return await google_auth_service.get_destination_access_token_details(
                    destination_auth, force_refresh=force_refresh,
                )

            get_token = build_cached_gdrive_token_provider(load_gdrive_token)

            root_folder_id = (
                destination_auth.get('folder_id')
                or destination_auth.get('drive_id')
                or 'root'
            )
            drive_id = destination_auth.get('drive_id')
            dest_type = destination_binding.credential.app_id
            writer: BackupDestinationWriter = build_backup_destination_writer(
                destination_type=dest_type,
                get_token=get_token,
                root_folder_id=root_folder_id,
                drive_id=drive_id,
                flow_id=str(flow.id),
                flow_name=flow.name,
                app_folder_name='Base Workflow',
            )

            # Build Workflow API client
            domain = source_binding.auth.get('domain') or source_binding.config.get('domain') or ''
            access_token = source_binding.auth.get('access_token') or source_binding.config.get('access_token') or ''
            credentials = WorkflowCredentials(domain=domain, access_token=access_token)
            client = WorkflowManagementClient(credentials)

            structure = dict(flow.structure or {})
            selected_objects = structure.get('objects') or ['workflow', 'job']
            workflow_ids = structure.get('workflow_ids') or []
            backup_type = flow.backup_type or 'all'
            requested_execution_details = dict(run.execution_details or {})
            retry_failed_only = bool(requested_execution_details.get('retry_failed_only'))
            retry_source_run_id = str(requested_execution_details.get('retry_source_run_id') or '').strip() or None
            retry_context = dict(requested_execution_details.get('retry_context') or {})
            retry_job_ids_by_workflow = _normalize_retry_job_map(retry_context.get('job_ids_by_workflow'))
            retry_workflow_ids = {
                str(workflow_id).strip()
                for workflow_id in retry_context.get('workflow_ids') or []
                if str(workflow_id).strip()
            }
            retry_workflow_ids.update(retry_job_ids_by_workflow.keys())

            include_workflows = any(o in selected_objects for o in ('workflow', 'workflows'))
            include_jobs = any(o in selected_objects for o in ('job', 'jobs'))
            include_workflow_context = include_workflows or include_jobs

            uploaded_files: list[dict[str, Any]] = []
            manifest_entries: list[dict[str, Any]] = []
            workflow_folder_urls: dict[str, str] = {}
            failed_workflows: list[dict[str, Any]] = []
            failed_jobs: list[dict[str, Any]] = []
            attachment_download_sem = asyncio.Semaphore(_MAX_PARALLEL_ATTACHMENT_DOWNLOADS)
            attachment_http_client = httpx.AsyncClient(
                timeout=_ATTACHMENT_DOWNLOAD_TIMEOUT,
                follow_redirects=True,
            )

            # ── Trash old folder and create fresh ────────────────────
            log_lock = asyncio.Lock()

            async def log_message(message: str) -> None:
                async with log_lock:
                    await _update_log(db, run, message)

            def build_output_path(relative_path: str) -> str:
                cleaned = str(relative_path or '').lstrip('/').strip()
                if not cleaned:
                    return ''
                return f'{run_path_prefix}{cleaned}' if run_path_prefix else cleaned

            await log_message('Preparing destination folder...')

            app_folder_name = sanitize_name('Base Workflow')
            app_folder_id, archived_count = await writer.prepare_app_folder(reuse_existing=retry_failed_only)
            if archived_count:
                await log_message(f'Archived {archived_count} old "{app_folder_name}" folder(s)')

            run_root_folder_id = app_folder_id
            run_path_prefix = ''
            if retry_failed_only:
                retry_parent_folder_id = await writer.create_folder('9. Retry lỗi', app_folder_id)
                retry_run_name = _build_retry_run_label(retry_source_run_id)
                run_root_folder_id = await writer.create_folder(retry_run_name, retry_parent_folder_id)
                run_path_prefix = f'9. Retry lỗi/{retry_run_name}/'
                await log_message(
                    f'Retrying failed workflow items from run {retry_source_run_id or "unknown"} into "{retry_run_name}"...'
                )

            # ── Fetch all workflows ──────────────────────────────────
            await log_message('Fetching all workflows...')
            all_workflows = await client.get_all_workflows()
            await log_message(f'Found {len(all_workflows)} workflow(s)')

            if workflow_ids:
                workflow_id_set = set(str(wid) for wid in workflow_ids)
                selected_workflows = [
                    w for w in all_workflows
                    if _pick_id(w, _ID_FIELDS) in workflow_id_set
                ]
            else:
                selected_workflows = all_workflows

            if retry_failed_only:
                selected_workflows = [
                    workflow for workflow in selected_workflows
                    if _pick_id(workflow, _ID_FIELDS) in retry_workflow_ids
                ]
                if not selected_workflows:
                    raise ValueError('Retry mode could not find any failed workflows/jobs that match the current flow selection.')

            await log_message(
                f'Will {"retry" if retry_failed_only else "backup"} {len(selected_workflows)} selected workflow(s)'
            )

            # ── 0. Danh mục chung ────────────────────────────────────
            await log_message('Creating "0. Danh mục chung"...')
            common_folder_id = await writer.create_folder('0. Danh mục chung', run_root_folder_id)

            # ── Workflows/ ───────────────────────────────────────────
            workflows_folder_id = await writer.create_folder('Workflows', run_root_folder_id)

            total = len(selected_workflows)
            workflow_sem = asyncio.Semaphore(min(_MAX_PARALLEL_WORKFLOWS, total or 1))

            async def initialize_workflow(wf_index: int, workflow: dict[str, Any]) -> dict[str, Any]:
                async with workflow_sem:
                    wf_uploaded_files: list[dict[str, Any]] = []
                    wf_id = _pick_id(workflow, _ID_FIELDS)
                    wf_name = _pick_name(workflow)
                    wf_label = sanitize_name(f'[{wf_id}] {truncate_name(wf_name)}')
                    await log_message(f'[{wf_index}/{total}] Initializing workflow "{wf_name}" (ID: {wf_id})...')

                    wf_folder_id = await writer.create_folder(wf_label, workflows_folder_id)
                    workflow_folder_url = writer.get_folder_url(wf_folder_id)

                    guide_folder_id = await writer.create_folder('0. Hướng dẫn', wf_folder_id)
                    readme_text = _build_readme(workflow)
                    fid = await writer.upload_text(guide_folder_id, 'README.txt', readme_text)
                    wf_uploaded_files.append({
                        'path': build_output_path(f'Workflows/{wf_label}/0. Hướng dẫn/README.txt'),
                        'file_id': fid,
                    })

                    return {
                        'workflow_index': wf_index,
                        'workflow': workflow,
                        'workflow_id': wf_id,
                        'workflow_name': wf_name,
                        'workflow_label': wf_label,
                        'workflow_folder_id': wf_folder_id,
                        'workflow_folder_url': workflow_folder_url,
                        'config_folder_id': (
                            await writer.create_folder('1. Cấu hình workflow', wf_folder_id)
                            if include_workflow_context else None
                        ),
                        'jobs_list_folder_id': (
                            await writer.create_folder('2. Danh sách công việc', wf_folder_id)
                            if include_jobs else None
                        ),
                        'jobs_parent_folder_id': (
                            await writer.create_folder('3. Jobs', wf_folder_id)
                            if include_jobs else None
                        ),
                        'uploaded_files': wf_uploaded_files,
                    }

            initialized_workflows: list[dict[str, Any]] = []
            if selected_workflows:
                initialized_workflows = await asyncio.gather(*(
                    initialize_workflow(wf_index, workflow)
                    for wf_index, workflow in enumerate(selected_workflows, 1)
                ))

            for initialized_workflow in sorted(initialized_workflows, key=lambda item: item['workflow_index']):
                workflow_folder_urls[initialized_workflow['workflow_id']] = initialized_workflow['workflow_folder_url']
                uploaded_files.extend(initialized_workflow['uploaded_files'])

            workflow_catalog_source = selected_workflows if retry_failed_only else all_workflows
            workflow_rows_with_links = []
            for workflow in workflow_catalog_source:
                workflow_row = dict(workflow)
                workflow_row[_DETAIL_FOLDER_LINK_FIELD] = workflow_folder_urls.get(_pick_id(workflow, _ID_FIELDS), '')
                workflow_rows_with_links.append(workflow_row)
            fid, cnt = await writer.upload_excel(
                common_folder_id,
                'Danh sách workflow.xlsx',
                workflow_rows_with_links,
                hyperlink_columns=(_DETAIL_FOLDER_LINK_FIELD,),
            )
            uploaded_files.append({
                'path': build_output_path('0. Danh mục chung/Danh sách workflow.xlsx'),
                'file_id': fid, 'record_count': cnt,
            })

            async def process_workflow(initialized_workflow: dict[str, Any]) -> dict[str, Any]:
                async with workflow_sem:
                    wf_uploaded_files: list[dict[str, Any]] = []
                    workflow = initialized_workflow['workflow']
                    wf_index = initialized_workflow['workflow_index']
                    wf_id = initialized_workflow['workflow_id']
                    wf_name = initialized_workflow['workflow_name']
                    wf_label = initialized_workflow['workflow_label']
                    config_folder_id = initialized_workflow['config_folder_id']
                    jobs_list_folder_id = initialized_workflow['jobs_list_folder_id']
                    jobs_parent_folder_id = initialized_workflow['jobs_parent_folder_id']
                    workflow_issues: list[dict[str, Any]] = []

                    await log_message(f'[{wf_index}/{total}] Processing workflow details "{wf_name}" (ID: {wf_id})...')

                    manifest_wf: dict[str, Any] = {
                        'workflow_id': wf_id,
                        'workflow_name': wf_name,
                        'folder': wf_label,
                        'status': 'completed',
                        'jobs': [],
                    }
                    try:
                        if include_workflow_context and config_folder_id is not None:
                            try:
                                wf_detail = await client.get_workflow(wf_id)
                            except Exception as exc:
                                workflow_issues.append(_build_issue('workflow_detail', str(exc)))
                                wf_detail = workflow
                            fid, cnt = await writer.upload_excel(config_folder_id, 'Thông tin workflow.xlsx', [wf_detail])
                            wf_uploaded_files.append({
                                'path': build_output_path(f'Workflows/{wf_label}/1. Cấu hình workflow/Thông tin workflow.xlsx'),
                                'file_id': fid, 'record_count': cnt,
                            })

                            try:
                                stages = await client.get_workflow_stages(wf_id)
                            except Exception as exc:
                                workflow_issues.append(_build_issue('workflow_stages', str(exc)))
                                logger.warning('Failed to load stages for workflow %s: %s', wf_id, exc)
                                stages = []
                            fid, cnt = await writer.upload_excel(config_folder_id, 'Danh sách stage.xlsx', stages)
                            wf_uploaded_files.append({
                                'path': build_output_path(f'Workflows/{wf_label}/1. Cấu hình workflow/Danh sách stage.xlsx'),
                                'file_id': fid, 'record_count': cnt,
                            })

                        if include_jobs and jobs_list_folder_id is not None and jobs_parent_folder_id is not None:
                            await log_message(f'  Fetching jobs for workflow "{wf_name}"...')
                            try:
                                jobs = await client.get_workflow_jobs(wf_id)
                            except Exception as exc:
                                workflow_issues.append(_build_issue('workflow_jobs', str(exc)))
                                logger.warning('Failed to load jobs for workflow %s: %s', wf_id, exc)
                                jobs = []

                            retry_job_ids = retry_job_ids_by_workflow.get(wf_id)
                            if retry_failed_only and retry_job_ids:
                                jobs = [job for job in jobs if _pick_id(job, _JOB_ID_FIELDS) in retry_job_ids]
                                await log_message(
                                    f'  Workflow "{wf_name}": retry filter keeps {len(jobs)} failed job(s)...'
                                )
                            elif retry_failed_only:
                                await log_message(f'  Workflow "{wf_name}": retrying the full workflow scope...')

                            await log_message(f'  Workflow "{wf_name}" has {len(jobs)} job(s)')
                            job_folder_urls: dict[str, str] = {}
                            prepared_jobs: list[dict[str, Any]] = []

                            if jobs:
                                job_total = len(jobs)

                                async def initialize_job(job_index: int, job: dict[str, Any]) -> dict[str, Any]:
                                    job_id = _pick_id(job, _JOB_ID_FIELDS)
                                    job_name = _pick_name(job, _JOB_NAME_FIELDS) or _pick_name(job)
                                    job_label = sanitize_name(f'[{job_id}] {truncate_name(job_name)}')
                                    job_folder_id = await writer.create_folder(job_label, jobs_parent_folder_id)
                                    return {
                                        'job_index': job_index,
                                        'job': job,
                                        'job_id': job_id,
                                        'job_name': job_name,
                                        'job_label': job_label,
                                        'job_folder_id': job_folder_id,
                                        'job_folder_url': writer.get_folder_url(job_folder_id),
                                    }

                                for batch_start in range(0, job_total, _MAX_PARALLEL_JOBS):
                                    batch_jobs = jobs[batch_start:batch_start + _MAX_PARALLEL_JOBS]
                                    batch_from = batch_start + 1
                                    batch_to = batch_start + len(batch_jobs)
                                    await log_message(
                                        f'  Workflow "{wf_name}": preparing job folders [{batch_from}-{batch_to}]/{job_total}...'
                                    )
                                    batch_prepared_jobs = await asyncio.gather(*(
                                        initialize_job(batch_start + offset + 1, job)
                                        for offset, job in enumerate(batch_jobs)
                                    ))
                                    prepared_jobs.extend(batch_prepared_jobs)

                                for prepared_job in sorted(prepared_jobs, key=lambda item: item['job_index']):
                                    job_folder_urls[prepared_job['job_id']] = prepared_job['job_folder_url']

                            jobs_rows_with_links = []
                            for job in jobs:
                                job_row = dict(job)
                                job_row[_DETAIL_FOLDER_LINK_FIELD] = job_folder_urls.get(_pick_id(job, _JOB_ID_FIELDS), '')
                                jobs_rows_with_links.append(job_row)
                            fid, cnt = await writer.upload_excel(
                                jobs_list_folder_id,
                                'Danh sách job.xlsx',
                                jobs_rows_with_links,
                                hyperlink_columns=(_DETAIL_FOLDER_LINK_FIELD,),
                            )
                            wf_uploaded_files.append({
                                'path': build_output_path(f'Workflows/{wf_label}/2. Danh sách công việc/Danh sách job.xlsx'),
                                'file_id': fid, 'record_count': cnt,
                            })

                            if prepared_jobs:
                                async def process_job(prepared_job: dict[str, Any]) -> dict[str, Any]:
                                    job = prepared_job['job']
                                    job_index = prepared_job['job_index']
                                    job_id = prepared_job['job_id']
                                    job_name = prepared_job['job_name']
                                    job_label = prepared_job['job_label']
                                    job_folder_id = prepared_job['job_folder_id']
                                    job_uploaded_files: list[dict[str, Any]] = []
                                    job_issues: list[dict[str, Any]] = []

                                    def add_job_issue(stage: str, error: str, **extra: Any) -> None:
                                        job_issues.append(_build_issue(stage, error, **extra))

                                    manifest_job: dict[str, Any] = {
                                        'job_id': job_id,
                                        'job_name': job_name,
                                        'folder': job_label,
                                        'status': 'completed',
                                    }

                                    try:
                                        try:
                                            job_detail = await client.get_job(job_id)
                                        except Exception as exc:
                                            add_job_issue('job_detail', str(exc))
                                            logger.warning('Failed to load job detail for %s: %s', job_id, exc)
                                            job_detail = job

                                        info_folder_id = await writer.create_folder('1. Thông tin', job_folder_id)
                                        fid, _ = await writer.upload_excel(info_folder_id, 'Thông tin job.xlsx', [job_detail])
                                        job_uploaded_files.append({
                                            'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/1. Thông tin/Thông tin job.xlsx'),
                                            'file_id': fid,
                                        })

                                        log_records = _extract_job_log(job_detail)
                                        if log_records:
                                            fid, _ = await writer.upload_excel(info_folder_id, 'Thông tin job log.xlsx', log_records)
                                            job_uploaded_files.append({
                                                'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/1. Thông tin/Thông tin job log.xlsx'),
                                                'file_id': fid,
                                            })

                                        moves_records = _extract_job_moves(job_detail)
                                        if moves_records:
                                            fid, _ = await writer.upload_excel(info_folder_id, 'Thông tin job moves.xlsx', moves_records)
                                            job_uploaded_files.append({
                                                'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/1. Thông tin/Thông tin job moves.xlsx'),
                                                'file_id': fid,
                                            })

                                        data_folder_id = await writer.create_folder('2. Dữ liệu nhập', job_folder_id)

                                        cf_records = _flatten_custom_fields(job_detail)
                                        fid, _ = await writer.upload_excel(data_folder_id, 'custom_fields.xlsx', cf_records)
                                        job_uploaded_files.append({
                                            'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/custom_fields.xlsx'),
                                            'file_id': fid,
                                        })

                                        it_records = _extract_input_tables(job_detail)
                                        fid, _ = await writer.upload_excel(data_folder_id, 'input table.xlsx', it_records)
                                        job_uploaded_files.append({
                                            'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/input table.xlsx'),
                                            'file_id': fid,
                                        })

                                        itb_records = _extract_input_tables_with_base(job_detail)
                                        fid, _ = await writer.upload_excel(data_folder_id, 'input table kèm base table.xlsx', itb_records)
                                        job_uploaded_files.append({
                                            'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/input table kèm base table.xlsx'),
                                            'file_id': fid,
                                        })

                                        sm_records = _extract_select_masters(job_detail)
                                        fid, _ = await writer.upload_excel(data_folder_id, 'select master.xlsx', sm_records)
                                        job_uploaded_files.append({
                                            'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/select master.xlsx'),
                                            'file_id': fid,
                                        })

                                        try:
                                            raw_custom_table = await client.get_job_custom_table(job_id)
                                        except Exception as exc:
                                            add_job_issue('custom_table', str(exc))
                                            raw_custom_table = None

                                        if raw_custom_table is not None:
                                            custom_table_sheets = _extract_custom_table_sheets(raw_custom_table)
                                            if custom_table_sheets:
                                                fid = await writer.upload_text(
                                                    data_folder_id,
                                                    'custom_table.raw.json',
                                                    json.dumps(raw_custom_table, ensure_ascii=False, indent=2),
                                                )
                                                job_uploaded_files.append({
                                                    'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/custom_table.raw.json'),
                                                    'file_id': fid,
                                                })

                                                used_custom_table_names: set[str] = set()
                                                for table_name, table_rows in custom_table_sheets.items():
                                                    custom_table_filename = _ensure_unique_filename(
                                                        f'custom_table - {table_name}.xlsx',
                                                        used_custom_table_names,
                                                    )
                                                    fid, _ = await writer.upload_excel(data_folder_id, custom_table_filename, table_rows)
                                                    job_uploaded_files.append({
                                                        'path': build_output_path(
                                                            f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/{custom_table_filename}'
                                                        ),
                                                        'file_id': fid,
                                                    })

                                        content_folder_id = await writer.create_folder('3. Nội dung', job_folder_id)
                                        try:
                                            posts = await client.get_job_posts(job_id)
                                        except Exception as exc:
                                            add_job_issue('job_posts', str(exc))
                                            logger.warning('Failed to load posts for job %s: %s', job_id, exc)
                                            posts = []

                                        all_comments: dict[str, list[dict]] = {}
                                        comment_sem = asyncio.Semaphore(4)

                                        async def _load_comments(post_hid: str) -> None:
                                            async with comment_sem:
                                                try:
                                                    comments = await client.get_job_comments(post_hid)
                                                    all_comments[post_hid] = comments
                                                except Exception as exc:
                                                    add_job_issue('job_comments', str(exc), post_id=post_hid)
                                                    all_comments[post_hid] = []

                                        if posts:
                                            await asyncio.gather(*(
                                                _load_comments(_pick_id(post, ('hid', 'id', 'post_id')))
                                                for post in posts
                                                if _pick_id(post, ('hid', 'id', 'post_id'))
                                            ))

                                        posts_text = _build_posts_text(posts, all_comments)
                                        fid = await writer.upload_text(content_folder_id, 'post_and_comment.txt', posts_text)
                                        job_uploaded_files.append({
                                            'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/3. Nội dung/post_and_comment.txt'),
                                            'file_id': fid,
                                        })

                                        attach_folder_id = await writer.create_folder('4. Tệp đính kèm', job_folder_id)
                                        job_file_records = _extract_job_files(job_detail)
                                        post_comment_file_records = _extract_post_comment_files(posts, all_comments)
                                        file_records = [*job_file_records, *post_comment_file_records]
                                        attachment_files_uploaded = 0
                                        used_attachment_names: set[str] = set()
                                        for file_record in file_records:
                                            uploaded_attachment = await _download_attachment_to_destination(
                                                writer=writer,
                                                folder_id=attach_folder_id,
                                                file_record=file_record,
                                                http_client=attachment_http_client,
                                                download_sem=attachment_download_sem,
                                                used_names=used_attachment_names,
                                            )
                                            if uploaded_attachment is None:
                                                attachment_name = (
                                                    file_record.get('file_name')
                                                    or file_record.get('fid')
                                                    or file_record.get('file_id')
                                                    or 'unknown'
                                                )
                                                logger.warning(
                                                    'Failed to backup attachment for job %s (%s): %s',
                                                    job_id,
                                                    attachment_name,
                                                    file_record.get('download_error') or 'unknown error',
                                                )
                                                add_job_issue(
                                                    'attachment_download',
                                                    str(file_record.get('download_error') or 'Unknown attachment download error'),
                                                    file_name=attachment_name,
                                                    attachment_source=file_record.get('attachment_source') or '',
                                                )
                                                continue
                                            attachment_files_uploaded += 1
                                            job_uploaded_files.append({
                                                'path': build_output_path(
                                                    f'Workflows/{wf_label}/3. Jobs/{job_label}/4. Tệp đính kèm/{uploaded_attachment["filename"]}'
                                                ),
                                                'file_id': uploaded_attachment['file_id'],
                                                'size_bytes': uploaded_attachment['size_bytes'],
                                            })

                                        fid, _ = await writer.upload_excel(
                                            attach_folder_id,
                                            'Thông tin files.xlsx',
                                            job_file_records,
                                            hyperlink_columns=(
                                                'file_url',
                                                'url',
                                                'src',
                                                'ext_download',
                                                'link',
                                                'download',
                                                'download_final_url',
                                            ),
                                        )
                                        job_uploaded_files.append({
                                            'path': build_output_path(f'Workflows/{wf_label}/3. Jobs/{job_label}/4. Tệp đính kèm/Thông tin files.xlsx'),
                                            'file_id': fid,
                                        })

                                        if post_comment_file_records:
                                            fid, _ = await writer.upload_excel(
                                                attach_folder_id,
                                                'Thông tin post_comment_files.xlsx',
                                                post_comment_file_records,
                                                hyperlink_columns=(
                                                    'file_url',
                                                    'url',
                                                    'src',
                                                    'ext_download',
                                                    'link',
                                                    'download',
                                                    'download_final_url',
                                                ),
                                            )
                                            job_uploaded_files.append({
                                                'path': build_output_path(
                                                    f'Workflows/{wf_label}/3. Jobs/{job_label}/4. Tệp đính kèm/Thông tin post_comment_files.xlsx'
                                                ),
                                                'file_id': fid,
                                            })

                                        manifest_job['attachment_records'] = len(job_file_records)
                                        manifest_job['post_comment_attachment_records'] = len(post_comment_file_records)
                                        manifest_job['attachment_files_downloaded'] = attachment_files_uploaded
                                        manifest_job['files'] = len(job_uploaded_files)

                                        if job_issues:
                                            compacted_issues = _compact_issues(job_issues)
                                            manifest_job['status'] = 'partial'
                                            manifest_job['issue_count'] = len(job_issues)
                                            manifest_job['issues'] = compacted_issues
                                            failed_jobs.append({
                                                'workflow_id': wf_id,
                                                'workflow_name': wf_name,
                                                'job_id': job_id,
                                                'job_name': job_name,
                                                'status': 'partial',
                                                'issue_count': len(job_issues),
                                                'issues': compacted_issues,
                                            })
                                            await log_message(
                                                f'    Job "{job_name}" completed with {len(job_issues)} issue(s); it was added to the retry list.'
                                            )

                                        return {
                                            'job_index': job_index,
                                            'manifest_job': manifest_job,
                                            'uploaded_files': job_uploaded_files,
                                        }
                                    except Exception as exc:
                                        final_issues = _compact_issues(job_issues + [_build_issue('job_runtime', str(exc))])
                                        manifest_job['status'] = 'failed'
                                        manifest_job['files'] = len(job_uploaded_files)
                                        manifest_job['issue_count'] = len(job_issues) + 1
                                        manifest_job['issues'] = final_issues
                                        failed_jobs.append({
                                            'workflow_id': wf_id,
                                            'workflow_name': wf_name,
                                            'job_id': job_id,
                                            'job_name': job_name,
                                            'status': 'failed',
                                            'issue_count': len(job_issues) + 1,
                                            'issues': final_issues,
                                        })
                                        await log_message(
                                            f'    Job "{job_name}" failed and was added to the retry list: {exc}'
                                        )
                                        return {
                                            'job_index': job_index,
                                            'manifest_job': manifest_job,
                                            'uploaded_files': job_uploaded_files,
                                        }

                                job_total = len(prepared_jobs)
                                job_results: list[dict[str, Any]] = []
                                sorted_prepared_jobs = sorted(prepared_jobs, key=lambda item: item['job_index'])
                                for batch_start in range(0, job_total, _MAX_PARALLEL_JOBS):
                                    batch_prepared_jobs = sorted_prepared_jobs[batch_start:batch_start + _MAX_PARALLEL_JOBS]
                                    batch_from = batch_start + 1
                                    batch_to = batch_start + len(batch_prepared_jobs)
                                    await log_message(
                                        f'  Workflow "{wf_name}": processing job details [{batch_from}-{batch_to}]/{job_total}...'
                                    )
                                    batch_results = await asyncio.gather(*(
                                        process_job(prepared_job)
                                        for prepared_job in batch_prepared_jobs
                                    ))
                                    job_results.extend(batch_results)

                                for job_result in sorted(job_results, key=lambda item: item['job_index']):
                                    wf_uploaded_files.extend(job_result['uploaded_files'])
                                    manifest_wf['jobs'].append(job_result['manifest_job'])

                            if any(str(job.get('status') or '').lower() != 'completed' for job in manifest_wf['jobs']):
                                manifest_wf['status'] = 'partial'

                        if workflow_issues:
                            compacted_workflow_issues = _compact_issues(workflow_issues)
                            manifest_wf['issue_count'] = len(workflow_issues)
                            manifest_wf['issues'] = compacted_workflow_issues
                            if manifest_wf['status'] == 'completed':
                                manifest_wf['status'] = 'partial'
                            failed_workflows.append({
                                'workflow_id': wf_id,
                                'workflow_name': wf_name,
                                'status': manifest_wf['status'],
                                'issue_count': len(workflow_issues),
                                'issues': compacted_workflow_issues,
                            })
                            await log_message(
                                f'  Workflow "{wf_name}" completed with {len(workflow_issues)} workflow-level issue(s); it was added to the retry list.'
                            )
                    except Exception as exc:
                        final_issues = _compact_issues(workflow_issues + [_build_issue('workflow_runtime', str(exc))])
                        manifest_wf['status'] = 'failed'
                        manifest_wf['issue_count'] = len(workflow_issues) + 1
                        manifest_wf['issues'] = final_issues
                        failed_workflows.append({
                            'workflow_id': wf_id,
                            'workflow_name': wf_name,
                            'status': 'failed',
                            'issue_count': len(workflow_issues) + 1,
                            'issues': final_issues,
                        })
                        await log_message(
                            f'  Workflow "{wf_name}" failed and was added to the retry list: {exc}'
                        )

                    return {
                        'workflow_index': wf_index,
                        'uploaded_files': wf_uploaded_files,
                        'manifest': manifest_wf,
                    }

            workflow_results: list[dict[str, Any]] = []
            if initialized_workflows:
                workflow_results = await asyncio.gather(*(
                    process_workflow(initialized_workflow)
                    for initialized_workflow in initialized_workflows
                ))

            for workflow_result in sorted(workflow_results, key=lambda item: item['workflow_index']):
                uploaded_files.extend(workflow_result['uploaded_files'])
                manifest_entries.append(workflow_result['manifest'])

            total_workflows_processed = len(manifest_entries)
            completed_workflows = sum(
                1 for manifest_entry in manifest_entries
                if str(manifest_entry.get('status') or '').lower() == 'completed'
            )
            total_jobs_processed = sum(len(manifest_entry.get('jobs') or []) for manifest_entry in manifest_entries)
            completed_jobs = sum(
                1
                for manifest_entry in manifest_entries
                for manifest_job in manifest_entry.get('jobs') or []
                if str(manifest_job.get('status') or '').lower() == 'completed'
            )

            failure_summary = {
                'failed_workflow_count': len(failed_workflows),
                'failed_job_count': len(failed_jobs),
                'failed_workflows': [
                    {
                        'workflow_id': item.get('workflow_id') or '',
                        'workflow_name': item.get('workflow_name') or '',
                        'status': item.get('status') or '',
                        'issue_count': item.get('issue_count') or 0,
                    }
                    for item in failed_workflows
                ],
                'failed_jobs': [
                    {
                        'workflow_id': item.get('workflow_id') or '',
                        'workflow_name': item.get('workflow_name') or '',
                        'job_id': item.get('job_id') or '',
                        'job_name': item.get('job_name') or '',
                        'status': item.get('status') or '',
                        'issue_count': item.get('issue_count') or 0,
                    }
                    for item in failed_jobs
                ],
            }
            failure_details = {
                'failed_workflow_count': len(failed_workflows),
                'failed_job_count': len(failed_jobs),
                'failed_workflows': failed_workflows,
                'failed_jobs': failed_jobs,
            }

            if failed_workflows or failed_jobs:
                await log_message('Writing retry candidate summary...')
                fid = await writer.upload_text(
                    common_folder_id,
                    'retry_candidates.json',
                    json.dumps(failure_details, ensure_ascii=False, indent=2),
                )
                uploaded_files.append({
                    'path': build_output_path('0. Danh mục chung/retry_candidates.json'),
                    'file_id': fid,
                })

                if failed_workflows:
                    failed_workflow_rows = [
                        {
                            'workflow_id': item.get('workflow_id') or '',
                            'workflow_name': item.get('workflow_name') or '',
                            'status': item.get('status') or '',
                            'issue_count': item.get('issue_count') or 0,
                            'issues_json': json.dumps(item.get('issues') or [], ensure_ascii=False),
                        }
                        for item in failed_workflows
                    ]
                    fid, cnt = await writer.upload_excel(
                        common_folder_id,
                        'Danh sách workflow lỗi.xlsx',
                        failed_workflow_rows,
                    )
                    uploaded_files.append({
                        'path': build_output_path('0. Danh mục chung/Danh sách workflow lỗi.xlsx'),
                        'file_id': fid,
                        'record_count': cnt,
                    })

                if failed_jobs:
                    failed_job_rows = [
                        {
                            'workflow_id': item.get('workflow_id') or '',
                            'workflow_name': item.get('workflow_name') or '',
                            'job_id': item.get('job_id') or '',
                            'job_name': item.get('job_name') or '',
                            'status': item.get('status') or '',
                            'issue_count': item.get('issue_count') or 0,
                            'issues_json': json.dumps(item.get('issues') or [], ensure_ascii=False),
                        }
                        for item in failed_jobs
                    ]
                    fid, cnt = await writer.upload_excel(
                        common_folder_id,
                        'Danh sách job lỗi.xlsx',
                        failed_job_rows,
                    )
                    uploaded_files.append({
                        'path': build_output_path('0. Danh mục chung/Danh sách job lỗi.xlsx'),
                        'file_id': fid,
                        'record_count': cnt,
                    })

            # ── Manifest ─────────────────────────────────────────────
            await log_message('Writing backup manifest...')
            manifest = {
                'flow_id': str(flow.id),
                'flow_name': flow.name,
                'backup_type': backup_type,
                'connector': 'workflow',
                'destination_type': writer.destination_type,
                'retry_failed_only': retry_failed_only,
                'retry_source_run_id': retry_source_run_id,
                'retry_branch_path': run_path_prefix.rstrip('/') or None,
                'selected_objects': selected_objects,
                'selected_workflow_ids': [str(wid) for wid in workflow_ids],
                'effective_workflow_ids': [_pick_id(workflow, _ID_FIELDS) for workflow in selected_workflows],
                'workflow_count': len(selected_workflows),
                'completed_workflows': completed_workflows,
                'total_jobs': total_jobs_processed,
                'completed_jobs': completed_jobs,
                'total_files': len(uploaded_files),
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'failure_summary': failure_summary,
                'workflows': manifest_entries,
            }
            manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2)
            fid = await writer.upload_text(common_folder_id, 'backup_manifest.json', manifest_json)
            uploaded_files.append({
                'path': build_output_path('0. Danh mục chung/backup_manifest.json'),
                'file_id': fid,
            })

            # ── Done ─────────────────────────────────────────────────
            completed_at = datetime.utcnow()
            run.completed_at = completed_at
            summary_message = (
                f'Uploaded {len(uploaded_files)} file(s) across {len(selected_workflows)} workflow(s) '
                f'and {total_jobs_processed} job(s)'
            )
            if failed_workflows or failed_jobs:
                retry_summary = (
                    f'Completed with errors: {len(failed_workflows)} workflow issue(s), '
                    f'{len(failed_jobs)} job issue(s). {summary_message}'
                )
                run.status = 'failed'
                run.error_message = retry_summary
                final_log_tag = 'FAILED'
                final_log_message = retry_summary
                flow.last_run_status = 'failed'
                flow.last_run_message = retry_summary
            else:
                run.status = 'completed'
                run.error_message = None
                final_log_tag = 'COMPLETED'
                final_log_message = summary_message
                flow.last_run_status = 'completed'
                flow.last_run_message = summary_message

            run.execution_details = {
                **requested_execution_details,
                'app': 'workflow',
                'mode': 'workflow_retry_failed_only' if retry_failed_only else 'workflow_backup',
                'backup_type': backup_type,
                'destination_writer': writer.destination_type,
                'retry_failed_only': retry_failed_only,
                'retry_source_run_id': retry_source_run_id,
                'retry_branch_path': run_path_prefix.rstrip('/') or None,
                'total_workflows': total_workflows_processed,
                'completed_workflows': completed_workflows,
                'total_jobs': total_jobs_processed,
                'completed_jobs': completed_jobs,
                'failure_summary': failure_summary,
                'uploaded_files': uploaded_files,
            }
            run.logs = f"{run.logs}\n[{final_log_tag}] {final_log_message}".strip()

            flow.last_run_at = completed_at
            await db.commit()
        except Exception as exc:
            logger.exception('Workflow backup failed for flow %s', flow_id)
            completed_at = datetime.utcnow()
            run.status = 'failed'
            run.completed_at = completed_at
            run.error_message = str(exc)
            run.logs = f"{run.logs or ''}\n[FAILED] {exc}".strip()
            flow.last_run_at = completed_at
            flow.last_run_status = 'failed'
            flow.last_run_message = str(exc)
            await db.commit()
        finally:
            if client is not None:
                await client.aclose()
            if attachment_http_client is not None:
                await attachment_http_client.aclose()
