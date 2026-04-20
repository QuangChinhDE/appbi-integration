"""
Request-specific backup extractor.

Produces the hierarchical folder structure:

    Base Request/
    ├── [ID] Group Name/
    │   ├── Danh sách request.xlsx
    │   └── [ID] Request Name/                (only when 'request' in objects)
    │       ├── Thông tin request.xlsx
    │       ├── request.json
    │       ├── Thông tin trường tùy chỉnh.xlsx
    │       ├── [table name].xlsx
    │       ├── post_and_comment.txt
    │       └── Tệp đính kèm/
    │           └── Thông tin files.xlsx
    ├── [direct] Đề xuất trực tiếp/           (when group_id "0" is selected)
    │   ├── Danh sách request.xlsx
    │   └── …
    └── 0. Danh mục chung/
        ├── Danh sách group.xlsx
        └── backup_manifest.json
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any

import pandas as pd

from modules.backup.backend.extractors._gdrive import (
    build_cached_gdrive_token_provider,
    gdrive_create_folder,
    gdrive_recreate_folder,
    gdrive_upload_bytes,
    gdrive_upload_tabular_bytes,
)
from modules.backup.backend.extractors._helpers import (
    build_excel_bytes,
    sanitize_name,
    strip_html,
    truncate_name,
    ts_to_str,
)
from modules.connectors.apps.request.common.auth import RequestCredentials
from modules.connectors.apps.request.common.client import RequestManagementClient
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

_ID_FIELDS = ('id', 'group_id')
_NAME_FIELDS = ('name', 'title', 'display_name', 'label')
_REQUEST_ID_FIELDS = ('id', 'request_id', 'hid')


def _pick(record: dict, candidates: tuple[str, ...]) -> str:
    for key in candidates:
        val = record.get(key)
        if val not in (None, ''):
            return str(val).strip()
    return ''


def _ensure_dict(val: Any) -> dict:
    if isinstance(val, dict):
        for key in ('data', 'request', 'item'):
            inner = val.get(key)
            if isinstance(inner, dict):
                return inner
        return val
    return {}


def _flatten_custom_fields(detail: dict) -> list[dict]:
    form = detail.get('form') or detail.get('custom_fields') or []
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


def _extract_custom_tables(detail: dict) -> dict[str, list[dict]]:
    """Extract custom-table / input-table fields from request detail.

    Returns {table_label: [row_dicts]}.
    """
    form = detail.get('form') or detail.get('custom_fields') or []
    if not isinstance(form, list):
        return {}
    tables: dict[str, list[dict]] = {}
    for field in form:
        if not isinstance(field, dict):
            continue
        if field.get('type') in ('input-table', 'select-master', 'custom-table'):
            label = field.get('label') or field.get('name') or 'custom_table'
            value = field.get('value')
            if isinstance(value, list):
                tables[label] = [row for row in value if isinstance(row, dict)]
            elif isinstance(value, dict):
                tables[label] = [value]
    return tables


def _extract_files(detail: dict) -> list[dict]:
    files = detail.get('files') or detail.get('attachments') or []
    if not isinstance(files, list):
        return []
    rows = []
    for f in files:
        if not isinstance(f, dict):
            continue
        rows.append({
            'file_id': f.get('id') or f.get('file_id') or '',
            'file_name': f.get('name') or f.get('file_name') or f.get('filename') or '',
            'file_url': f.get('url') or f.get('link') or '',
            'file_size': f.get('size') or '',
            'uploaded_by': f.get('username') or f.get('uploaded_by') or '',
        })
    return rows


def _build_posts_text(posts: list[dict], all_comments: dict[str, list[dict]]) -> str:
    lines: list[str] = []
    for post in posts:
        post_id = _pick(post, ('hid', 'id', 'post_id'))
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


# ── Log & upload helpers ─────────────────────────────────────────────────────


async def _update_log(db, run: BackupFlowRun, message: str) -> None:
    ts = datetime.utcnow().strftime('%H:%M:%S')
    run.logs = f"{run.logs or ''}\n[{ts}] {message}".strip()
    await db.commit()


async def _upload_excel(
    get_token, folder_id: str, filename: str,
    records: list[dict], dest_type: str | None,
) -> tuple[str, int]:
    df = pd.DataFrame(records or [])
    content = build_excel_bytes(df)
    file_id = await gdrive_upload_tabular_bytes(
        get_token, filename, content, folder_id,
        destination_type=dest_type,
    )
    return file_id, len(records or [])


async def _upload_text(
    get_token, folder_id: str, filename: str, text: str,
) -> str:
    return await gdrive_upload_bytes(
        get_token, filename, text.encode('utf-8'),
        'text/plain', folder_id,
    )


# ── Per-request detail folder ────────────────────────────────────────────────


async def _backup_single_request(
    client: RequestManagementClient,
    request_rec: dict,
    parent_folder_id: str,
    group_label: str,
    get_token,
    drive_id: str | None,
    dest_type: str | None,
    uploaded_files: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create the detail folder for one request. Returns manifest entry."""

    req_id = _pick(request_rec, _REQUEST_ID_FIELDS)
    req_name = _pick(request_rec, _NAME_FIELDS)
    req_label = sanitize_name(f'[{req_id}] {truncate_name(req_name)}')

    req_folder_id = await gdrive_create_folder(
        get_token, req_label, parent_folder_id, drive_id=drive_id,
    )

    base_path = f'{group_label}/{req_label}'

    # Fetch detail
    try:
        detail_raw = await client.get_request(req_id)
        detail = _ensure_dict(detail_raw)
    except Exception as exc:
        logger.warning('Failed to load request detail for %s: %s', req_id, exc)
        detail = request_rec

    # Thông tin request.xlsx
    fid, _ = await _upload_excel(get_token, req_folder_id, 'Thông tin request.xlsx', [detail], dest_type)
    uploaded_files.append({'path': f'{base_path}/Thông tin request.xlsx', 'file_id': fid})

    # request.json
    req_json = json.dumps(detail, ensure_ascii=False, indent=2, default=str)
    fid = await _upload_text(get_token, req_folder_id, 'request.json', req_json)
    uploaded_files.append({'path': f'{base_path}/request.json', 'file_id': fid})

    # Thông tin trường tùy chỉnh.xlsx
    cf_records = _flatten_custom_fields(detail)
    if cf_records:
        fid, _ = await _upload_excel(get_token, req_folder_id, 'Thông tin trường tùy chỉnh.xlsx', cf_records, dest_type)
        uploaded_files.append({'path': f'{base_path}/Thông tin trường tùy chỉnh.xlsx', 'file_id': fid})

    # Custom tables (e.g. [table name].xlsx)
    try:
        ct_raw = await client.get_request_with_custom_table(req_id)
        ct_detail = _ensure_dict(ct_raw)
    except Exception:
        ct_detail = detail

    custom_tables = _extract_custom_tables(ct_detail)
    for table_name, table_rows in custom_tables.items():
        safe_name = sanitize_name(table_name)
        fname = f'{safe_name}.xlsx'
        fid, _ = await _upload_excel(get_token, req_folder_id, fname, table_rows, dest_type)
        uploaded_files.append({'path': f'{base_path}/{fname}', 'file_id': fid})

    # post_and_comment.txt
    try:
        posts = await client.get_request_posts(req_id)
    except Exception as exc:
        logger.warning('Failed to load posts for request %s: %s', req_id, exc)
        posts = []

    all_comments: dict[str, list[dict]] = {}
    comment_sem = asyncio.Semaphore(4)

    async def _load_comments(post_hid: str) -> None:
        async with comment_sem:
            try:
                comments = await client.get_request_comments(post_hid)
                all_comments[post_hid] = comments
            except Exception:
                all_comments[post_hid] = []

    if posts:
        await asyncio.gather(*(
            _load_comments(_pick(p, ('hid', 'id', 'post_id')))
            for p in posts
            if _pick(p, ('hid', 'id', 'post_id'))
        ))

    posts_text = _build_posts_text(posts, all_comments)
    fid = await _upload_text(get_token, req_folder_id, 'post_and_comment.txt', posts_text)
    uploaded_files.append({'path': f'{base_path}/post_and_comment.txt', 'file_id': fid})

    # Tệp đính kèm/
    file_records = _extract_files(detail)
    if file_records:
        attach_folder_id = await gdrive_create_folder(
            get_token, 'Tệp đính kèm', req_folder_id, drive_id=drive_id,
        )
        fid, _ = await _upload_excel(get_token, attach_folder_id, 'Thông tin files.xlsx', file_records, dest_type)
        uploaded_files.append({'path': f'{base_path}/Tệp đính kèm/Thông tin files.xlsx', 'file_id': fid})

    return {
        'request_id': req_id,
        'request_name': req_name,
        'folder': req_label,
    }


# ── Main runner ──────────────────────────────────────────────────────────────


async def run_request_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        flow = await db.get(BackupFlow, flow_id)
        run = await db.get(BackupFlowRun, run_id)
        if flow is None or run is None:
            return

        client: RequestManagementClient | None = None
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
            run.logs = '[RUNNING] Starting Request backup'
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

            # Build Request API client
            domain = source_binding.auth.get('domain') or source_binding.config.get('domain') or ''
            access_token = source_binding.auth.get('access_token') or source_binding.config.get('access_token') or ''
            credentials = RequestCredentials(domain=domain, access_token=access_token)
            client = RequestManagementClient(credentials)

            structure = dict(flow.structure or {})
            selected_objects = structure.get('objects') or ['group', 'request']
            group_ids = structure.get('group_ids') or []
            backup_type = flow.backup_type or 'all'

            has_request_scope = not selected_objects or 'request' in selected_objects

            uploaded_files: list[dict[str, Any]] = []
            manifest_entries: list[dict[str, Any]] = []

            # ── Trash old folder and create fresh ────────────────────
            await _update_log(db, run, 'Preparing destination folder...')
            app_folder_name = sanitize_name('Base Request')
            app_folder_id, archived_count = await gdrive_recreate_folder(
                get_token, app_folder_name, root_folder_id, drive_id=drive_id,
            )
            if archived_count:
                await _update_log(db, run, f'Archived {archived_count} old "{app_folder_name}" folder(s)')

            # ── Fetch all groups ─────────────────────────────────────
            await _update_log(db, run, 'Fetching all request groups...')
            all_groups = await client.get_all_groups()
            await _update_log(db, run, f'Found {len(all_groups)} group(s)')

            # Determine which groups to process
            group_id_set = set(str(gid) for gid in group_ids) if group_ids else None
            has_direct = group_id_set is None or '0' in group_id_set
            if group_id_set:
                named_groups = [
                    g for g in all_groups
                    if _pick(g, _ID_FIELDS) in group_id_set
                ]
            else:
                named_groups = all_groups

            await _update_log(db, run, f'Will backup {len(named_groups)} named group(s)' +
                              (' + direct requests' if has_direct else ''))

            # ── Named groups ─────────────────────────────────────────
            total_groups = len(named_groups) + (1 if has_direct else 0)
            for g_index, group in enumerate(named_groups, 1):
                g_id = _pick(group, _ID_FIELDS)
                g_name = _pick(group, _NAME_FIELDS)
                g_label = sanitize_name(f'[{g_id}] {truncate_name(g_name)}')
                await _update_log(db, run, f'[{g_index}/{total_groups}] Processing group "{g_name}"...')

                g_folder_id = await gdrive_create_folder(
                    get_token, g_label, app_folder_id, drive_id=drive_id,
                )

                manifest_group: dict[str, Any] = {
                    'group_id': g_id,
                    'group_name': g_name,
                    'folder': g_label,
                    'requests': [],
                }

                # Fetch requests for this group
                try:
                    requests = await client.get_requests(group_id=g_id)
                except Exception as exc:
                    logger.warning('Failed to load requests for group %s: %s', g_id, exc)
                    requests = []
                await _update_log(db, run, f'  Found {len(requests)} request(s) in group "{g_name}"')

                # Danh sách request.xlsx
                fid, cnt = await _upload_excel(
                    get_token, g_folder_id, 'Danh sách request.xlsx',
                    requests, dest_type,
                )
                uploaded_files.append({
                    'path': f'{g_label}/Danh sách request.xlsx', 'file_id': fid, 'record_count': cnt,
                })

                # Per-request detail folders
                if has_request_scope:
                    req_total = len(requests)
                    for r_index, req_rec in enumerate(requests, 1):
                        if r_index % 10 == 1 or r_index == req_total:
                            r_name = _pick(req_rec, _NAME_FIELDS)
                            await _update_log(db, run, f'  [{r_index}/{req_total}] Request "{r_name}"...')

                        entry = await _backup_single_request(
                            client, req_rec, g_folder_id, g_label,
                            get_token, drive_id, dest_type, uploaded_files,
                        )
                        manifest_group['requests'].append(entry)

                manifest_entries.append(manifest_group)

            # ── Direct requests ──────────────────────────────────────
            if has_direct:
                await _update_log(db, run, f'[{total_groups}/{total_groups}] Processing direct requests...')
                direct_label = '[direct] Đề xuất trực tiếp'
                direct_folder_id = await gdrive_create_folder(
                    get_token, sanitize_name(direct_label), app_folder_id, drive_id=drive_id,
                )

                manifest_direct: dict[str, Any] = {
                    'group_id': '0',
                    'group_name': 'Đề xuất trực tiếp',
                    'folder': direct_label,
                    'requests': [],
                }

                try:
                    direct_requests = await client.get_requests(group_id='0')
                except Exception as exc:
                    logger.warning('Failed to load direct requests: %s', exc)
                    direct_requests = []
                await _update_log(db, run, f'  Found {len(direct_requests)} direct request(s)')

                # Danh sách request.xlsx
                fid, cnt = await _upload_excel(
                    get_token, direct_folder_id, 'Danh sách request.xlsx',
                    direct_requests, dest_type,
                )
                uploaded_files.append({
                    'path': f'{sanitize_name(direct_label)}/Danh sách request.xlsx',
                    'file_id': fid, 'record_count': cnt,
                })

                if has_request_scope:
                    req_total = len(direct_requests)
                    for r_index, req_rec in enumerate(direct_requests, 1):
                        if r_index % 10 == 1 or r_index == req_total:
                            r_name = _pick(req_rec, _NAME_FIELDS)
                            await _update_log(db, run, f'  [{r_index}/{req_total}] Direct request "{r_name}"...')

                        entry = await _backup_single_request(
                            client, req_rec, direct_folder_id,
                            sanitize_name(direct_label),
                            get_token, drive_id, dest_type, uploaded_files,
                        )
                        manifest_direct['requests'].append(entry)

                manifest_entries.append(manifest_direct)

            # ── 0. Danh mục chung ─────────────────────────────────────
            await _update_log(db, run, 'Creating "0. Danh mục chung"...')
            common_folder_id = await gdrive_create_folder(
                get_token, '0. Danh mục chung', app_folder_id, drive_id=drive_id,
            )
            fid, cnt = await _upload_excel(
                get_token, common_folder_id, 'Danh sách group.xlsx',
                all_groups, dest_type,
            )
            uploaded_files.append({
                'path': '0. Danh mục chung/Danh sách group.xlsx',
                'file_id': fid, 'record_count': cnt,
            })

            # ── Manifest ─────────────────────────────────────────────
            await _update_log(db, run, 'Writing backup manifest...')
            manifest = {
                'backup_type': backup_type,
                'connector': 'request',
                'group_count': len(manifest_entries),
                'total_files': len(uploaded_files),
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'groups': manifest_entries,
            }
            manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2)
            fid = await _upload_text(get_token, common_folder_id, 'backup_manifest.json', manifest_json)
            uploaded_files.append({'path': '0. Danh mục chung/backup_manifest.json', 'file_id': fid})

            # ── Done ─────────────────────────────────────────────────
            completed_at = datetime.utcnow()
            run.status = 'completed'
            run.completed_at = completed_at
            run.execution_details = {
                'mode': 'request_backup',
                'backup_type': backup_type,
                'uploaded_files': uploaded_files,
            }
            total_req = sum(len(g.get('requests', [])) for g in manifest_entries)
            run.logs = f"{run.logs}\n[COMPLETED] Uploaded {len(uploaded_files)} file(s) across {len(manifest_entries)} group(s), {total_req} request(s)"

            flow.last_run_at = completed_at
            flow.last_run_status = 'completed'
            flow.last_run_message = f"Uploaded {len(uploaded_files)} file(s) across {len(manifest_entries)} group(s)"
            await db.commit()
        except Exception as exc:
            logger.exception('Request backup failed for flow %s', flow_id)
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
