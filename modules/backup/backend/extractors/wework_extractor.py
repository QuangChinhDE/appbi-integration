"""
WeWork-specific backup extractor.

Produces the hierarchical folder structure:

    Base WeWork/
    ├── 0. Danh mục chung/
    │   ├── Danh sách phòng ban.xlsx
    │   ├── Danh sách project.xlsx
    │   └── backup_manifest.json
    └── 1. Departments/
        └── [ID] Department Name/
            ├── Thông tin phòng ban.xlsx           (when 'department' in objects)
            └── [ID] Project Name/
                ├── 1. Thông tin/                  (when 'project' in objects)
                │   ├── Thông tin project.xlsx
                │   ├── Danh sách tasklist.xlsx
                │   └── Danh sách milestone.xlsx
                ├── 2. Tùy chỉnh/                 (when 'project' in objects)
                │   └── Thông tin trường tùy chỉnh.xlsx
                └── 3. Tasks/                      (when 'task' in objects)
                    ├── Danh sách task.xlsx
                    └── [ID] Task Name/
                        ├── 1. Thông tin/
                        │   ├── Thông tin task.xlsx
                        │   └── task.json
                        ├── 2. Tùy chỉnh/
                        │   └── Thông tin trường tùy chỉnh.xlsx
                        └── 3. Công việc con/
                            └── [ID] Child Task/
                                └── … (recursive)
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
from modules.connectors.apps.wework.common.auth import WeworkCredentials
from modules.connectors.apps.wework.common.client import WeworkManagementClient
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


def _pick(record: dict, candidates: tuple[str, ...]) -> str:
    for key in candidates:
        val = record.get(key)
        if val not in (None, ''):
            return str(val).strip()
    return ''


def _flatten_custom_fields(detail: dict) -> list[dict]:
    form = detail.get('form') or detail.get('custom_fields') or detail.get('custom') or []
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
    """Extract custom-table / input-table fields from detail.

    Returns {table_label: [row_dicts]}.
    """
    form = detail.get('form') or detail.get('custom_fields') or detail.get('custom') or []
    if not isinstance(form, list):
        return {}
    tables: dict[str, list[dict]] = {}
    for field in form:
        if not isinstance(field, dict):
            continue
        if field.get('type') in ('input-table', 'select-master', 'custom-table', 'budget'):
            label = field.get('label') or field.get('name') or 'custom_table'
            value = field.get('value')
            if isinstance(value, list):
                tables[label] = [row for row in value if isinstance(row, dict)]
            elif isinstance(value, dict):
                tables[label] = [value]
    return tables


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


# ── Recursive task backup ───────────────────────────────────────────────────


async def _backup_task_recursive(
    client: WeworkManagementClient,
    task: dict,
    parent_folder_id: str,
    base_path: str,
    subtask_map: dict[str, list[dict]],
    get_token,
    drive_id: str | None,
    dest_type: str | None,
    uploaded_files: list[dict[str, Any]],
    depth: int = 0,
) -> dict[str, Any]:
    """Create the folder hierarchy for one task and its subtasks recursively."""

    t_id = _pick(task, _TASK_ID_FIELDS)
    t_name = _pick(task, _NAME_FIELDS)
    t_label = sanitize_name(f'[{t_id}] {truncate_name(t_name)}')

    t_folder_id = await gdrive_create_folder(
        get_token, t_label, parent_folder_id, drive_id=drive_id,
    )
    t_path = f'{base_path}/{t_label}'

    manifest_task: dict[str, Any] = {
        'task_id': t_id,
        'task_name': t_name,
        'folder': t_label,
        'subtasks': [],
    }

    # Fetch full task detail
    try:
        detail = await client.get_task(t_id)
    except Exception:
        detail = task

    # 1. Thông tin/
    info_folder_id = await gdrive_create_folder(
        get_token, '1. Thông tin', t_folder_id, drive_id=drive_id,
    )

    # Thông tin task.xlsx
    fid, _ = await _upload_excel(get_token, info_folder_id, 'Thông tin task.xlsx', [detail], dest_type)
    uploaded_files.append({'path': f'{t_path}/1. Thông tin/Thông tin task.xlsx', 'file_id': fid})

    # task.json
    task_json = json.dumps(detail, ensure_ascii=False, indent=2, default=str)
    fid = await _upload_text(get_token, info_folder_id, 'task.json', task_json)
    uploaded_files.append({'path': f'{t_path}/1. Thông tin/task.json', 'file_id': fid})

    # 2. Tùy chỉnh/
    cf_records = _flatten_custom_fields(detail)
    if cf_records:
        custom_folder_id = await gdrive_create_folder(
            get_token, '2. Tùy chỉnh', t_folder_id, drive_id=drive_id,
        )
        fid, _ = await _upload_excel(
            get_token, custom_folder_id, 'Thông tin trường tùy chỉnh.xlsx',
            cf_records, dest_type,
        )
        uploaded_files.append({'path': f'{t_path}/2. Tùy chỉnh/Thông tin trường tùy chỉnh.xlsx', 'file_id': fid})

    # 3. Công việc con/ (recursive)
    children = subtask_map.get(t_id, [])
    if children and depth < 10:  # safety limit on recursion
        child_folder_id = await gdrive_create_folder(
            get_token, '3. Công việc con', t_folder_id, drive_id=drive_id,
        )
        for child in children:
            child_entry = await _backup_task_recursive(
                client, child, child_folder_id, f'{t_path}/3. Công việc con',
                subtask_map, get_token, drive_id, dest_type,
                uploaded_files, depth + 1,
            )
            manifest_task['subtasks'].append(child_entry)

    return manifest_task


# ── Main runner ──────────────────────────────────────────────────────────────


async def run_wework_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        flow = await db.get(BackupFlow, flow_id)
        run = await db.get(BackupFlowRun, run_id)
        if flow is None or run is None:
            return

        client: WeworkManagementClient | None = None
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
            run.logs = '[RUNNING] Starting WeWork backup'
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

            # Build WeWork API client
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

            uploaded_files: list[dict[str, Any]] = []
            manifest_entries: list[dict[str, Any]] = []

            # ── Trash old folder and create fresh ────────────────────
            await _update_log(db, run, 'Preparing destination folder...')
            app_folder_name = sanitize_name('Base WeWork')
            app_folder_id, archived_count = await gdrive_recreate_folder(
                get_token, app_folder_name, root_folder_id, drive_id=drive_id,
            )
            if archived_count:
                await _update_log(db, run, f'Archived {archived_count} old "{app_folder_name}" folder(s)')

            # ── Fetch departments & projects ─────────────────────────
            await _update_log(db, run, 'Fetching departments and projects...')
            all_departments = await client.get_all_departments()
            all_projects = await client.get_all_projects()
            await _update_log(db, run, f'Found {len(all_departments)} department(s), {len(all_projects)} project(s)')

            # Filter projects if specific IDs selected
            if project_ids:
                proj_id_set = set(str(pid) for pid in project_ids)
                selected_projects = [
                    p for p in all_projects
                    if _pick(p, _PROJECT_ID_FIELDS) in proj_id_set
                ]
            else:
                selected_projects = all_projects

            # Group projects by department
            dept_project_map: dict[str, list[dict]] = {}
            for proj in selected_projects:
                dept_id = str(proj.get('department_id') or proj.get('dept_id') or proj.get('parent_id') or '0')
                dept_project_map.setdefault(dept_id, []).append(proj)

            # Only include departments that have selected projects
            relevant_dept_ids = set(dept_project_map.keys())
            relevant_depts = [
                d for d in all_departments
                if _pick(d, _ID_FIELDS) in relevant_dept_ids
            ]
            # Also include departments whose ID is in dept_project_map but not in all_departments
            known_dept_ids = set(_pick(d, _ID_FIELDS) for d in relevant_depts)
            for dept_id in relevant_dept_ids - known_dept_ids:
                if dept_id and dept_id != '0':
                    relevant_depts.append({'id': dept_id, 'name': f'Department {dept_id}'})

            await _update_log(db, run, f'Will backup {len(selected_projects)} project(s) across {len(relevant_depts)} department(s)')

            # ── 0. Danh mục chung ────────────────────────────────────
            await _update_log(db, run, 'Creating "0. Danh mục chung"...')
            common_folder_id = await gdrive_create_folder(
                get_token, '0. Danh mục chung', app_folder_id, drive_id=drive_id,
            )
            fid, cnt = await _upload_excel(
                get_token, common_folder_id, 'Danh sách phòng ban.xlsx',
                all_departments, dest_type,
            )
            uploaded_files.append({'path': '0. Danh mục chung/Danh sách phòng ban.xlsx', 'file_id': fid, 'record_count': cnt})

            fid, cnt = await _upload_excel(
                get_token, common_folder_id, 'Danh sách project.xlsx',
                all_projects, dest_type,
            )
            uploaded_files.append({'path': '0. Danh mục chung/Danh sách project.xlsx', 'file_id': fid, 'record_count': cnt})

            # ── 1. Departments/ ──────────────────────────────────────
            depts_parent_id = await gdrive_create_folder(
                get_token, '1. Departments', app_folder_id, drive_id=drive_id,
            )

            total_depts = len(relevant_depts)
            for d_index, dept in enumerate(relevant_depts, 1):
                dept_id = _pick(dept, _ID_FIELDS)
                dept_name = _pick(dept, _NAME_FIELDS)
                dept_label = sanitize_name(f'[{dept_id}] {truncate_name(dept_name)}')
                await _update_log(db, run, f'[{d_index}/{total_depts}] Department "{dept_name}"...')

                dept_folder_id = await gdrive_create_folder(
                    get_token, dept_label, depts_parent_id, drive_id=drive_id,
                )

                manifest_dept: dict[str, Any] = {
                    'department_id': dept_id,
                    'department_name': dept_name,
                    'folder': dept_label,
                    'projects': [],
                }

                # Thông tin phòng ban.xlsx
                if has_department_scope:
                    try:
                        dept_detail = await client.get_department(dept_id)
                    except Exception:
                        dept_detail = dept
                    fid, _ = await _upload_excel(
                        get_token, dept_folder_id, 'Thông tin phòng ban.xlsx',
                        [dept_detail], dest_type,
                    )
                    uploaded_files.append({
                        'path': f'1. Departments/{dept_label}/Thông tin phòng ban.xlsx', 'file_id': fid,
                    })

                # ── Projects in this department ──────────────────────
                dept_projects = dept_project_map.get(dept_id, [])
                proj_total = len(dept_projects)
                for p_index, project in enumerate(dept_projects, 1):
                    proj_id = _pick(project, _PROJECT_ID_FIELDS)
                    proj_name = _pick(project, _NAME_FIELDS)
                    proj_label = sanitize_name(f'[{proj_id}] {truncate_name(proj_name)}')
                    await _update_log(db, run, f'  [{p_index}/{proj_total}] Project "{proj_name}"...')

                    proj_folder_id = await gdrive_create_folder(
                        get_token, proj_label, dept_folder_id, drive_id=drive_id,
                    )

                    manifest_proj: dict[str, Any] = {
                        'project_id': proj_id,
                        'project_name': proj_name,
                        'folder': proj_label,
                        'tasks': [],
                    }

                    proj_path = f'1. Departments/{dept_label}/{proj_label}'

                    # Fetch project snapshot (has tasklists, tasks, subtasks, milestones)
                    try:
                        snapshot = await client.get_project_snapshot(proj_id)
                    except Exception as exc:
                        logger.warning('Failed to load project snapshot for %s: %s', proj_id, exc)
                        snapshot = {
                            'project': project,
                            'tasklists': [],
                            'tasks': [],
                            'subtasks': [],
                            'milestones': [],
                            'raw': project,
                        }

                    if has_project_scope:
                        # ── 1. Thông tin/ ────────────────────────────
                        info_folder_id = await gdrive_create_folder(
                            get_token, '1. Thông tin', proj_folder_id, drive_id=drive_id,
                        )

                        # Thông tin project.xlsx
                        proj_detail = snapshot.get('project') or project
                        fid, _ = await _upload_excel(
                            get_token, info_folder_id, 'Thông tin project.xlsx',
                            [proj_detail], dest_type,
                        )
                        uploaded_files.append({'path': f'{proj_path}/1. Thông tin/Thông tin project.xlsx', 'file_id': fid})

                        # Danh sách tasklist.xlsx
                        tasklists = snapshot.get('tasklists') or []
                        fid, _ = await _upload_excel(
                            get_token, info_folder_id, 'Danh sách tasklist.xlsx',
                            tasklists, dest_type,
                        )
                        uploaded_files.append({'path': f'{proj_path}/1. Thông tin/Danh sách tasklist.xlsx', 'file_id': fid})

                        # Danh sách milestone.xlsx
                        milestones = snapshot.get('milestones') or []
                        fid, _ = await _upload_excel(
                            get_token, info_folder_id, 'Danh sách milestone.xlsx',
                            milestones, dest_type,
                        )
                        uploaded_files.append({'path': f'{proj_path}/1. Thông tin/Danh sách milestone.xlsx', 'file_id': fid})

                        # ── 2. Tùy chỉnh/ ───────────────────────────
                        custom_folder_id = await gdrive_create_folder(
                            get_token, '2. Tùy chỉnh', proj_folder_id, drive_id=drive_id,
                        )
                        proj_raw = snapshot.get('raw') or proj_detail
                        cf_records = _flatten_custom_fields(proj_raw)
                        fid, _ = await _upload_excel(
                            get_token, custom_folder_id, 'Thông tin trường tùy chỉnh.xlsx',
                            cf_records, dest_type,
                        )
                        uploaded_files.append({'path': f'{proj_path}/2. Tùy chỉnh/Thông tin trường tùy chỉnh.xlsx', 'file_id': fid})

                        # Custom table xlsx files (e.g. custom_budget.xlsx)
                        custom_tables = _extract_custom_tables(proj_raw)
                        for table_name, table_rows in custom_tables.items():
                            safe_name = sanitize_name(table_name)
                            fname = f'{safe_name}.xlsx'
                            fid, _ = await _upload_excel(
                                get_token, custom_folder_id, fname, table_rows, dest_type,
                            )
                            uploaded_files.append({'path': f'{proj_path}/2. Tùy chỉnh/{fname}', 'file_id': fid})

                    if has_task_scope:
                        # ── 3. Tasks/ ────────────────────────────────
                        tasks_folder_id = await gdrive_create_folder(
                            get_token, '3. Tasks', proj_folder_id, drive_id=drive_id,
                        )

                        all_tasks = snapshot.get('tasks') or []
                        all_subtasks = snapshot.get('subtasks') or []

                        # Build subtask map: parent_id -> [child tasks]
                        subtask_map: dict[str, list[dict]] = {}
                        subtask_ids = set()
                        for st in all_subtasks:
                            parent_id = str(st.get('parent_id') or st.get('task_id') or '')
                            if parent_id:
                                subtask_map.setdefault(parent_id, []).append(st)
                                subtask_ids.add(_pick(st, _TASK_ID_FIELDS))

                        # Also check tasks that have parent_id (they might be subtasks too)
                        root_tasks = []
                        for t in all_tasks:
                            t_id_str = _pick(t, _TASK_ID_FIELDS)
                            parent = str(t.get('parent_id') or '')
                            if parent and parent != '0' and parent != proj_id:
                                # This task is a child of another task
                                subtask_map.setdefault(parent, []).append(t)
                                subtask_ids.add(t_id_str)
                            elif t_id_str not in subtask_ids:
                                root_tasks.append(t)

                        await _update_log(db, run, f'    Found {len(root_tasks)} root task(s), {len(all_subtasks)} subtask(s)')

                        # Danh sách task.xlsx
                        fid, _ = await _upload_excel(
                            get_token, tasks_folder_id, 'Danh sách task.xlsx',
                            all_tasks + all_subtasks, dest_type,
                        )
                        uploaded_files.append({'path': f'{proj_path}/3. Tasks/Danh sách task.xlsx', 'file_id': fid})

                        # Per-task folders (recursive)
                        task_total = len(root_tasks)
                        for tk_index, task in enumerate(root_tasks, 1):
                            tk_name = _pick(task, _NAME_FIELDS)
                            if tk_index % 10 == 1 or tk_index == task_total:
                                await _update_log(db, run, f'    [{tk_index}/{task_total}] Task "{tk_name}"...')

                            entry = await _backup_task_recursive(
                                client, task, tasks_folder_id,
                                f'{proj_path}/3. Tasks',
                                subtask_map, get_token, drive_id, dest_type,
                                uploaded_files,
                            )
                            manifest_proj['tasks'].append(entry)

                    manifest_dept['projects'].append(manifest_proj)
                manifest_entries.append(manifest_dept)

            # ── Write manifest into 0. Danh mục chung ────────────────
            await _update_log(db, run, 'Writing backup manifest...')
            manifest = {
                'backup_type': backup_type,
                'connector': 'wework',
                'department_count': len(relevant_depts),
                'project_count': len(selected_projects),
                'total_files': len(uploaded_files),
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'departments': manifest_entries,
            }
            manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2)
            fid = await _upload_text(get_token, common_folder_id, 'backup_manifest.json', manifest_json)
            uploaded_files.append({'path': '0. Danh mục chung/backup_manifest.json', 'file_id': fid})

            # ── Done ─────────────────────────────────────────────────
            completed_at = datetime.utcnow()
            run.status = 'completed'
            run.completed_at = completed_at
            run.execution_details = {
                'mode': 'wework_backup',
                'backup_type': backup_type,
                'uploaded_files': uploaded_files,
            }
            run.logs = (
                f"{run.logs}\n[COMPLETED] Uploaded {len(uploaded_files)} file(s) "
                f"across {len(relevant_depts)} department(s), {len(selected_projects)} project(s)"
            )

            flow.last_run_at = completed_at
            flow.last_run_status = 'completed'
            flow.last_run_message = (
                f"Uploaded {len(uploaded_files)} file(s) across "
                f"{len(relevant_depts)} department(s), {len(selected_projects)} project(s)"
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
