from __future__ import annotations

import asyncio
from html import unescape
import json
import traceback
from datetime import datetime, timezone
from typing import Any, Mapping

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.connectors.apps.request.backup.extractor import (
    GoogleDriveTokenProvider,
    build_cached_gdrive_token_provider,
    build_excel_bytes,
    gdrive_create_folder,
    gdrive_recreate_folder,
    gdrive_upload_bytes,
    sanitize_name,
    truncate_name,
)
from modules.connectors.apps.wework.common import (
    WeworkCredentials,
    WeworkManagementClient,
    merge_task_collections,
    normalize_wework_domain,
)
from packages.database.src.models import BackupFlow, BackupFlowRun
from packages.database.src.session import async_session


MANUALLY_STOPPED_RUN_MESSAGE = "Interrupted because the backup was manually stopped. Start the flow again to resume with a fresh run."
UNGROUPED_DEPARTMENT_KEY = "__ungrouped__"


class WeworkBackupExtractor:
    def __init__(self, client: WeworkManagementClient):
        self.client = client

    async def extract_catalog(self) -> dict[str, Any]:
        return {
            "departments": await self.client.get_all_departments(),
            "projects": await self.client.get_all_projects(),
        }

    async def extract_department(self, department_id: str) -> dict[str, Any]:
        return await self.client.get_department(department_id)

    async def extract_project_snapshot(self, project_id: str) -> dict[str, Any]:
        return await self.client.get_project_snapshot(project_id)

    async def extract_task(self, task_id: str) -> dict[str, Any]:
        return await self.client.get_task(task_id)

    async def extract_tasklist(self, tasklist_id: str) -> dict[str, Any]:
        return await self.client.get_tasklist(tasklist_id)


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _mapping_value(data: Mapping[str, Any] | None, *keys: str) -> Any:
    if not isinstance(data, Mapping):
        return None
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return None


def _json_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return unescape(value)
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _safe_filename(name: str, fallback: str, suffix: str = "") -> str:
    cleaned = sanitize_name(unescape(name or ""))
    if not cleaned:
        cleaned = fallback
    return f"{truncate_name(cleaned, 100)}{suffix}"


def _note_rows(message: str) -> list[dict[str, Any]]:
    return [{"Trạng thái": "Không có dữ liệu", "Chi tiết": message}]


def _normalize_excel_cell_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, (Mapping, list, tuple, set)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return value


def _normalize_excel_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        str(key): _normalize_excel_cell_value(value)
        for key, value in row.items()
    }


def _maybe_json(value: str) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return value


def _as_rows(value: Any) -> list[dict[str, Any]]:
    current = value
    if isinstance(current, str):
        current = _maybe_json(current)

    if isinstance(current, Mapping):
        nested = _first_non_empty(current.get("rows"), current.get("data"), current.get("items"))
        if nested is not None and nested is not current:
            current = nested
        else:
            current = [current]

    if not isinstance(current, list):
        return []

    rows: list[dict[str, Any]] = []
    for item in current:
        if isinstance(item, Mapping):
            rows.append(_normalize_excel_row(item))
        else:
            rows.append({"value": _normalize_excel_cell_value(item)})
    return rows


def _department_id(department: Mapping[str, Any]) -> str | None:
    value = _mapping_value(department, "dept_id", "id")
    return str(value) if value not in (None, "") else None


def _department_name(department: Mapping[str, Any]) -> str:
    value = _mapping_value(department, "name", "dept_name", "title")
    return unescape(str(value)) if value not in (None, "") else "Department"


def _department_folder_name(department: Mapping[str, Any]) -> str:
    department_id = _department_id(department)
    if department_id == UNGROUPED_DEPARTMENT_KEY:
        return _safe_filename("[unassigned] Chưa gán phòng ban", "department_unassigned")
    safe_department_id = department_id or "unknown"
    return _safe_filename(f"[{safe_department_id}] {_department_name(department)}", f"department_{safe_department_id}")


def _project_id(project: Mapping[str, Any]) -> str | None:
    value = _mapping_value(project, "project_id", "id")
    return str(value) if value not in (None, "") else None


def _project_name(project: Mapping[str, Any]) -> str:
    value = _mapping_value(project, "name", "project_name", "title")
    return unescape(str(value)) if value not in (None, "") else "Project"


def _project_department_id(project: Mapping[str, Any]) -> str | None:
    value = _mapping_value(project, "dept_id", "department_id", "group_id")
    return str(value) if value not in (None, "") else None


def _project_folder_name(project: Mapping[str, Any]) -> str:
    project_id = _project_id(project) or "unknown"
    return _safe_filename(f"[{project_id}] {_project_name(project)}", f"project_{project_id}")


def _task_id(task: Mapping[str, Any]) -> str | None:
    value = _mapping_value(task, "task_id", "id", "hid")
    return str(value) if value not in (None, "") else None


def _task_name(task: Mapping[str, Any]) -> str:
    value = _mapping_value(task, "name", "task_name", "title", "content")
    if value in (None, ""):
        task_id = _task_id(task) or "unknown"
        return f"Task {task_id}"
    return unescape(str(value))


def _task_parent_id(task: Mapping[str, Any]) -> str:
    value = _mapping_value(task, "parent_id")
    text = str(value).strip() if value not in (None, "") else "0"
    return "0" if text in {"", "0", "None", "null"} else text


def _task_folder_name(task: Mapping[str, Any]) -> str:
    task_id = _task_id(task) or "unknown"
    return _safe_filename(f"[{task_id}] {_task_name(task)}", f"task_{task_id}")


def _tasklist_id(tasklist: Mapping[str, Any]) -> str | None:
    value = _mapping_value(tasklist, "tasklist_id", "id")
    return str(value) if value not in (None, "") else None


def _tasklist_name(tasklist: Mapping[str, Any]) -> str:
    value = _mapping_value(tasklist, "name", "tasklist_name", "title")
    if value in (None, ""):
        tasklist_id = _tasklist_id(tasklist) or "unknown"
        return f"Tasklist {tasklist_id}"
    return unescape(str(value))


def _flatten_department_catalog_row(department: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "department_id": _department_id(department),
        "department_name": _department_name(department),
        "description": _mapping_value(department, "description", "content"),
        "raw": _json_text(department),
    }


def _flatten_project_catalog_row(project: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "project_id": _project_id(project),
        "project_name": _project_name(project),
        "department_id": _project_department_id(project),
        "owner": _mapping_value(project, "owner", "owners", "created_by"),
        "status": _mapping_value(project, "status"),
        "start_time": _mapping_value(project, "stime", "start_time"),
        "end_time": _mapping_value(project, "etime", "end_time"),
        "raw": _json_text(project),
    }


def _build_department_detail_row(department: Mapping[str, Any]) -> dict[str, Any]:
    return _normalize_excel_row(department)


def _build_project_detail_row(project: Mapping[str, Any], *, task_count: int, tasklist_count: int) -> dict[str, Any]:
    detail = dict(project)
    detail["task_count"] = task_count
    detail["tasklist_count"] = tasklist_count
    return _normalize_excel_row(detail)


def _build_tasklist_row(tasklist: Mapping[str, Any]) -> dict[str, Any]:
    return _normalize_excel_row(tasklist)


def _build_milestone_row(milestone: Mapping[str, Any]) -> dict[str, Any]:
    return _normalize_excel_row(milestone)


def _build_task_detail_row(task: Mapping[str, Any]) -> dict[str, Any]:
    return _normalize_excel_row(task)


def _extract_custom_field_entries(payload: Mapping[str, Any]) -> list[tuple[str, Any]]:
    entries: list[tuple[str, Any]] = []
    seen: set[str] = set()

    custom_fields = payload.get("custom_fields")
    if isinstance(custom_fields, Mapping):
        for key, value in custom_fields.items():
            field_name = str(key).strip()
            if not field_name or field_name in seen:
                continue
            seen.add(field_name)
            entries.append((field_name, value))
    elif isinstance(custom_fields, list):
        for index, item in enumerate(custom_fields, start=1):
            if isinstance(item, Mapping):
                field_name = str(
                    _first_non_empty(item.get("key"), item.get("name"), item.get("field"), item.get("label"))
                    or f"custom_field_{index}"
                ).strip()
                value = item.get("value")
            else:
                field_name = f"custom_field_{index}"
                value = item
            if not field_name or field_name in seen:
                continue
            seen.add(field_name)
            entries.append((field_name, value))

    for key, value in payload.items():
        key_text = str(key)
        if not key_text.startswith("custom_"):
            continue
        field_name = key_text[len("custom_") :].strip() or key_text
        if field_name in seen:
            continue
        seen.add(field_name)
        entries.append((field_name, value))

    return entries


def _build_custom_field_exports(payload: Mapping[str, Any], *, fallback_prefix: str) -> tuple[list[dict[str, Any]], list[tuple[str, list[dict[str, Any]]]]]:
    summary_rows: list[dict[str, Any]] = []
    table_exports: list[tuple[str, list[dict[str, Any]]]] = []

    for index, (field_name, raw_value) in enumerate(_extract_custom_field_entries(payload), start=1):
        value = _maybe_json(raw_value) if isinstance(raw_value, str) else raw_value
        is_structured = isinstance(value, (Mapping, list))
        rows = _as_rows(value) if is_structured else []

        if is_structured and rows:
            filename = _safe_filename(field_name, f"{fallback_prefix}_{index}", ".xlsx")
            summary_rows.append(
                {
                    "field": field_name,
                    "kind": "table",
                    "row_count": len(rows),
                    "export_file": filename,
                }
            )
            table_exports.append((filename, rows))
            continue

        summary_rows.append(
            {
                "field": field_name,
                "kind": "value",
                "value": _normalize_excel_cell_value(value),
            }
        )

    return summary_rows, table_exports


def _build_task_tree(tasks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    tasks_by_id = {
        task_id: task
        for task in tasks
        if (task_id := _task_id(task))
    }
    children_by_parent: dict[str, list[dict[str, Any]]] = {}

    for task in tasks:
        children_by_parent.setdefault(_task_parent_id(task), []).append(task)

    for children in children_by_parent.values():
        children.sort(key=lambda item: (_task_name(item).lower(), _task_id(item) or ""))

    roots: list[dict[str, Any]] = []
    seen_root_ids: set[str] = set()
    for task in tasks:
        task_id = _task_id(task) or f"__task_{len(roots)}"
        parent_id = _task_parent_id(task)
        if parent_id != "0" and parent_id in tasks_by_id and parent_id != task_id:
            continue
        if task_id in seen_root_ids:
            continue
        seen_root_ids.add(task_id)
        roots.append(task)

    if not roots:
        return sorted(tasks, key=lambda item: (_task_name(item).lower(), _task_id(item) or "")), children_by_parent

    roots.sort(key=lambda item: (_task_name(item).lower(), _task_id(item) or ""))
    return roots, children_by_parent


async def _upload_json_artifact(
    token: GoogleDriveTokenProvider,
    parent_id: str,
    filename: str,
    payload: Any,
) -> str:
    return await gdrive_upload_bytes(
        token,
        filename,
        json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8"),
        "application/json",
        parent_id,
    )


async def _upload_excel_rows(
    token: GoogleDriveTokenProvider,
    parent_id: str,
    filename: str,
    rows: list[dict[str, Any]],
) -> str:
    dataframe = pd.DataFrame(rows)
    return await gdrive_upload_bytes(
        token,
        filename,
        build_excel_bytes(dataframe),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        parent_id,
    )


async def _upload_excel_rows_or_note(
    token: GoogleDriveTokenProvider,
    parent_id: str,
    filename: str,
    rows: list[dict[str, Any]],
    empty_message: str,
) -> str:
    return await _upload_excel_rows(
        token,
        parent_id,
        filename,
        rows if rows else _note_rows(empty_message),
    )


async def _persist_custom_field_folder(
    *,
    gdrive_token: GoogleDriveTokenProvider,
    project_or_task_folder_id: str,
    payload: Mapping[str, Any],
    fallback_prefix: str,
) -> int:
    summary_rows, table_exports = _build_custom_field_exports(payload, fallback_prefix=fallback_prefix)
    if not summary_rows and not table_exports:
        return 0

    custom_folder_id = await gdrive_create_folder(gdrive_token, "2. Tùy chỉnh", project_or_task_folder_id)
    await _upload_excel_rows_or_note(
        gdrive_token,
        custom_folder_id,
        "Thông tin trường tùy chỉnh.xlsx",
        summary_rows,
        "Không có trường tùy chỉnh nào được Wework API trả về.",
    )

    for filename, rows in table_exports:
        await _upload_excel_rows(gdrive_token, custom_folder_id, filename, rows)

    return len(table_exports)


async def _persist_task_folder_tree(
    *,
    gdrive_token: GoogleDriveTokenProvider,
    parent_folder_id: str,
    task: Mapping[str, Any],
    children_by_parent: dict[str, list[dict[str, Any]]],
    log_lines: list[str],
    active_ids: set[str] | None = None,
) -> tuple[int, int]:
    task_folder_id = await gdrive_create_folder(gdrive_token, _task_folder_name(task), parent_folder_id)
    info_folder_id = await gdrive_create_folder(gdrive_token, "1. Thông tin", task_folder_id)

    await _upload_excel_rows(
        gdrive_token,
        info_folder_id,
        "Thông tin task.xlsx",
        [_build_task_detail_row(task)],
    )
    await _upload_json_artifact(gdrive_token, info_folder_id, "task.json", task)

    custom_tables_exported = await _persist_custom_field_folder(
        gdrive_token=gdrive_token,
        project_or_task_folder_id=task_folder_id,
        payload=task,
        fallback_prefix="task_custom",
    )

    task_id = _task_id(task)
    child_tasks = [
        child
        for child in children_by_parent.get(task_id or "", [])
        if _task_id(child) != task_id
    ]

    processed_count = 1
    next_active_ids = set(active_ids or set())
    if task_id:
        next_active_ids.add(task_id)

    if child_tasks:
        children_folder_id = await gdrive_create_folder(gdrive_token, "3. Công việc con", task_folder_id)
        for child in child_tasks:
            child_id = _task_id(child)
            if child_id and child_id in next_active_ids:
                log_lines.append(f"      - skip recursive child task {child_id} because parent chain is cyclic")
                continue

            child_count, child_custom_tables = await _persist_task_folder_tree(
                gdrive_token=gdrive_token,
                parent_folder_id=children_folder_id,
                task=child,
                children_by_parent=children_by_parent,
                log_lines=log_lines,
                active_ids=next_active_ids,
            )
            processed_count += child_count
            custom_tables_exported += child_custom_tables

    return processed_count, custom_tables_exported


def _build_department_placeholder(project: Mapping[str, Any]) -> dict[str, Any]:
    department_id = _project_department_id(project)
    if department_id:
        return {
            "id": department_id,
            "name": f"Department {department_id}",
        }
    return {
        "id": UNGROUPED_DEPARTMENT_KEY,
        "name": "Chưa gán phòng ban",
    }


async def run_wework_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        await _execute_wework_backup(flow_id, run_id, db)


async def _execute_wework_backup(flow_id: str, run_id: str, db: AsyncSession) -> None:
    flow = (await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))).scalar_one_or_none()
    run = (await db.execute(select(BackupFlowRun).where(BackupFlowRun.id == run_id))).scalar_one_or_none()
    if not flow or not run:
        return

    run.status = "running"
    log_lines = [f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] WeWork backup started"]
    total_departments = 0
    completed_departments = 0
    total_projects = 0
    completed_projects = 0
    total_tasks = 0
    completed_tasks = 0
    total_tasklists = 0
    custom_tables_exported = 0
    root_folder_id = None
    wework_root_folder_id = None
    current_step_label = "Initializing WeWork backup"

    async def persist_progress(
        phase: str,
        step_label: str,
        progress_percent: int,
        *,
        structure_path: str | None = None,
        current_department_id: str | None = None,
        current_department_name: str | None = None,
        current_project_id: str | None = None,
        current_project_name: str | None = None,
        current_task_id: str | None = None,
        current_task_name: str | None = None,
    ) -> None:
        nonlocal current_step_label
        current_step_label = step_label
        run.execution_details = {
            "app": "wework",
            "phase": phase,
            "step_label": step_label,
            "progress_percent": progress_percent,
            "root_folder_id": root_folder_id,
            "base_folder_id": wework_root_folder_id,
            "base_folder_name": "Base WeWork" if wework_root_folder_id else None,
            "structure_path": structure_path,
            "total_departments": total_departments,
            "completed_departments": completed_departments,
            "total_projects": total_projects,
            "completed_projects": completed_projects,
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "total_tasklists": total_tasklists,
            "custom_tables_exported": custom_tables_exported,
            "current_department_id": current_department_id,
            "current_department_name": current_department_name,
            "current_project_id": current_project_id,
            "current_project_name": current_project_name,
            "current_task_id": current_task_id,
            "current_task_name": current_task_name,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        run.logs = "\n".join(log_lines)
        flow.last_run_at = datetime.now(timezone.utc)
        flow.last_run_status = run.status
        flow.last_run_message = run.error_message or step_label
        await db.commit()

    await persist_progress("starting", current_step_label, 5)

    try:
        source = flow.source or {}
        encrypted_access_token = source.get("access_token_encrypted")
        if not encrypted_access_token:
            raise ValueError("No encrypted WeWork access token found in flow source")

        from modules.credentials.backend.services.google_auth_service import (
            GoogleAuthService,
            decrypt_value,
            validate_service_account_drive_destination,
        )

        wework_domain = normalize_wework_domain(str(source.get("domain") or ""))
        wework_access_token = decrypt_value(encrypted_access_token)
        credentials = WeworkCredentials(domain=wework_domain, access_token=wework_access_token)

        destination = flow.destination or {}
        auth = destination.get("auth") or {}
        validate_service_account_drive_destination(auth)
        google_auth_service = GoogleAuthService(db)

        async def load_gdrive_token(force_refresh: bool = False):
            return await google_auth_service.get_destination_access_token_details(
                auth,
                force_refresh=force_refresh,
            )

        get_gdrive_token = build_cached_gdrive_token_provider(load_gdrive_token)

        root_folder_id = auth.get("folder_id") or auth.get("drive_id") or "root"
        wework_root_folder_id, archived_root_folders = await gdrive_recreate_folder(
            get_gdrive_token,
            "Base WeWork",
            root_folder_id,
            drive_id=auth.get("drive_id"),
        )
        if archived_root_folders:
            log_lines.append(
                f"[INFO] Moved {archived_root_folders} existing Base WeWork folder(s) to trash before rebuilding backup tree"
            )
        await persist_progress(
            "preparing_destination",
            "Created Base WeWork root structure in Google Drive",
            15,
            structure_path="Base WeWork",
        )

        structure = flow.structure or {}
        selected_objects = {
            str(item).strip()
            for item in (structure.get("objects") or ["department", "project", "task"])
            if str(item).strip()
        }
        if not selected_objects:
            selected_objects = {"department", "project", "task"}

        include_department_details = "department" in selected_objects
        include_project_details = "project" in selected_objects
        include_task_details = "task" in selected_objects

        requested_project_ids = [
            str(item).strip()
            for item in (structure.get("project_ids") or [])
            if str(item).strip()
        ]

        async with WeworkManagementClient(credentials) as client:
            extractor = WeworkBackupExtractor(client)
            log_lines.append(f"[INFO] Domain: wework.{wework_domain}")
            catalog = await extractor.extract_catalog()
            departments = [dict(item) for item in catalog.get("departments", []) if isinstance(item, Mapping)]
            projects = [dict(item) for item in catalog.get("projects", []) if isinstance(item, Mapping)]
            if not projects:
                raise ValueError("No projects available for this token")

            catalog_folder_id = await gdrive_create_folder(get_gdrive_token, "0. Danh mục chung", wework_root_folder_id)
            await _upload_excel_rows(
                get_gdrive_token,
                catalog_folder_id,
                "Danh sách phòng ban.xlsx",
                [_flatten_department_catalog_row(department) for department in departments],
            )
            await _upload_excel_rows(
                get_gdrive_token,
                catalog_folder_id,
                "Danh sách project.xlsx",
                [_flatten_project_catalog_row(project) for project in projects],
            )

            departments_folder_id = await gdrive_create_folder(get_gdrive_token, "1. Departments", wework_root_folder_id)

            project_lookup = {
                project_id: project
                for project in projects
                if (project_id := _project_id(project))
            }
            project_ids = [project_id for project_id in requested_project_ids if project_id in project_lookup]
            if not project_ids:
                project_ids = list(project_lookup.keys())
            if not project_ids:
                raise ValueError("No matching selected projects were found for this token")

            department_keys = {
                _project_department_id(project_lookup[project_id]) or UNGROUPED_DEPARTMENT_KEY
                for project_id in project_ids
            }
            total_departments = len(department_keys)
            total_projects = len(project_ids)
            await persist_progress(
                "extracting_catalog",
                "Loaded WeWork catalog and selected project scope",
                25,
                structure_path="Base WeWork / 0. Danh mục chung",
            )

            department_cache = {
                (_department_id(department) or ""): department
                for department in departments
            }
            department_folder_ids: dict[str, str] = {}
            completed_department_keys: set[str] = set()

            for project_id in project_ids:
                project_meta = dict(project_lookup.get(project_id) or {"id": project_id, "name": f"Project {project_id}"})
                project_name = _project_name(project_meta)
                await persist_progress(
                    "processing_projects",
                    f"Processing project {project_name}",
                    30 + int((completed_projects / max(total_projects, 1)) * 55),
                    structure_path=f"Base WeWork / 1. Departments / {_project_folder_name(project_meta)}",
                    current_project_id=project_id,
                    current_project_name=project_name,
                )
                log_lines.append(f"[INFO] Project {project_id}: {project_name}")

                snapshot = await extractor.extract_project_snapshot(project_id)
                project_detail = dict(project_meta)
                project_detail.update(snapshot.get("project") or {})

                tasklists = [dict(item) for item in snapshot.get("tasklists", []) if isinstance(item, Mapping)]
                milestones = [dict(item) for item in snapshot.get("milestones", []) if isinstance(item, Mapping)]
                merged_tasks = [dict(item) for item in merge_task_collections(snapshot.get("tasks"), snapshot.get("subtasks"))]
                total_tasklists += len(tasklists)
                total_tasks += len(merged_tasks)

                department_key = _project_department_id(project_detail) or UNGROUPED_DEPARTMENT_KEY
                department_folder_id = department_folder_ids.get(department_key)
                department_detail = department_cache.get(department_key) or _build_department_placeholder(project_detail)

                if department_folder_id is None:
                    if department_key != UNGROUPED_DEPARTMENT_KEY:
                        try:
                            fresh_department = await extractor.extract_department(department_key)
                            if isinstance(fresh_department, Mapping):
                                department_detail.update(dict(fresh_department))
                        except Exception as exc:
                            log_lines.append(f"  - department {department_key}: detail enrich failed: {exc}")
                    department_folder_id = await gdrive_create_folder(
                        get_gdrive_token,
                        _department_folder_name(department_detail),
                        departments_folder_id,
                    )
                    department_folder_ids[department_key] = department_folder_id

                    if include_department_details:
                        await _upload_excel_rows(
                            get_gdrive_token,
                            department_folder_id,
                            "Thông tin phòng ban.xlsx",
                            [_build_department_detail_row(department_detail)],
                        )

                    completed_department_keys.add(department_key)
                    completed_departments = len(completed_department_keys)

                current_department_name = _department_name(department_detail)
                current_department_id = _department_id(department_detail) or department_key

                if not include_project_details and not include_task_details:
                    completed_projects += 1
                    await persist_progress(
                        "processing_projects",
                        f"Finished department-only export for project scope {project_name}",
                        30 + int((completed_projects / max(total_projects, 1)) * 55),
                        structure_path=f"Base WeWork / 1. Departments / {_department_folder_name(department_detail)}",
                        current_department_id=current_department_id,
                        current_department_name=current_department_name,
                        current_project_id=project_id,
                        current_project_name=project_name,
                    )
                    continue

                project_folder_id = await gdrive_create_folder(
                    get_gdrive_token,
                    _project_folder_name(project_detail),
                    department_folder_id,
                )
                project_structure_path = (
                    f"Base WeWork / 1. Departments / {_department_folder_name(department_detail)} / {_project_folder_name(project_detail)}"
                )

                if include_project_details:
                    info_folder_id = await gdrive_create_folder(get_gdrive_token, "1. Thông tin", project_folder_id)
                    await _upload_excel_rows(
                        get_gdrive_token,
                        info_folder_id,
                        "Thông tin project.xlsx",
                        [_build_project_detail_row(project_detail, task_count=len(merged_tasks), tasklist_count=len(tasklists))],
                    )

                    detailed_tasklists: list[dict[str, Any]] = []
                    for tasklist in tasklists:
                        tasklist_id = _tasklist_id(tasklist)
                        if tasklist_id:
                            try:
                                tasklist_detail = await extractor.extract_tasklist(tasklist_id)
                                merged_tasklist = dict(tasklist)
                                if isinstance(tasklist_detail, Mapping):
                                    merged_tasklist.update(dict(tasklist_detail))
                                detailed_tasklists.append(merged_tasklist)
                            except Exception as exc:
                                log_lines.append(f"  - tasklist {tasklist_id}: detail enrich failed: {exc}")
                                detailed_tasklists.append(tasklist)
                        else:
                            detailed_tasklists.append(tasklist)

                    await _upload_excel_rows_or_note(
                        get_gdrive_token,
                        info_folder_id,
                        "Danh sách tasklist.xlsx",
                        [_build_tasklist_row(tasklist) for tasklist in detailed_tasklists],
                        "Không có tasklist nào được Wework API trả về cho project này.",
                    )
                    await _upload_excel_rows_or_note(
                        get_gdrive_token,
                        info_folder_id,
                        "Danh sách milestone.xlsx",
                        [_build_milestone_row(milestone) for milestone in milestones],
                        "Không có milestone nào được Wework API trả về cho project này.",
                    )

                    custom_tables_exported += await _persist_custom_field_folder(
                        gdrive_token=get_gdrive_token,
                        project_or_task_folder_id=project_folder_id,
                        payload=project_detail,
                        fallback_prefix="project_custom",
                    )

                if include_task_details:
                    tasks_folder_id = await gdrive_create_folder(get_gdrive_token, "3. Tasks", project_folder_id)
                    detailed_tasks: list[dict[str, Any]] = []
                    for task in merged_tasks:
                        task_id = _task_id(task)
                        merged_task = dict(task)
                        if task_id:
                            try:
                                task_detail = await extractor.extract_task(task_id)
                                if isinstance(task_detail, Mapping):
                                    merged_task.update(dict(task_detail))
                            except Exception as exc:
                                log_lines.append(f"  - task {task_id}: detail enrich failed: {exc}")
                        detailed_tasks.append(merged_task)

                    await _upload_excel_rows_or_note(
                        get_gdrive_token,
                        tasks_folder_id,
                        "Danh sách task.xlsx",
                        [_build_task_detail_row(task) for task in detailed_tasks],
                        "Không có task nào được Wework API trả về cho project này.",
                    )

                    roots, children_by_parent = _build_task_tree(detailed_tasks)
                    for root_task in roots:
                        await persist_progress(
                            "processing_tasks",
                            f"Processing task {_task_name(root_task)}",
                            30 + int((completed_projects / max(total_projects, 1)) * 55),
                            structure_path=f"{project_structure_path} / 3. Tasks / {_task_folder_name(root_task)}",
                            current_department_id=current_department_id,
                            current_department_name=current_department_name,
                            current_project_id=project_id,
                            current_project_name=project_name,
                            current_task_id=_task_id(root_task),
                            current_task_name=_task_name(root_task),
                        )
                        exported_tasks, task_custom_tables = await _persist_task_folder_tree(
                            gdrive_token=get_gdrive_token,
                            parent_folder_id=tasks_folder_id,
                            task=root_task,
                            children_by_parent=children_by_parent,
                            log_lines=log_lines,
                        )
                        completed_tasks += exported_tasks
                        custom_tables_exported += task_custom_tables

                completed_projects += 1
                await persist_progress(
                    "processing_projects",
                    f"Finished project {project_name}",
                    30 + int((completed_projects / max(total_projects, 1)) * 55),
                    structure_path=project_structure_path,
                    current_department_id=current_department_id,
                    current_department_name=current_department_name,
                    current_project_id=project_id,
                    current_project_name=project_name,
                )

            manifest = {
                "flow_id": str(flow.id),
                "run_id": str(run.id),
                "app": "wework",
                "backup_type": flow.backup_type,
                "selected_objects": sorted(selected_objects),
                "project_ids": project_ids,
                "counts": {
                    "total_departments": total_departments,
                    "completed_departments": completed_departments,
                    "total_projects": total_projects,
                    "completed_projects": completed_projects,
                    "total_tasks": total_tasks,
                    "completed_tasks": completed_tasks,
                    "total_tasklists": total_tasklists,
                    "custom_tables_exported": custom_tables_exported,
                },
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
            await _upload_json_artifact(get_gdrive_token, catalog_folder_id, "backup_manifest.json", manifest)

        await persist_progress(
            "finalizing",
            "Finalizing WeWork backup artifacts",
            95,
            structure_path="Base WeWork",
        )
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        log_lines.append(
            f"[DONE] {total_departments} department(s), {total_projects} project(s), {completed_tasks}/{total_tasks} task(s), {custom_tables_exported} custom table export(s)"
        )
        await persist_progress(
            "completed",
            f"Completed WeWork backup: {total_projects} project(s), {completed_tasks}/{total_tasks} task(s)",
            100,
            structure_path="Base WeWork",
        )
    except asyncio.CancelledError:
        run.status = "failed"
        run.completed_at = datetime.now(timezone.utc)
        run.error_message = run.error_message or MANUALLY_STOPPED_RUN_MESSAGE
        log_lines.append(f"[INTERRUPTED] {MANUALLY_STOPPED_RUN_MESSAGE}")
        await persist_progress(
            "failed",
            f"WeWork backup was manually stopped: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_department_id=(run.execution_details or {}).get("current_department_id"),
            current_department_name=(run.execution_details or {}).get("current_department_name"),
            current_project_id=(run.execution_details or {}).get("current_project_id"),
            current_project_name=(run.execution_details or {}).get("current_project_name"),
            current_task_id=(run.execution_details or {}).get("current_task_id"),
            current_task_name=(run.execution_details or {}).get("current_task_name"),
        )
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        log_lines.append(f"[ERROR] {exc}\n{traceback.format_exc()}")
        await persist_progress(
            "failed",
            f"Failed while running WeWork backup: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_department_id=(run.execution_details or {}).get("current_department_id"),
            current_department_name=(run.execution_details or {}).get("current_department_name"),
            current_project_id=(run.execution_details or {}).get("current_project_id"),
            current_project_name=(run.execution_details or {}).get("current_project_name"),
            current_task_id=(run.execution_details or {}).get("current_task_id"),
            current_task_name=(run.execution_details or {}).get("current_task_name"),
        )
    finally:
        run.logs = "\n".join(log_lines)
        flow_update = (await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))).scalar_one_or_none()
        if flow_update:
            flow_update.last_run_at = datetime.now(timezone.utc)
            flow_update.last_run_status = run.status
            flow_update.last_run_message = run.error_message or (
                f"{completed_projects}/{total_projects} project(s), {completed_tasks}/{max(total_tasks, completed_tasks)} task(s)"
            )
        await db.commit()