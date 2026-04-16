from __future__ import annotations

import asyncio
import base64
from html import unescape
import json
import re
import traceback
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.connectors.apps.request.backup.extractor import (
    GoogleDriveTokenProvider,
    build_cached_gdrive_token_provider,
    build_excel_bytes,
    gdrive_create_folder,
    gdrive_recreate_folder,
    gdrive_upload_tabular_bytes,
    gdrive_upload_bytes,
    sanitize_name,
    truncate_name,
)
from modules.connectors.apps.workflow.common import (
    WorkflowCredentials,
    WorkflowManagementClient,
    normalize_workflow_domain,
)
from packages.database.src.models import BackupFlow, BackupFlowRun
from packages.database.src.session import async_session


MANUALLY_STOPPED_RUN_MESSAGE = "Interrupted because the backup was manually stopped. Start the flow again to resume with a fresh run."


class WorkflowBackupExtractor:
    def __init__(self, client: WorkflowManagementClient):
        self.client = client

    async def extract_catalog(self) -> dict[str, Any]:
        return {"workflows": await self.client.get_all_workflows()}

    async def extract_workflow_inventory(
        self,
        workflow_id: str,
        *,
        include_jobs: bool,
        job_filters: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        workflow_task = self.client.get_workflow(workflow_id)
        stages_task = self.client.get_workflow_stages(workflow_id)
        jobs_task = self.client.get_workflow_jobs(workflow_id, filters=job_filters) if include_jobs else _completed_result([])
        workflow, stages, jobs = await asyncio.gather(workflow_task, stages_task, jobs_task)
        return {
            "workflow_id": workflow_id,
            "workflow": workflow,
            "stages": stages,
            "jobs": jobs,
        }

    async def extract_job(
        self,
        job_id: str,
        *,
        include_custom_tables: bool,
        include_posts: bool,
        include_comments: bool,
    ) -> dict[str, Any]:
        bundle = {"job": await self.client.get_job(job_id)}
        if include_custom_tables:
            bundle["custom_table"] = await self.client.get_job_custom_table(job_id)
        if include_posts:
            posts = await self.client.get_job_posts(job_id)
            bundle["posts"] = posts
            if include_comments:
                comments_payload = []
                for post in posts:
                    post_id = _post_id(post)
                    if not post_id:
                        continue
                    comments_payload.append({
                        "post_id": post_id,
                        "comments": await self.client.get_job_comments(post_id),
                    })
                bundle["comments"] = comments_payload
        return bundle


async def _completed_result(value: Any) -> Any:
    return value


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


def _normalize_lookup_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _note_rows(message: str) -> list[dict[str, Any]]:
    return [{"Trạng thái": "Không có dữ liệu", "Chi tiết": message}]


def _b64_decode(value: str) -> bytes:
    clean = "".join((value or "").split())
    clean += "=" * ((4 - len(clean) % 4) % 4)
    return base64.urlsafe_b64decode(clean.encode("ascii"))


def _decode_json_payload(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str) or not value:
        return None

    for decoder in (
        lambda item: json.loads(item),
        lambda item: json.loads(_b64_decode(item).decode("utf-8")),
    ):
        try:
            return decoder(value)
        except Exception:
            continue
    return None


def _as_rows(value: Any) -> list[dict[str, Any]]:
    current = value
    if isinstance(current, str):
        try:
            current = json.loads(current)
        except Exception:
            return []

    if isinstance(current, Mapping):
        nested = _first_non_empty(
            current.get("rows"),
            current.get("data"),
            current.get("items"),
        )
        if nested is not None and nested is not current:
            current = nested
        else:
            current = [current]

    if not isinstance(current, list):
        return []

    output: list[dict[str, Any]] = []
    for item in current:
        if isinstance(item, Mapping):
            output.append(dict(item))
        else:
            output.append({"value": item})
    return output


def _safe_excel_export_name(name: Any, fallback: str) -> str:
    return _safe_filename(str(name or fallback), fallback, ".xlsx")


def _dedupe_filename(filename: str, seen: dict[str, int]) -> str:
    if filename not in seen:
        seen[filename] = 1
        return filename

    seen[filename] += 1
    if filename.lower().endswith(".xlsx"):
        stem = filename[:-5]
        ext = ".xlsx"
    else:
        stem = filename
        ext = ""
    return f"{stem} ({seen[filename]}){ext}"


def _category_from_hint(*hints: Any) -> str:
    normalized_hints = [_normalize_lookup_key(str(hint)) for hint in hints if hint not in (None, "")]
    for hint in normalized_hints:
        if "selectmaster" in hint or ("select" in hint and "master" in hint):
            return "custom_select_master.xlsx"
        if "inputtable" in hint or ("input" in hint and "table" in hint):
            return "custom_input_table.xlsx"
        if "customfield" in hint or hint.endswith("fields") or hint.endswith("field") or "formfield" in hint:
            return "custom_fields.xlsx"
    return "custom_fields.xlsx"


def _extend_rows(target: list[dict[str, Any]], rows: list[dict[str, Any]], *, source_name: str | None = None) -> None:
    for row in rows:
        normalized = dict(row)
        if source_name and "Nguồn dữ liệu" not in normalized:
            normalized["Nguồn dữ liệu"] = source_name
        target.append(normalized)


def _extract_nested_rows(
    payload: Any,
    *,
    exact_keys: Iterable[str] = (),
    fuzzy_terms: Iterable[str] = (),
    max_depth: int = 3,
) -> list[dict[str, Any]]:
    exact_lookup = {_normalize_lookup_key(key) for key in exact_keys}
    fuzzy_lookup = tuple(_normalize_lookup_key(term) for term in fuzzy_terms)

    def walk(current: Any, depth: int) -> list[dict[str, Any]]:
        if depth < 0:
            return []
        if isinstance(current, Mapping):
            for key, value in current.items():
                normalized_key = _normalize_lookup_key(str(key))
                if normalized_key in exact_lookup or any(term and term in normalized_key for term in fuzzy_lookup):
                    rows = _as_rows(value)
                    if rows:
                        return rows
                rows = walk(value, depth - 1)
                if rows:
                    return rows
        elif isinstance(current, list):
            for item in current:
                rows = walk(item, depth - 1)
                if rows:
                    return rows
        return []

    return walk(payload, max_depth)


def _workflow_id(workflow: Mapping[str, Any]) -> str | None:
    value = _mapping_value(workflow, "workflow_id", "id", "hid")
    return str(value) if value not in (None, "") else None


def _workflow_name(workflow: Mapping[str, Any]) -> str:
    value = _mapping_value(workflow, "workflow_name", "name", "title")
    return unescape(str(value)) if value not in (None, "") else "Workflow"


def _workflow_folder_name(workflow: Mapping[str, Any]) -> str:
    workflow_id = _workflow_id(workflow) or "unknown"
    return _safe_filename(f"[{workflow_id}] {_workflow_name(workflow)}", f"workflow_{workflow_id}")


def _stage_id(stage: Mapping[str, Any]) -> str | None:
    value = _mapping_value(stage, "stage_id", "id", "hid")
    return str(value) if value not in (None, "") else None


def _stage_name(stage: Mapping[str, Any]) -> str:
    value = _mapping_value(stage, "stage_name", "name", "title")
    return unescape(str(value)) if value not in (None, "") else "Stage"


def _job_id(job: Mapping[str, Any]) -> str | None:
    value = _mapping_value(job, "job_id", "id", "hid")
    return str(value) if value not in (None, "") else None


def _job_code(job: Mapping[str, Any]) -> str:
    value = _mapping_value(job, "job_code", "code", "id", "hid")
    return str(value) if value not in (None, "") else "job"


def _job_name(job: Mapping[str, Any]) -> str:
    value = _mapping_value(job, "job_name", "name", "title")
    return unescape(str(value)) if value not in (None, "") else _job_code(job)


def _job_folder_name(job: Mapping[str, Any]) -> str:
    job_id = _job_id(job) or _job_code(job)
    return _safe_filename(f"[{job_id}] {_job_name(job)}", f"job_{job_id}")


def _post_id(post: Mapping[str, Any]) -> str | None:
    value = _mapping_value(post, "hid", "post_id", "id")
    return str(value) if value not in (None, "") else None


def _post_author(post: Mapping[str, Any]) -> str:
    value = _mapping_value(post, "username", "author_name", "creator_name", "created_by")
    return unescape(str(value)) if value not in (None, "") else "Unknown"


def _post_text(post: Mapping[str, Any]) -> str:
    value = _mapping_value(post, "content", "message", "body", "text")
    return unescape(str(value)) if value not in (None, "") else ""


def _comment_author(comment: Mapping[str, Any]) -> str:
    value = _mapping_value(comment, "username", "author_name", "creator_name", "created_by")
    return unescape(str(value)) if value not in (None, "") else "Unknown"


def _comment_text(comment: Mapping[str, Any]) -> str:
    value = _mapping_value(comment, "content", "message", "body", "text")
    return unescape(str(value)) if value not in (None, "") else ""


def _flatten_workflow_row(workflow: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "workflow_id": _workflow_id(workflow),
        "workflow_name": _workflow_name(workflow),
        "status": _mapping_value(workflow, "status"),
        "created_at": _mapping_value(workflow, "created_at", "created_time", "time_created"),
        "updated_at": _mapping_value(workflow, "updated_at", "updated_time", "time_updated"),
        "owner": _mapping_value(workflow, "owner", "username", "created_by"),
        "raw": _json_text(workflow),
    }


def _flatten_stage_row(stage: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "stage_id": _stage_id(stage),
        "stage_name": _stage_name(stage),
        "type": _mapping_value(stage, "type", "status"),
        "raw": _json_text(stage),
    }


def _flatten_job_row(job: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "job_id": _job_id(job),
        "job_code": _job_code(job),
        "job_name": _job_name(job),
        "stage_id": _mapping_value(job, "stage_id", "current_stage_id", "block_id"),
        "status": _mapping_value(job, "status"),
        "created_at": _mapping_value(job, "created_at", "created_time", "time_created"),
        "updated_at": _mapping_value(job, "updated_at", "updated_time", "time_updated"),
        "deadline": _mapping_value(job, "deadline", "deadline_at"),
        "assignee": _mapping_value(job, "assignee", "assigned_to", "assignee_name"),
        "raw": _json_text(job),
    }


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


def _get_form_items(job: Mapping[str, Any]) -> list[dict[str, Any]]:
    form_items = job.get("form")
    if not isinstance(form_items, list):
        return []
    return [dict(item) for item in form_items if isinstance(item, Mapping)]


def _decode_table_placeholder_definition(placeholder: Any) -> list[dict[str, Any]]:
    decoded = _decode_json_payload(placeholder)
    if isinstance(decoded, list):
        return [dict(item) for item in decoded if isinstance(item, Mapping)]
    return []


def _extract_display_value_from_object(value: Mapping[str, Any], column_type: str | None = None) -> Any:
    vals = value.get("vals")
    if isinstance(vals, list):
        first_value = next(
            (
                item.get("value")
                for item in vals
                if isinstance(item, Mapping) and item.get("value") not in (None, "")
            ),
            None,
        )
        if first_value not in (None, ""):
            return first_value

    if column_type == "lookup-master":
        return _first_non_empty(value.get("value"), value.get("title"), value.get("name"), value.get("id"))

    if column_type == "select-master":
        return _first_non_empty(value.get("title"), value.get("value"), value.get("name"), value.get("id"))

    return _first_non_empty(value.get("value"), value.get("title"), value.get("name"), value.get("id"), value)


def _decode_form_cell_value(value: Any, column_type: str | None = None) -> Any:
    decoded = _decode_json_payload(value)
    if isinstance(decoded, Mapping):
        return _normalize_excel_cell_value(_extract_display_value_from_object(decoded, column_type))
    if isinstance(decoded, list):
        return _normalize_excel_cell_value(decoded)
    return _normalize_excel_cell_value(value)


def _build_job_detail_row(job: Mapping[str, Any]) -> dict[str, Any]:
    return _normalize_excel_row(job)


def _extract_job_rows_from_key(job: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    rows = _as_rows(job.get(key))
    return [_normalize_excel_row(row) for row in rows]


def _extract_job_custom_field_rows(job: Mapping[str, Any]) -> list[dict[str, Any]]:
    row: dict[str, Any] = {}
    for item in _get_form_items(job):
        item_type = str(item.get("type") or "").strip()
        if item_type in {"input-table", "select-master"}:
            continue

        column_name = str(item.get("name") or "").strip()
        if not column_name:
            continue

        row[column_name] = _normalize_excel_cell_value(item.get("value"))

    return [row] if row else []


def _extract_input_table_rows(form_item: Mapping[str, Any]) -> list[dict[str, Any]]:
    column_defs = _decode_table_placeholder_definition(form_item.get("placeholder"))
    headers = [str(item.get("name") or index + 1) for index, item in enumerate(column_defs)]
    column_types = [str(item.get("type") or "") for item in column_defs]

    raw_rows = _decode_json_payload(form_item.get("display"))
    if not isinstance(raw_rows, list):
        raw_rows = _decode_json_payload(form_item.get("value"))
    if not isinstance(raw_rows, list):
        return []

    if not headers and raw_rows and isinstance(raw_rows[0], list):
        headers = [str(index + 1) for index in range(len(raw_rows[0]))]
        column_types = [""] * len(headers)

    output: list[dict[str, Any]] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, list):
            continue
        row: dict[str, Any] = {}
        for index, header in enumerate(headers):
            cell_value = raw_row[index] if index < len(raw_row) else ""
            column_type = column_types[index] if index < len(column_types) else None
            row[header] = _decode_form_cell_value(cell_value, column_type)
        output.append(row)

    return output


def _extract_select_master_rows(form_item: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_items = _decode_json_payload(form_item.get("value"))
    if not isinstance(raw_items, list):
        return []

    output: list[dict[str, Any]] = []
    fallback_header = str(form_item.get("name") or "Giá trị")
    for raw_item in raw_items:
        if not isinstance(raw_item, Mapping):
            continue
        vals = raw_item.get("vals")
        if isinstance(vals, list):
            row: dict[str, Any] = {}
            for index, item in enumerate(vals):
                if not isinstance(item, Mapping):
                    continue
                header = str(item.get("name") or item.get("id") or f"Cột {index + 1}")
                row[header] = _normalize_excel_cell_value(item.get("value"))
            if row:
                output.append(row)
                continue

        output.append({
            fallback_header: _normalize_excel_cell_value(
                _first_non_empty(raw_item.get("title"), raw_item.get("value"), raw_item.get("name"), raw_item.get("id"))
            )
        })

    return output


def _extract_job_form_table_exports(job: Mapping[str, Any]) -> list[tuple[str, list[dict[str, Any]], str]]:
    exports: list[tuple[str, list[dict[str, Any]], str]] = []
    seen_filenames: dict[str, int] = {}

    for item in _get_form_items(job):
        item_type = str(item.get("type") or "").strip()
        if item_type not in {"input-table", "select-master"}:
            continue

        filename = _dedupe_filename(
            _safe_excel_export_name(item.get("name") or item.get("id") or item_type, item_type),
            seen_filenames,
        )

        if item_type == "select-master":
            rows = _extract_select_master_rows(item)
            empty_message = f"Không thể đọc dữ liệu select-master cho trường '{item.get('name') or item.get('id') or item_type}'."
        else:
            rows = _extract_input_table_rows(item)
            empty_message = f"Không thể đọc dữ liệu input-table cho trường '{item.get('name') or item.get('id') or item_type}'."

        exports.append((filename, rows, empty_message))

    return exports


def _extract_job_log_rows(job: Mapping[str, Any]) -> list[dict[str, Any]]:
    return _extract_job_rows_from_key(job, "logs")


def _extract_job_move_rows(job: Mapping[str, Any]) -> list[dict[str, Any]]:
    return _extract_job_rows_from_key(job, "moves")


def _extract_job_file_rows(job: Mapping[str, Any]) -> list[dict[str, Any]]:
    return _extract_nested_rows(
        job,
        exact_keys=("files", "file_info", "file_infos", "attachments", "attachment_list"),
        fuzzy_terms=("attachments", "fileinfo", "filelist"),
    )


def _split_custom_table_exports(custom_table_payload: Any) -> dict[str, list[dict[str, Any]]]:
    exports = {
        "custom_fields.xlsx": [],
        "custom_input_table.xlsx": [],
        "custom_select_master.xlsx": [],
    }

    if isinstance(custom_table_payload, Mapping):
        matched_nested = False
        for key, value in custom_table_payload.items():
            rows = _as_rows(value)
            if not rows:
                continue
            filename = _category_from_hint(key)
            _extend_rows(exports[filename], rows, source_name=str(key))
            matched_nested = True

        if matched_nested:
            return exports

    direct_rows = _as_rows(custom_table_payload)
    for row in direct_rows:
        filename = _category_from_hint(
            row.get("type"),
            row.get("field_type"),
            row.get("name"),
            row.get("title"),
        )
        exports[filename].append(dict(row))

    return exports


def _build_workflow_readme_text(workflow: Mapping[str, Any], *, include_jobs: bool, include_posts: bool) -> str:
    lines = [
        f"Workflow: {_workflow_name(workflow)}",
        f"Workflow ID: {_workflow_id(workflow) or 'unknown'}",
        "",
        "Cấu trúc backup:",
        "- 0. Hướng dẫn: Mô tả nhanh về cấu trúc thư mục.",
        "- 1. Cấu hình workflow: Thông tin workflow và danh sách stage.",
    ]

    if include_jobs:
        lines.extend([
            "- 2. Danh sách công việc: Danh sách job lấy được từ Workflow API.",
            "- 3. Jobs: Một thư mục cho mỗi job, gồm Thông tin, Dữ liệu nhập, Nội dung, và Tệp đính kèm.",
            "",
            "Ghi chú:",
            "- Thông tin job log và job moves được trích từ payload chi tiết job khi Workflow API có trả dữ liệu.",
            "- Nếu API không trả dữ liệu cho một phần, file tương ứng vẫn được tạo với trạng thái 'Không có dữ liệu'.",
            f"- {'Có' if include_posts else 'Không'} xuất post_and_comment.txt trong lần backup này.",
        ])
    else:
        lines.extend([
            "",
            "Ghi chú:",
            "- Flow này chỉ sao lưu cấu hình workflow, không tạo danh sách job hoặc thư mục job chi tiết.",
        ])

    return "\n".join(lines)


def _render_file_info_text(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "Không có dữ liệu file hoặc attachment nào được Workflow API trả về cho job này tại thời điểm backup."

    lines = []
    for index, row in enumerate(rows, start=1):
        name = _first_non_empty(
            row.get("name"),
            row.get("file_name"),
            row.get("filename"),
            row.get("title"),
        ) or f"File {index}"
        details = []
        for label, value in (
            ("id", _first_non_empty(row.get("id"), row.get("file_id"), row.get("hid"))),
            ("size", _first_non_empty(row.get("size"), row.get("file_size"))),
            ("url", _first_non_empty(row.get("url"), row.get("download_url"), row.get("link"), row.get("path"))),
        ):
            if value not in (None, ""):
                details.append(f"{label}: {value}")
        lines.append(f"{index}. {name}" + (f" ({'; '.join(details)})" if details else ""))
    return "\n".join(lines)


def _render_discussion_text(posts: list[dict[str, Any]], comments_payload: list[dict[str, Any]]) -> str:
    comments_by_post = {
        str(item.get("post_id")): item.get("comments") or []
        for item in comments_payload
        if isinstance(item, Mapping)
    }

    lines: list[str] = []
    for index, post in enumerate(posts, start=1):
        post_id = _post_id(post) or f"post_{index}"
        lines.append(f"Post {index}: {_post_author(post)}")
        lines.append(_post_text(post) or "(empty)")
        comment_list = comments_by_post.get(post_id) or []
        if comment_list:
            lines.append("Comments:")
            for comment in comment_list:
                if not isinstance(comment, Mapping):
                    continue
                lines.append(f"- {_comment_author(comment)}: {_comment_text(comment) or '(empty)'}")
        lines.append("")
    return "\n".join(lines).strip()


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
    *,
    destination_type: str = "gdrive",
) -> str:
    dataframe = pd.DataFrame(rows)
    return await gdrive_upload_tabular_bytes(
        token,
        filename,
        build_excel_bytes(dataframe),
        parent_id,
        destination_type=destination_type,
    )


async def _upload_excel_rows_or_note(
    token: GoogleDriveTokenProvider,
    parent_id: str,
    filename: str,
    rows: list[dict[str, Any]],
    empty_message: str,
    *,
    destination_type: str = "gdrive",
) -> str:
    return await _upload_excel_rows(
        token,
        parent_id,
        filename,
        rows if rows else _note_rows(empty_message),
        destination_type=destination_type,
    )


async def _upload_text_artifact(
    token: GoogleDriveTokenProvider,
    parent_id: str,
    filename: str,
    content: str,
) -> str:
    return await gdrive_upload_bytes(
        token,
        filename,
        content.encode("utf-8"),
        "text/plain",
        parent_id,
    )


async def _persist_catalog(
    *,
    gdrive_token: GoogleDriveTokenProvider,
    root_folder_id: str,
    workflows: list[dict[str, Any]],
    include_raw_payloads: bool,
    destination_type: str,
) -> tuple[str, int]:
    raw_payload_files = 0
    catalog_folder_id = await gdrive_create_folder(gdrive_token, "0. Danh mục chung", root_folder_id)
    await _upload_excel_rows(
        gdrive_token,
        catalog_folder_id,
        "Danh sách workflow.xlsx",
        [_flatten_workflow_row(workflow) for workflow in workflows],
        destination_type=destination_type,
    )
    return catalog_folder_id, raw_payload_files


async def _persist_job_artifacts(
    *,
    extractor: WorkflowBackupExtractor,
    gdrive_token: GoogleDriveTokenProvider,
    jobs_folder_id: str,
    job: Mapping[str, Any],
    include_custom_tables: bool,
    include_posts: bool,
    include_comments: bool,
    include_raw_payloads: bool,
    log_lines: list[str],
    destination_type: str,
) -> tuple[int, int, int, int]:
    job_id = _job_id(job)
    if not job_id:
        log_lines.append("    - skip job without id")
        return 0, 0, 0, 0

    bundle = await extractor.extract_job(
        job_id,
        include_custom_tables=include_custom_tables,
        include_posts=include_posts,
        include_comments=include_comments,
    )
    merged_job = dict(job)
    if isinstance(bundle.get("job"), Mapping):
        merged_job.update(bundle["job"])

    job_folder_id = await gdrive_create_folder(gdrive_token, _job_folder_name(merged_job), jobs_folder_id)
    info_folder_id = await gdrive_create_folder(gdrive_token, "1. Thông tin", job_folder_id)
    input_folder_id = await gdrive_create_folder(gdrive_token, "2. Dữ liệu nhập", job_folder_id)
    content_folder_id = await gdrive_create_folder(gdrive_token, "3. Nội dung", job_folder_id)
    files_folder_id = await gdrive_create_folder(gdrive_token, "4. Tệp đính kèm", job_folder_id)

    await _upload_excel_rows(
        gdrive_token,
        info_folder_id,
        "Thông tin job.xlsx",
        [_build_job_detail_row(merged_job)],
        destination_type=destination_type,
    )

    raw_payload_files = 0

    await _upload_excel_rows_or_note(
        gdrive_token,
        info_folder_id,
        "Thông tin job log.xlsx",
        _extract_job_log_rows(merged_job),
        "Workflow API không trả dữ liệu job log riêng cho job này.",
        destination_type=destination_type,
    )
    await _upload_excel_rows_or_note(
        gdrive_token,
        info_folder_id,
        "Thông tin job moves.xlsx",
        _extract_job_move_rows(merged_job),
        "Workflow API không trả dữ liệu move history riêng cho job này.",
        destination_type=destination_type,
    )

    custom_tables_exported = 0
    custom_fields_rows = _extract_job_custom_field_rows(merged_job)

    await _upload_excel_rows_or_note(
        gdrive_token,
        input_folder_id,
        "custom_fields.xlsx",
        custom_fields_rows,
        "Không có custom fields nào được Workflow API trả về cho job này.",
        destination_type=destination_type,
    )
    if custom_fields_rows:
        custom_tables_exported += 1

    for filename, rows, empty_message in _extract_job_form_table_exports(merged_job):
        await _upload_excel_rows_or_note(
            gdrive_token,
            input_folder_id,
            filename,
            rows,
            empty_message,
            destination_type=destination_type,
        )
        if rows:
            custom_tables_exported += 1

    posts = [dict(item) for item in bundle.get("posts", []) if isinstance(item, Mapping)]
    comments_payload = [dict(item) for item in bundle.get("comments", []) if isinstance(item, Mapping)]
    total_comments = sum(
        len(item.get("comments") or [])
        for item in comments_payload
        if isinstance(item.get("comments"), list)
    )

    discussion_text = _render_discussion_text(posts, comments_payload) if posts else ""
    if not discussion_text:
        discussion_text = (
            "Backup type hiện tại không xuất nội dung post/comment cho job này."
            if not include_posts
            else "Không có post hoặc comment nào được Workflow API trả về cho job này."
        )
    await _upload_text_artifact(gdrive_token, content_folder_id, "post_and_comment.txt", discussion_text)

    await _upload_text_artifact(
        gdrive_token,
        files_folder_id,
        "Thông tin files",
        _render_file_info_text(_extract_job_file_rows(merged_job)),
    )

    log_lines.append(
        f"    ✓ job {_job_code(merged_job)}: {custom_tables_exported} custom table export(s), {len(posts)} post(s), {total_comments} comment(s)"
    )
    return custom_tables_exported, raw_payload_files, len(posts), total_comments


async def run_workflow_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        await _execute_workflow_backup(flow_id, run_id, db)


async def _execute_workflow_backup(flow_id: str, run_id: str, db: AsyncSession) -> None:
    flow = (await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))).scalar_one_or_none()
    run = (await db.execute(select(BackupFlowRun).where(BackupFlowRun.id == run_id))).scalar_one_or_none()
    if not flow or not run:
        return

    run.status = "running"
    log_lines = [f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Workflow backup started"]
    total_workflows = 0
    completed_workflows = 0
    total_stages = 0
    total_jobs = 0
    completed_jobs = 0
    total_posts = 0
    total_comments = 0
    custom_tables_exported = 0
    raw_payload_files = 0
    root_folder_id = None
    workflow_root_folder_id = None
    catalog_folder_id = None
    workflows_folder_id = None
    current_step_label = "Initializing Workflow backup"

    async def persist_progress(
        phase: str,
        step_label: str,
        progress_percent: int,
        *,
        structure_path: str | None = None,
        current_workflow_id: str | None = None,
        current_workflow_name: str | None = None,
        current_job_id: str | None = None,
        current_job_name: str | None = None,
    ) -> None:
        nonlocal current_step_label
        current_step_label = step_label
        run.execution_details = {
            "app": "workflow",
            "phase": phase,
            "step_label": step_label,
            "progress_percent": progress_percent,
            "root_folder_id": root_folder_id,
            "base_folder_id": workflow_root_folder_id,
            "base_folder_name": "Base Workflow" if workflow_root_folder_id else None,
            "structure_path": structure_path,
            "total_workflows": total_workflows,
            "completed_workflows": completed_workflows,
            "total_stages": total_stages,
            "total_jobs": total_jobs,
            "completed_jobs": completed_jobs,
            "total_posts": total_posts,
            "total_comments": total_comments,
            "custom_tables_exported": custom_tables_exported,
            "raw_payload_files": raw_payload_files,
            "current_workflow_id": current_workflow_id,
            "current_workflow_name": current_workflow_name,
            "current_job_id": current_job_id,
            "current_job_name": current_job_name,
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
            raise ValueError("No encrypted Workflow access token found in flow source")

        from modules.credentials.backend.services.google_auth_service import (
            GoogleAuthService,
            decrypt_value,
            validate_service_account_drive_destination,
        )

        workflow_domain = normalize_workflow_domain(str(source.get("domain") or ""))
        workflow_access_token = decrypt_value(encrypted_access_token)
        credentials = WorkflowCredentials(domain=workflow_domain, access_token=workflow_access_token)

        destination = flow.destination or {}
        destination_type = str(destination.get("type") or "gdrive").strip().lower()
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
        workflow_root_folder_id, archived_root_folders = await gdrive_recreate_folder(
            get_gdrive_token,
            "Base Workflow",
            root_folder_id,
            drive_id=auth.get("drive_id"),
        )
        if archived_root_folders:
            log_lines.append(
                f"[INFO] Moved {archived_root_folders} existing Base Workflow folder(s) to trash before rebuilding backup tree"
            )
        await persist_progress(
            "preparing_destination",
            "Created Base Workflow root structure in Google Drive",
            15,
            structure_path="Base Workflow",
        )

        structure = flow.structure or {}
        selected_objects = {str(item) for item in (structure.get("objects") or []) if str(item).strip()}
        include_workflow_scope = bool(selected_objects.intersection({"workflow", "job"}))
        include_job_scope = "job" in selected_objects
        include_workflow_details = bool(structure.get("include_workflow_details", include_workflow_scope))
        include_stages = bool(structure.get("include_stages", include_workflow_scope))
        include_job_list = bool(structure.get("include_job_list", include_job_scope))
        include_job_details = bool(structure.get("include_job_details", include_job_scope))
        include_custom_tables = bool(structure.get("include_custom_tables", include_job_scope))
        include_posts = bool(structure.get("include_posts", include_job_scope and flow.backup_type == "all"))
        include_comments = bool(structure.get("include_comments", include_posts and flow.backup_type == "all"))
        include_raw_payloads = bool(structure.get("include_raw_payloads", True))
        job_filters = structure.get("job_filters") or {}
        requested_workflow_ids = [
            str(item).strip()
            for item in (structure.get("workflow_ids") or [])
            if str(item).strip()
        ]

        async with WorkflowManagementClient(credentials) as client:
            extractor = WorkflowBackupExtractor(client)
            log_lines.append(f"[INFO] Domain: {workflow_domain}")
            catalog = await extractor.extract_catalog()
            workflows = [item for item in catalog.get("workflows", []) if isinstance(item, Mapping)]
            workflows_folder_id = await gdrive_create_folder(get_gdrive_token, "Workflows", workflow_root_folder_id)
            catalog_folder_id, catalog_raw_files = await _persist_catalog(
                gdrive_token=get_gdrive_token,
                root_folder_id=workflow_root_folder_id,
                workflows=[dict(item) for item in workflows],
                include_raw_payloads=include_raw_payloads,
                destination_type=destination_type,
            )
            raw_payload_files += catalog_raw_files
            await persist_progress(
                "extracting_catalog",
                "Extracted Workflow catalog and base metadata",
                25,
                structure_path="Base Workflow / 0. Danh mục chung",
            )

            workflow_lookup = {
                str(_workflow_id(workflow)): dict(workflow)
                for workflow in workflows
                if _workflow_id(workflow)
            }
            workflow_ids = [workflow_id for workflow_id in requested_workflow_ids if workflow_id in workflow_lookup]
            if not workflow_ids:
                workflow_ids = list(workflow_lookup.keys())
            if not workflow_ids:
                raise ValueError("No workflows available for this token")

            total_workflows = len(workflow_ids)
            await persist_progress(
                "planning_scope",
                f"Prepared Workflow scope with {total_workflows} workflow(s)",
                30,
                structure_path="Base Workflow",
            )

            for workflow_id in workflow_ids:
                workflow_meta = workflow_lookup.get(workflow_id, {"id": workflow_id, "name": f"Workflow {workflow_id}"})
                workflow_name = _workflow_name(workflow_meta)
                workflow_structure_path = f"Base Workflow / Workflows / {_workflow_folder_name(workflow_meta)}"
                await persist_progress(
                    "processing_workflows",
                    f"Processing workflow {workflow_name}",
                    30 + int((completed_workflows / max(total_workflows, 1)) * 60),
                    structure_path=workflow_structure_path,
                    current_workflow_id=workflow_id,
                    current_workflow_name=workflow_name,
                )
                log_lines.append(f"[INFO] Workflow {workflow_id}: {workflow_name}")

                bundle = await extractor.extract_workflow_inventory(
                    workflow_id,
                    include_jobs=include_job_list or include_job_details,
                    job_filters=job_filters,
                )
                workflow_detail = dict(workflow_meta)
                if isinstance(bundle.get("workflow"), Mapping):
                    workflow_detail.update(bundle.get("workflow") or {})
                stages = [dict(item) for item in bundle.get("stages", []) if isinstance(item, Mapping)]
                jobs = [dict(item) for item in bundle.get("jobs", []) if isinstance(item, Mapping)]
                total_stages += len(stages)
                total_jobs += len(jobs)

                workflow_folder_id = await gdrive_create_folder(
                    get_gdrive_token,
                    _workflow_folder_name(workflow_detail),
                    workflows_folder_id,
                )
                guide_folder_id = await gdrive_create_folder(get_gdrive_token, "0. Hướng dẫn", workflow_folder_id)
                config_folder_id = await gdrive_create_folder(get_gdrive_token, "1. Cấu hình workflow", workflow_folder_id)
                await _upload_text_artifact(
                    get_gdrive_token,
                    guide_folder_id,
                    "README.txt",
                    _build_workflow_readme_text(
                        workflow_detail,
                        include_jobs=include_job_list or include_job_details,
                        include_posts=include_posts,
                    ),
                )

                if include_workflow_details:
                    await _upload_excel_rows(
                        get_gdrive_token,
                        config_folder_id,
                        "Thông tin workflow.xlsx",
                        [_flatten_workflow_row(workflow_detail)],
                        destination_type=destination_type,
                    )

                if include_stages:
                    await _upload_excel_rows(
                        get_gdrive_token,
                        config_folder_id,
                        "Danh sách stage.xlsx",
                        [_flatten_stage_row(stage) for stage in stages],
                        destination_type=destination_type,
                    )

                if include_job_list:
                    job_list_folder_id = await gdrive_create_folder(get_gdrive_token, "2. Danh sách công việc", workflow_folder_id)
                    await persist_progress(
                        "processing_workflow_jobs",
                        f"Extracted job list for workflow {workflow_name}",
                        30 + int((completed_workflows / max(total_workflows, 1)) * 60),
                        structure_path=f"{workflow_structure_path} / 2. Danh sách công việc",
                        current_workflow_id=workflow_id,
                        current_workflow_name=workflow_name,
                    )
                    await _upload_excel_rows_or_note(
                        get_gdrive_token,
                        job_list_folder_id,
                        "Danh sách job.xlsx",
                        [_flatten_job_row(job) for job in jobs],
                        "Không có job nào được Workflow API trả về cho workflow này.",
                        destination_type=destination_type,
                    )

                if include_job_details:
                    jobs_folder_id = await gdrive_create_folder(get_gdrive_token, "3. Jobs", workflow_folder_id)
                    for job in jobs:
                        await persist_progress(
                            "processing_jobs",
                            f"Processing job {_job_name(job)}",
                            30 + int((completed_workflows / max(total_workflows, 1)) * 60),
                            structure_path=f"{workflow_structure_path} / 3. Jobs / {_job_folder_name(job)}",
                            current_workflow_id=workflow_id,
                            current_workflow_name=workflow_name,
                            current_job_id=_job_id(job),
                            current_job_name=_job_name(job),
                        )
                        exported_tables, raw_files, post_count, comment_count = await _persist_job_artifacts(
                            extractor=extractor,
                            gdrive_token=get_gdrive_token,
                            jobs_folder_id=jobs_folder_id,
                            job=job,
                            include_custom_tables=include_custom_tables,
                            include_posts=include_posts,
                            include_comments=include_comments,
                            include_raw_payloads=include_raw_payloads,
                            log_lines=log_lines,
                            destination_type=destination_type,
                        )
                        custom_tables_exported += exported_tables
                        raw_payload_files += raw_files
                        total_posts += post_count
                        total_comments += comment_count
                        completed_jobs += 1
                elif include_job_list:
                    completed_jobs += len(jobs)

                completed_workflows += 1
                await persist_progress(
                    "processing_workflows",
                    f"Finished workflow {workflow_name}",
                    30 + int((completed_workflows / max(total_workflows, 1)) * 60),
                    structure_path=workflow_structure_path,
                    current_workflow_id=workflow_id,
                    current_workflow_name=workflow_name,
                )

            manifest = {
                "flow_id": str(flow.id),
                "run_id": str(run.id),
                "app": "workflow",
                "backup_type": flow.backup_type,
                "selected_objects": sorted(selected_objects),
                "workflow_ids": workflow_ids,
                "counts": {
                    "total_workflows": total_workflows,
                    "completed_workflows": completed_workflows,
                    "total_stages": total_stages,
                    "total_jobs": total_jobs,
                    "completed_jobs": completed_jobs,
                    "total_posts": total_posts,
                    "total_comments": total_comments,
                    "custom_tables_exported": custom_tables_exported,
                    "raw_payload_files": raw_payload_files,
                },
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
            if catalog_folder_id:
                await _upload_json_artifact(get_gdrive_token, catalog_folder_id, "backup_manifest.json", manifest)

        await persist_progress(
            "finalizing",
            "Finalizing Workflow backup artifacts",
            95,
            structure_path="Base Workflow",
        )
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        log_lines.append(
            f"[DONE] {total_workflows} workflow(s), {total_jobs} job(s), {total_posts} post(s), {total_comments} comment(s), {custom_tables_exported} custom table export(s)"
        )
        await persist_progress(
            "completed",
            f"Completed Workflow backup: {total_workflows} workflow(s), {total_jobs} job(s)",
            100,
            structure_path="Base Workflow",
        )
    except asyncio.CancelledError:
        run.status = "failed"
        run.completed_at = datetime.now(timezone.utc)
        run.error_message = run.error_message or MANUALLY_STOPPED_RUN_MESSAGE
        log_lines.append(f"[INTERRUPTED] {MANUALLY_STOPPED_RUN_MESSAGE}")
        await persist_progress(
            "failed",
            f"Workflow backup was manually stopped: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_workflow_id=(run.execution_details or {}).get("current_workflow_id"),
            current_workflow_name=(run.execution_details or {}).get("current_workflow_name"),
            current_job_id=(run.execution_details or {}).get("current_job_id"),
            current_job_name=(run.execution_details or {}).get("current_job_name"),
        )
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        log_lines.append(f"[ERROR] {exc}\n{traceback.format_exc()}")
        await persist_progress(
            "failed",
            f"Failed while running Workflow backup: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_workflow_id=(run.execution_details or {}).get("current_workflow_id"),
            current_workflow_name=(run.execution_details or {}).get("current_workflow_name"),
            current_job_id=(run.execution_details or {}).get("current_job_id"),
            current_job_name=(run.execution_details or {}).get("current_job_name"),
        )
    finally:
        run.logs = "\n".join(log_lines)
        flow_update = (await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))).scalar_one_or_none()
        if flow_update:
            flow_update.last_run_at = datetime.now(timezone.utc)
            flow_update.last_run_status = run.status
            flow_update.last_run_message = run.error_message or (
                f"{completed_workflows}/{total_workflows} workflow(s), {completed_jobs}/{max(total_jobs, completed_jobs)} job(s)"
            )
        await db.commit()