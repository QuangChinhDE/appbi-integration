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
from datetime import datetime
from typing import Any
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


def _extract_job_files(job_detail: dict) -> list[dict]:
    """Extract file/attachment info from job detail."""
    files = job_detail.get('files') or job_detail.get('attachments') or []
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

            include_workflows = any(o in selected_objects for o in ('workflow', 'workflows'))
            include_jobs = any(o in selected_objects for o in ('job', 'jobs'))
            include_workflow_context = include_workflows or include_jobs

            uploaded_files: list[dict[str, Any]] = []
            manifest_entries: list[dict[str, Any]] = []
            workflow_folder_urls: dict[str, str] = {}

            # ── Trash old folder and create fresh ────────────────────
            await _update_log(db, run, 'Preparing destination folder...')

            app_folder_name = sanitize_name('Base Workflow')
            app_folder_id, archived_count = await writer.prepare_app_folder()
            if archived_count:
                await _update_log(db, run, f'Archived {archived_count} old "{app_folder_name}" folder(s)')

            # ── Fetch all workflows ──────────────────────────────────
            await _update_log(db, run, 'Fetching all workflows...')
            all_workflows = await client.get_all_workflows()
            await _update_log(db, run, f'Found {len(all_workflows)} workflow(s)')

            if workflow_ids:
                workflow_id_set = set(str(wid) for wid in workflow_ids)
                selected_workflows = [
                    w for w in all_workflows
                    if _pick_id(w, _ID_FIELDS) in workflow_id_set
                ]
            else:
                selected_workflows = all_workflows

            await _update_log(db, run, f'Will backup {len(selected_workflows)} selected workflow(s)')

            # ── 0. Danh mục chung ────────────────────────────────────
            await _update_log(db, run, 'Creating "0. Danh mục chung"...')
            common_folder_id = await writer.create_folder('0. Danh mục chung', app_folder_id)

            # ── Workflows/ ───────────────────────────────────────────
            workflows_folder_id = await writer.create_folder('Workflows', app_folder_id)

            total = len(selected_workflows)
            for wf_index, workflow in enumerate(selected_workflows, 1):
                wf_id = _pick_id(workflow, _ID_FIELDS)
                wf_name = _pick_name(workflow)
                wf_label = sanitize_name(f'[{wf_id}] {truncate_name(wf_name)}')
                await _update_log(db, run, f'[{wf_index}/{total}] Processing workflow "{wf_name}" (ID: {wf_id})...')

                wf_folder_id = await writer.create_folder(wf_label, workflows_folder_id)
                workflow_folder_urls[wf_id] = writer.get_folder_url(wf_folder_id)

                manifest_wf: dict[str, Any] = {
                    'workflow_id': wf_id,
                    'workflow_name': wf_name,
                    'folder': wf_label,
                    'jobs': [],
                }

                # ── 0. Hướng dẫn ─────────────────────────────────────
                guide_folder_id = await writer.create_folder('0. Hướng dẫn', wf_folder_id)
                readme_text = _build_readme(workflow)
                fid = await writer.upload_text(guide_folder_id, 'README.txt', readme_text)
                uploaded_files.append({
                    'path': f'Workflows/{wf_label}/0. Hướng dẫn/README.txt',
                    'file_id': fid,
                })

                if include_workflow_context:
                    # ── 1. Cấu hình workflow ──────────────────────────
                    config_folder_id = await writer.create_folder('1. Cấu hình workflow', wf_folder_id)

                    # Thông tin workflow
                    try:
                        wf_detail = await client.get_workflow(wf_id)
                    except Exception:
                        wf_detail = workflow
                    fid, cnt = await writer.upload_excel(config_folder_id, 'Thông tin workflow.xlsx', [wf_detail])
                    uploaded_files.append({
                        'path': f'Workflows/{wf_label}/1. Cấu hình workflow/Thông tin workflow.xlsx',
                        'file_id': fid, 'record_count': cnt,
                    })

                    # Danh sách stage
                    try:
                        stages = await client.get_workflow_stages(wf_id)
                    except Exception as exc:
                        logger.warning('Failed to load stages for workflow %s: %s', wf_id, exc)
                        stages = []
                    fid, cnt = await writer.upload_excel(config_folder_id, 'Danh sách stage.xlsx', stages)
                    uploaded_files.append({
                        'path': f'Workflows/{wf_label}/1. Cấu hình workflow/Danh sách stage.xlsx',
                        'file_id': fid, 'record_count': cnt,
                    })

                if include_jobs:
                    # ── 2. Danh sách công việc ────────────────────────
                    await _update_log(db, run, f'  Fetching jobs for workflow "{wf_name}"...')
                    try:
                        jobs = await client.get_workflow_jobs(wf_id)
                    except Exception as exc:
                        logger.warning('Failed to load jobs for workflow %s: %s', wf_id, exc)
                        jobs = []

                    jobs_list_folder_id = await writer.create_folder('2. Danh sách công việc', wf_folder_id)
                    await _update_log(db, run, f'  Found {len(jobs)} job(s)')

                    # ── 3. Jobs ───────────────────────────────────────
                    jobs_parent_folder_id = await writer.create_folder('3. Jobs', wf_folder_id)
                    job_folder_urls: dict[str, str] = {}
                    if jobs:
                        job_total = len(jobs)
                        for job_index, job in enumerate(jobs, 1):
                            job_id = _pick_id(job, _JOB_ID_FIELDS)
                            job_name = _pick_name(job, _JOB_NAME_FIELDS) or _pick_name(job)
                            job_label = sanitize_name(f'[{job_id}] {truncate_name(job_name)}')

                            if job_index % 10 == 1 or job_index == job_total:
                                await _update_log(db, run, f'  [{job_index}/{job_total}] Processing job "{job_name}"...')

                            job_folder_id = await writer.create_folder(job_label, jobs_parent_folder_id)
                            job_folder_urls[job_id] = writer.get_folder_url(job_folder_id)

                            manifest_job: dict[str, Any] = {
                                'job_id': job_id,
                                'job_name': job_name,
                                'folder': job_label,
                            }

                            # Fetch job details
                            try:
                                job_detail = await client.get_job(job_id)
                            except Exception as exc:
                                logger.warning('Failed to load job detail for %s: %s', job_id, exc)
                                job_detail = job

                            # 1. Thông tin
                            info_folder_id = await writer.create_folder('1. Thông tin', job_folder_id)
                            fid, cnt = await writer.upload_excel(info_folder_id, 'Thông tin job.xlsx', [job_detail])
                            uploaded_files.append({
                                'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/1. Thông tin/Thông tin job.xlsx',
                                'file_id': fid,
                            })

                            # Job log
                            log_records = _extract_job_log(job_detail)
                            if log_records:
                                fid, _ = await writer.upload_excel(info_folder_id, 'Thông tin job log.xlsx', log_records)
                                uploaded_files.append({
                                    'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/1. Thông tin/Thông tin job log.xlsx',
                                    'file_id': fid,
                                })

                            # Job moves
                            moves_records = _extract_job_moves(job_detail)
                            if moves_records:
                                fid, _ = await writer.upload_excel(info_folder_id, 'Thông tin job moves.xlsx', moves_records)
                                uploaded_files.append({
                                    'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/1. Thông tin/Thông tin job moves.xlsx',
                                    'file_id': fid,
                                })

                            # 2. Dữ liệu nhập
                            data_folder_id = await writer.create_folder('2. Dữ liệu nhập', job_folder_id)

                            # custom_fields
                            cf_records = _flatten_custom_fields(job_detail)
                            fid, _ = await writer.upload_excel(data_folder_id, 'custom_fields.xlsx', cf_records)
                            uploaded_files.append({
                                'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/custom_fields.xlsx',
                                'file_id': fid,
                            })

                            # input table
                            it_records = _extract_input_tables(job_detail)
                            fid, _ = await writer.upload_excel(data_folder_id, 'input table.xlsx', it_records)
                            uploaded_files.append({
                                'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/input table.xlsx',
                                'file_id': fid,
                            })

                            # input table kèm base table
                            itb_records = _extract_input_tables_with_base(job_detail)
                            fid, _ = await writer.upload_excel(data_folder_id, 'input table kèm base table.xlsx', itb_records)
                            uploaded_files.append({
                                'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/input table kèm base table.xlsx',
                                'file_id': fid,
                            })

                            # select master
                            sm_records = _extract_select_masters(job_detail)
                            fid, _ = await writer.upload_excel(data_folder_id, 'select master.xlsx', sm_records)
                            uploaded_files.append({
                                'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/2. Dữ liệu nhập/select master.xlsx',
                                'file_id': fid,
                            })

                            # Also fetch custom table API (raw)
                            try:
                                raw_custom_table = await client.get_job_custom_table(job_id)
                                if isinstance(raw_custom_table, dict):
                                    raw_custom_table = [raw_custom_table]
                                if isinstance(raw_custom_table, list) and raw_custom_table:
                                    pass  # already included via job_detail fields above
                            except Exception:
                                pass

                            # 3. Nội dung
                            content_folder_id = await writer.create_folder('3. Nội dung', job_folder_id)
                            try:
                                posts = await client.get_job_posts(job_id)
                            except Exception as exc:
                                logger.warning('Failed to load posts for job %s: %s', job_id, exc)
                                posts = []

                            all_comments: dict[str, list[dict]] = {}
                            comment_sem = asyncio.Semaphore(4)

                            async def _load_comments(post_id: str) -> None:
                                async with comment_sem:
                                    try:
                                        comments = await client.get_job_comments(post_id)
                                        all_comments[post_id] = comments
                                    except Exception:
                                        all_comments[post_id] = []

                            if posts:
                                await asyncio.gather(*(
                                    _load_comments(_pick_id(p, ('hid', 'id', 'post_id')))
                                    for p in posts
                                    if _pick_id(p, ('hid', 'id', 'post_id'))
                                ))

                            posts_text = _build_posts_text(posts, all_comments)
                            fid = await writer.upload_text(content_folder_id, 'post_and_comment.txt', posts_text)
                            uploaded_files.append({
                                'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/3. Nội dung/post_and_comment.txt',
                                'file_id': fid,
                            })

                            # 4. Tệp đính kèm
                            attach_folder_id = await writer.create_folder('4. Tệp đính kèm', job_folder_id)
                            file_records = _extract_job_files(job_detail)
                            fid, _ = await writer.upload_excel(attach_folder_id, 'Thông tin files.xlsx', file_records)
                            uploaded_files.append({
                                'path': f'Workflows/{wf_label}/3. Jobs/{job_label}/4. Tệp đính kèm/Thông tin files.xlsx',
                                'file_id': fid,
                            })

                            manifest_job['files'] = len([
                                f for f in uploaded_files
                                if f.get('path', '').startswith(f'Workflows/{wf_label}/3. Jobs/{job_label}/')
                            ])
                            manifest_wf['jobs'].append(manifest_job)

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
                    uploaded_files.append({
                        'path': f'Workflows/{wf_label}/2. Danh sách công việc/Danh sách job.xlsx',
                        'file_id': fid, 'record_count': cnt,
                    })

                manifest_entries.append(manifest_wf)

            workflow_rows_with_links = []
            for workflow in all_workflows:
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
                'path': '0. Danh mục chung/Danh sách workflow.xlsx',
                'file_id': fid, 'record_count': cnt,
            })

            # ── Manifest ─────────────────────────────────────────────
            await _update_log(db, run, 'Writing backup manifest...')
            manifest = {
                'flow_id': str(flow.id),
                'flow_name': flow.name,
                'backup_type': backup_type,
                'connector': 'workflow',
                'destination_type': writer.destination_type,
                'selected_objects': selected_objects,
                'selected_workflow_ids': [str(wid) for wid in workflow_ids],
                'workflow_count': len(selected_workflows),
                'total_files': len(uploaded_files),
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'workflows': manifest_entries,
            }
            manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2)
            fid = await writer.upload_text(common_folder_id, 'backup_manifest.json', manifest_json)
            uploaded_files.append({'path': '0. Danh mục chung/backup_manifest.json', 'file_id': fid})

            # ── Done ─────────────────────────────────────────────────
            completed_at = datetime.utcnow()
            run.status = 'completed'
            run.completed_at = completed_at
            run.execution_details = {
                'mode': 'workflow_backup',
                'backup_type': backup_type,
                'destination_writer': writer.destination_type,
                'uploaded_files': uploaded_files,
            }
            run.logs = f"{run.logs}\n[COMPLETED] Uploaded {len(uploaded_files)} file(s) across {len(selected_workflows)} workflow(s)"

            flow.last_run_at = completed_at
            flow.last_run_status = 'completed'
            flow.last_run_message = f"Uploaded {len(uploaded_files)} file(s) across {len(selected_workflows)} workflow(s)"
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
