"""
WeWork-specific backup extractor.

Produces the hierarchical folder structure:

    Base WeWork/
    ├── 0. Danh mục chung/
    │   ├── Danh sách phòng ban.xlsx
    │   ├── Danh sách project.xlsx
    │   └── backup_manifest.json
    ├── 1. Departments/                 (when 'department' in objects)
    │   └── [ID] Department Name/
    │       └── Thông tin phòng ban.xlsx
    └── 2. Projects/                    (when 'project' in objects or 'task' in objects)
        └── [ID] Project Name/
            ├── 1. Thông tin project/   (when 'project' in objects)
            │   ├── Thông tin project.xlsx
            │   ├── Thông tin trường tùy chỉnh.xlsx
            │   └── [table name].xlsx
            ├── 2. Danh sách dữ liệu/
            │   ├── Danh sách task.xlsx
            │   ├── Danh sách tasklist.xlsx
            │   └── Danh sách milestone.xlsx
            └── 3. Tasks/               (when 'task' in objects)
                └── [ID] Task Name/
                    ├── 1. Thông tin/
                    │   ├── Thông tin task.xlsx
                    │   └── task.json
                    ├── 2. Tùy chỉnh/
                    │   ├── Thông tin trường tùy chỉnh.xlsx
                    │   └── [table name].xlsx
                    └── 3. Tệp đính kèm/
                        ├── Thông tin files.xlsx
                        ├── Thông tin result files.xlsx
                        └── Thông tin review files.xlsx
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from modules.backup.backend.extractors.destination_writers import (
    BackupDestinationWriter,
    build_backup_destination_writer,
)
from modules.backup.backend.extractors._gdrive import build_cached_gdrive_token_provider
from modules.backup.backend.extractors._helpers import sanitize_name, truncate_name
from modules.connectors.apps.wework.common.auth import WeworkCredentials
from modules.connectors.apps.wework.common.client import (
    WeworkManagementClient,
    merge_task_collections,
)
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

_ID_FIELDS = ('id', 'department_id', 'dept_id')
_NAME_FIELDS = ('name', 'title', 'display_name', 'label')
_PROJECT_ID_FIELDS = ('id', 'project_id')
_TASK_ID_FIELDS = ('id', 'task_id', 'hid')
_DETAIL_FOLDER_LINK_FIELD = 'Link thư mục chi tiết'


def _pick(record: dict[str, Any], candidates: tuple[str, ...]) -> str:
    for key in candidates:
        val = record.get(key)
        if val not in (None, ''):
            return str(val).strip()
    return ''


def _ensure_dict(val: Any) -> dict[str, Any]:
    if isinstance(val, dict):
        for key in ('data', 'task', 'project', 'department', 'dept', 'item'):
            inner = val.get(key)
            if isinstance(inner, dict):
                return inner
        return val
    return {}


def _record_list(val: Any) -> list[dict[str, Any]]:
    if isinstance(val, list):
        return [item for item in val if isinstance(item, dict)]
    if isinstance(val, dict):
        for key in ('data', 'items', 'list', 'files', 'attachments', 'rows'):
            inner = val.get(key)
            if isinstance(inner, list):
                return [item for item in inner if isinstance(item, dict)]
        return [val]
    return []


def _with_detail_folder_link(record: dict[str, Any], folder_link: str | None) -> dict[str, Any]:
    row = dict(record or {})
    row[_DETAIL_FOLDER_LINK_FIELD] = str(folder_link or '').strip()
    return row


def _flatten_custom_fields(detail: dict[str, Any]) -> list[dict[str, Any]]:
    form = detail.get('form') or detail.get('custom_fields') or detail.get('custom') or []
    if not isinstance(form, list):
        return []
    rows: list[dict[str, Any]] = []
    for field in form:
        if not isinstance(field, dict):
            continue
        rows.append({
            'field_name': field.get('label') or field.get('name') or '',
            'field_type': field.get('type') or '',
            'value': str(field.get('value') or field.get('selected') or ''),
        })
    return rows


def _extract_custom_tables(detail: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    form = detail.get('form') or detail.get('custom_fields') or detail.get('custom') or []
    if not isinstance(form, list):
        return {}
    tables: dict[str, list[dict[str, Any]]] = {}
    for field in form:
        if not isinstance(field, dict):
            continue
        if field.get('type') not in ('input-table', 'select-master', 'custom-table', 'budget'):
            continue
        label = field.get('label') or field.get('name') or 'custom_table'
        value = field.get('value')
        if isinstance(value, list):
            tables[label] = [row for row in value if isinstance(row, dict)]
        elif isinstance(value, dict):
            tables[label] = [value]
    return tables


def _extract_file_rows(payload: Any) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str]] = set()
    rows: list[dict[str, Any]] = []
    for item in _record_list(payload):
        row = {
            'file_id': item.get('id') or item.get('file_id') or item.get('hid') or '',
            'file_name': item.get('name') or item.get('file_name') or item.get('filename') or item.get('title') or '',
            'file_url': item.get('url') or item.get('link') or item.get('download_url') or item.get('web_url') or '',
            'file_size': item.get('size') or item.get('filesize') or '',
            'uploaded_by': item.get('username') or item.get('uploaded_by') or item.get('creator_name') or item.get('created_by') or '',
            'mime_type': item.get('mime_type') or item.get('type') or '',
        }
        dedupe_key = (str(row['file_id']), str(row['file_name']), str(row['file_url']))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        rows.append(row)
    return rows


def _extract_task_file_groups(detail: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    result_payload = _ensure_dict(detail.get('result'))
    review_payload = _ensure_dict(detail.get('review'))
    base_files = _extract_file_rows(detail.get('files') or detail.get('attachments'))
    result_files = _extract_file_rows(
        detail.get('result_files')
        or result_payload.get('files')
        or result_payload.get('result_files')
    )
    review_files = _extract_file_rows(
        detail.get('review_files')
        or review_payload.get('files')
        or result_payload.get('review_files')
    )
    return {
        'files': base_files,
        'result_files': result_files,
        'review_files': review_files,
    }


async def _update_log(db, run: BackupFlowRun, message: str) -> None:
    ts = datetime.utcnow().strftime('%H:%M:%S')
    run.logs = f"{run.logs or ''}\n[{ts}] {message}".strip()
    await db.commit()


async def _backup_task_detail(
    client: WeworkManagementClient,
    task: dict[str, Any],
    parent_folder_id: str,
    base_path: str,
    writer: BackupDestinationWriter,
    uploaded_files: list[dict[str, Any]],
) -> dict[str, Any]:
    task_id = _pick(task, _TASK_ID_FIELDS)
    task_name = _pick(task, _NAME_FIELDS)
    task_label = sanitize_name(f'[{task_id}] {truncate_name(task_name)}')
    task_folder_id = await writer.create_folder(task_label, parent_folder_id)
    task_path = f'{base_path}/{task_label}'

    try:
        detail = _ensure_dict(await client.get_task(task_id))
    except Exception as exc:
        logger.warning('Failed to load task detail for %s: %s', task_id, exc)
        detail = dict(task)

    info_folder_id = await writer.create_folder('1. Thông tin', task_folder_id)
    fid, _ = await writer.upload_excel(info_folder_id, 'Thông tin task.xlsx', [detail])
    uploaded_files.append({'path': f'{task_path}/1. Thông tin/Thông tin task.xlsx', 'file_id': fid})

    task_json = json.dumps(detail, ensure_ascii=False, indent=2, default=str)
    fid = await writer.upload_text(info_folder_id, 'task.json', task_json)
    uploaded_files.append({'path': f'{task_path}/1. Thông tin/task.json', 'file_id': fid})

    custom_fields = _flatten_custom_fields(detail)
    custom_tables = _extract_custom_tables(detail)
    if custom_fields or custom_tables:
        custom_folder_id = await writer.create_folder('2. Tùy chỉnh', task_folder_id)
        if custom_fields:
            fid, _ = await writer.upload_excel(
                custom_folder_id,
                'Thông tin trường tùy chỉnh.xlsx',
                custom_fields,
            )
            uploaded_files.append({
                'path': f'{task_path}/2. Tùy chỉnh/Thông tin trường tùy chỉnh.xlsx',
                'file_id': fid,
            })
        for table_name, table_rows in custom_tables.items():
            filename = f"{sanitize_name(table_name)}.xlsx"
            fid, _ = await writer.upload_excel(custom_folder_id, filename, table_rows)
            uploaded_files.append({
                'path': f'{task_path}/2. Tùy chỉnh/{filename}',
                'file_id': fid,
            })

    file_groups = _extract_task_file_groups(detail)
    if any(file_groups.values()):
        attachments_folder_id = await writer.create_folder('3. Tệp đính kèm', task_folder_id)
        attachment_specs = (
            ('files', 'Thông tin files.xlsx'),
            ('result_files', 'Thông tin result files.xlsx'),
            ('review_files', 'Thông tin review files.xlsx'),
        )
        for group_key, filename in attachment_specs:
            records = file_groups.get(group_key) or []
            if not records:
                continue
            fid, _ = await writer.upload_excel(attachments_folder_id, filename, records)
            uploaded_files.append({
                'path': f'{task_path}/3. Tệp đính kèm/{filename}',
                'file_id': fid,
            })

    return {
        'task_id': task_id,
        'task_name': task_name,
        'parent_id': str(task.get('parent_id') or ''),
        'folder': task_label,
        'folder_link': writer.get_folder_url(task_folder_id),
    }


async def run_wework_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        flow = await db.get(BackupFlow, flow_id)
        run = await db.get(BackupFlowRun, run_id)
        if flow is None or run is None:
            return

        client: WeworkManagementClient | None = None
        try:
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
            run.logs = '[RUNNING] Starting WeWork backup'
            await db.commit()

            destination_auth = {**destination_binding.auth, **destination_binding.config}
            validate_service_account_drive_destination(destination_auth)

            google_auth_service = GoogleAuthService(db)

            async def load_gdrive_token(force_refresh: bool = False):
                return await google_auth_service.get_destination_access_token_details(
                    destination_auth,
                    force_refresh=force_refresh,
                )

            get_token = build_cached_gdrive_token_provider(load_gdrive_token)
            root_folder_id = (
                destination_auth.get('folder_id')
                or destination_auth.get('drive_id')
                or 'root'
            )
            drive_id = destination_auth.get('drive_id')
            writer: BackupDestinationWriter = build_backup_destination_writer(
                destination_type=destination_binding.credential.app_id,
                get_token=get_token,
                root_folder_id=root_folder_id,
                drive_id=drive_id,
                flow_id=str(flow.id),
                flow_name=flow.name,
                app_folder_name='Base WeWork',
            )

            domain = source_binding.auth.get('domain') or source_binding.config.get('domain') or ''
            access_token = source_binding.auth.get('access_token') or source_binding.config.get('access_token') or ''
            credentials = WeworkCredentials(domain=domain, access_token=access_token)
            client = WeworkManagementClient(credentials)

            structure = dict(flow.structure or {})
            selected_objects = structure.get('objects') or ['department', 'project', 'task']
            project_ids = structure.get('project_ids') or []
            backup_type = flow.backup_type or 'all'

            has_department_scope = 'department' in selected_objects
            has_project_scope = 'project' in selected_objects
            has_task_scope = 'task' in selected_objects
            has_project_containers = has_project_scope or has_task_scope

            uploaded_files: list[dict[str, Any]] = []
            department_entries: list[dict[str, Any]] = []
            project_entries: list[dict[str, Any]] = []
            department_folder_links: dict[str, str] = {}
            project_folder_links: dict[str, str] = {}

            await _update_log(db, run, 'Preparing destination folder...')
            app_folder_name = sanitize_name('Base WeWork')
            app_folder_id, archived_count = await writer.prepare_app_folder()
            if archived_count:
                await _update_log(db, run, f'Archived {archived_count} old "{app_folder_name}" folder(s)')

            await _update_log(db, run, 'Fetching departments and projects...')
            all_departments = [item for item in await client.get_all_departments() if isinstance(item, dict)]
            all_projects = [item for item in await client.get_all_projects() if isinstance(item, dict)]
            await _update_log(db, run, f'Found {len(all_departments)} department(s), {len(all_projects)} project(s)')

            if project_ids:
                project_id_set = {str(item).strip() for item in project_ids if str(item).strip()}
                scoped_projects = [
                    project for project in all_projects
                    if _pick(project, _PROJECT_ID_FIELDS) in project_id_set
                ]
            else:
                scoped_projects = all_projects
            exported_projects = scoped_projects if has_project_containers else []

            department_name_by_id = {
                _pick(department, _ID_FIELDS): _pick(department, _NAME_FIELDS)
                for department in all_departments
                if _pick(department, _ID_FIELDS)
            }
            relevant_department_ids = {
                str(project.get('department_id') or project.get('dept_id') or project.get('parent_id') or '').strip()
                for project in exported_projects
                if str(project.get('department_id') or project.get('dept_id') or project.get('parent_id') or '').strip() not in ('', '0')
            }
            for department_id in relevant_department_ids:
                department_name_by_id.setdefault(department_id, f'Department {department_id}')

            if has_department_scope:
                if exported_projects:
                    exported_departments = [
                        department for department in all_departments
                        if _pick(department, _ID_FIELDS) in relevant_department_ids
                    ]
                    known_ids = {
                        _pick(department, _ID_FIELDS)
                        for department in exported_departments
                    }
                    for department_id in sorted(relevant_department_ids - known_ids):
                        exported_departments.append({
                            'id': department_id,
                            'name': department_name_by_id.get(department_id) or f'Department {department_id}',
                        })
                else:
                    exported_departments = all_departments
            else:
                exported_departments = []

            await _update_log(
                db,
                run,
                f'Will backup {len(exported_projects)} project(s) and {len(exported_departments)} department(s)',
            )

            await _update_log(db, run, 'Creating "0. Danh mục chung"...')
            common_folder_id = await writer.create_folder('0. Danh mục chung', app_folder_id)

            if has_department_scope:
                departments_parent_id = await writer.create_folder('1. Departments', app_folder_id)
                total_departments = len(exported_departments)
                for index, department in enumerate(exported_departments, 1):
                    department_id = _pick(department, _ID_FIELDS)
                    department_name = _pick(department, _NAME_FIELDS) or department_name_by_id.get(department_id) or department_id
                    department_label = sanitize_name(f'[{department_id}] {truncate_name(department_name)}')
                    await _update_log(db, run, f'[{index}/{total_departments}] Department "{department_name}"...')

                    department_folder_id = await writer.create_folder(department_label, departments_parent_id)
                    if department_id:
                        department_folder_links[department_id] = writer.get_folder_url(department_folder_id)

                    try:
                        department_detail = _ensure_dict(await client.get_department(department_id))
                    except Exception as exc:
                        logger.warning('Failed to load department detail for %s: %s', department_id, exc)
                        department_detail = dict(department)

                    fid, _ = await writer.upload_excel(
                        department_folder_id,
                        'Thông tin phòng ban.xlsx',
                        [department_detail],
                    )
                    uploaded_files.append({
                        'path': f'1. Departments/{department_label}/Thông tin phòng ban.xlsx',
                        'file_id': fid,
                    })
                    department_entries.append({
                        'department_id': department_id,
                        'department_name': department_name,
                        'folder': department_label,
                        'folder_link': writer.get_folder_url(department_folder_id),
                    })

            if has_project_containers:
                projects_parent_id = await writer.create_folder('2. Projects', app_folder_id)
                total_projects = len(exported_projects)
                for index, project in enumerate(exported_projects, 1):
                    project_id = _pick(project, _PROJECT_ID_FIELDS)
                    project_name = _pick(project, _NAME_FIELDS)
                    project_label = sanitize_name(f'[{project_id}] {truncate_name(project_name)}')
                    await _update_log(db, run, f'[{index}/{total_projects}] Project "{project_name}"...')

                    project_folder_id = await writer.create_folder(project_label, projects_parent_id)
                    if project_id:
                        project_folder_links[project_id] = writer.get_folder_url(project_folder_id)

                    department_id = str(project.get('department_id') or project.get('dept_id') or project.get('parent_id') or '').strip()
                    department_name = department_name_by_id.get(department_id) if department_id else None
                    project_path = f'2. Projects/{project_label}'

                    try:
                        snapshot = await client.get_project_snapshot(project_id)
                    except Exception as exc:
                        logger.warning('Failed to load project snapshot for %s: %s', project_id, exc)
                        snapshot = {
                            'project': project,
                            'tasklists': [],
                            'tasks': [],
                            'subtasks': [],
                            'milestones': [],
                            'raw': project,
                        }

                    project_detail = _ensure_dict(snapshot.get('project') or project)
                    project_raw = _ensure_dict(snapshot.get('raw') or project_detail)
                    tasklists = snapshot.get('tasklists') or []
                    milestones = snapshot.get('milestones') or []
                    merged_tasks = merge_task_collections(snapshot.get('tasks') or [], snapshot.get('subtasks') or [])

                    manifest_project: dict[str, Any] = {
                        'project_id': project_id,
                        'project_name': project_name,
                        'department_id': department_id or None,
                        'department_name': department_name,
                        'folder': project_label,
                        'folder_link': writer.get_folder_url(project_folder_id),
                        'tasks': [],
                    }

                    if has_project_scope:
                        project_info_folder_id = await writer.create_folder('1. Thông tin project', project_folder_id)
                        fid, _ = await writer.upload_excel(
                            project_info_folder_id,
                            'Thông tin project.xlsx',
                            [project_detail],
                        )
                        uploaded_files.append({
                            'path': f'{project_path}/1. Thông tin project/Thông tin project.xlsx',
                            'file_id': fid,
                        })

                        project_custom_fields = _flatten_custom_fields(project_raw)
                        if project_custom_fields:
                            fid, _ = await writer.upload_excel(
                                project_info_folder_id,
                                'Thông tin trường tùy chỉnh.xlsx',
                                project_custom_fields,
                            )
                            uploaded_files.append({
                                'path': f'{project_path}/1. Thông tin project/Thông tin trường tùy chỉnh.xlsx',
                                'file_id': fid,
                            })

                        project_custom_tables = _extract_custom_tables(project_raw)
                        for table_name, table_rows in project_custom_tables.items():
                            filename = f"{sanitize_name(table_name)}.xlsx"
                            fid, _ = await writer.upload_excel(project_info_folder_id, filename, table_rows)
                            uploaded_files.append({
                                'path': f'{project_path}/1. Thông tin project/{filename}',
                                'file_id': fid,
                            })

                    data_folder_id = await writer.create_folder('2. Danh sách dữ liệu', project_folder_id)
                    fid, cnt = await writer.upload_excel(
                        data_folder_id,
                        'Danh sách tasklist.xlsx',
                        tasklists,
                    )
                    uploaded_files.append({
                        'path': f'{project_path}/2. Danh sách dữ liệu/Danh sách tasklist.xlsx',
                        'file_id': fid,
                        'record_count': cnt,
                    })

                    fid, cnt = await writer.upload_excel(
                        data_folder_id,
                        'Danh sách milestone.xlsx',
                        milestones,
                    )
                    uploaded_files.append({
                        'path': f'{project_path}/2. Danh sách dữ liệu/Danh sách milestone.xlsx',
                        'file_id': fid,
                        'record_count': cnt,
                    })

                    task_folder_links: dict[str, str] = {}
                    if has_task_scope:
                        tasks_root_id = await writer.create_folder('3. Tasks', project_folder_id)
                        total_tasks = len(merged_tasks)
                        for task_index, task in enumerate(merged_tasks, 1):
                            task_name = _pick(task, _NAME_FIELDS)
                            if task_index % 10 == 1 or task_index == total_tasks:
                                await _update_log(db, run, f'    [{task_index}/{total_tasks}] Task "{task_name}"...')

                            task_entry = await _backup_task_detail(
                                client,
                                task,
                                tasks_root_id,
                                f'{project_path}/3. Tasks',
                                writer,
                                uploaded_files,
                            )
                            if task_entry.get('task_id'):
                                task_folder_links[str(task_entry['task_id'])] = str(task_entry.get('folder_link') or '')
                            manifest_project['tasks'].append(task_entry)

                    task_rows_with_links = [
                        _with_detail_folder_link(
                            task,
                            task_folder_links.get(_pick(task, _TASK_ID_FIELDS)),
                        )
                        for task in merged_tasks
                    ]
                    fid, cnt = await writer.upload_excel(
                        data_folder_id,
                        'Danh sách task.xlsx',
                        task_rows_with_links,
                        hyperlink_columns=(_DETAIL_FOLDER_LINK_FIELD,),
                    )
                    uploaded_files.append({
                        'path': f'{project_path}/2. Danh sách dữ liệu/Danh sách task.xlsx',
                        'file_id': fid,
                        'record_count': cnt,
                    })

                    project_entries.append(manifest_project)

            department_rows_with_links = [
                _with_detail_folder_link(
                    department,
                    department_folder_links.get(_pick(department, _ID_FIELDS)),
                )
                for department in all_departments
            ]
            fid, cnt = await writer.upload_excel(
                common_folder_id,
                'Danh sách phòng ban.xlsx',
                department_rows_with_links,
                hyperlink_columns=(_DETAIL_FOLDER_LINK_FIELD,),
            )
            uploaded_files.append({
                'path': '0. Danh mục chung/Danh sách phòng ban.xlsx',
                'file_id': fid,
                'record_count': cnt,
            })

            project_rows_with_links = [
                _with_detail_folder_link(
                    project,
                    project_folder_links.get(_pick(project, _PROJECT_ID_FIELDS)),
                )
                for project in all_projects
            ]
            fid, cnt = await writer.upload_excel(
                common_folder_id,
                'Danh sách project.xlsx',
                project_rows_with_links,
                hyperlink_columns=(_DETAIL_FOLDER_LINK_FIELD,),
            )
            uploaded_files.append({
                'path': '0. Danh mục chung/Danh sách project.xlsx',
                'file_id': fid,
                'record_count': cnt,
            })

            await _update_log(db, run, 'Writing backup manifest...')
            manifest = {
                'flow_id': str(flow.id),
                'flow_name': flow.name,
                'backup_type': backup_type,
                'connector': 'wework',
                'destination_type': writer.destination_type,
                'selected_objects': selected_objects,
                'department_count': len(department_entries),
                'project_count': len(project_entries),
                'total_files': len(uploaded_files),
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'departments': department_entries,
                'projects': project_entries,
            }
            manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2)
            fid = await writer.upload_text(common_folder_id, 'backup_manifest.json', manifest_json)
            uploaded_files.append({'path': '0. Danh mục chung/backup_manifest.json', 'file_id': fid})

            completed_at = datetime.utcnow()
            run.status = 'completed'
            run.completed_at = completed_at
            run.execution_details = {
                'mode': 'wework_backup',
                'backup_type': backup_type,
                'destination_writer': writer.destination_type,
                'uploaded_files': uploaded_files,
            }
            run.logs = (
                f"{run.logs}\n[COMPLETED] Uploaded {len(uploaded_files)} file(s) "
                f"across {len(department_entries)} department(s), {len(project_entries)} project(s)"
            )

            flow.last_run_at = completed_at
            flow.last_run_status = 'completed'
            flow.last_run_message = (
                f"Uploaded {len(uploaded_files)} file(s) across "
                f"{len(department_entries)} department(s), {len(project_entries)} project(s)"
            )
            await db.commit()
        except Exception as exc:
            logger.exception('WeWork backup failed for flow %s', flow_id)
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
