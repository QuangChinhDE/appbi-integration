from __future__ import annotations

import asyncio
import base64
import json
import traceback
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

import httpx
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.backup.backend.extractors._gdrive import (
    GoogleDriveTokenProvider,
    build_cached_gdrive_token_provider,
    gdrive_create_folder,
    gdrive_recreate_folder,
    gdrive_upload_tabular_bytes,
    gdrive_upload_bytes,
)
from modules.backup.backend.extractors._helpers import (
    build_excel_bytes,
    sanitize_name,
    truncate_name,
)
from modules.connectors.apps.service.common import (
    ServiceManagementClient,
    ServiceCredentials,
    normalize_service_domain,
)
from modules.connectors.apps.service.common.schemas import (
    ExtractServiceInventoryInput,
    ExtractSnapshotInput,
    ExtractTicketInput,
)
from packages.database.src.models import BackupFlow, BackupFlowRun
from packages.database.src.session import async_session


MANUALLY_STOPPED_RUN_MESSAGE = "Interrupted because the backup was manually stopped. Start the flow again to resume with a fresh run."


class ServiceBackupExtractor:
    def __init__(self, client: ServiceManagementClient):
        self.client = client

    async def extract_catalog(self) -> dict[str, Any]:
        return {
            "services": await self.client.get_all_services(selector="services"),
            "compounds": await self.client.get_all_compounds(selector="compound_blocks"),
            "groups": await self.client.get_all_groups(selector="groups"),
        }

    async def extract_service_inventory(self, service_id: str) -> dict[str, Any]:
        request = ExtractServiceInventoryInput(service_id=service_id)
        return {
            "service_id": request.service_id,
            "stages": await self.client.get_service_blocks(request.service_id, selector="stages"),
            "tickets": await self.client.get_all_tickets(request.service_id, selector="tickets"),
        }

    async def extract_ticket(
        self,
        ticket_id: str,
        *,
        username: str | None = None,
        include_possible_actions: bool = False,
        activity_log_filters: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = ExtractTicketInput.model_validate(
            {
                "ticket_id": ticket_id,
                "username": username,
                "include_possible_actions": include_possible_actions,
                "activity_log_filters": dict(activity_log_filters) if activity_log_filters else None,
            }
        )
        bundle = {
            "ticket": await self.client.get_ticket_details(request.ticket_id, selector="ticket"),
        }

        if request.activity_log_filters is not None:
            bundle["activity_logs"] = await self.client.get_ticket_activity_logs(
                request.activity_log_filters.cleaned_dump(),
                selector="activity_logs",
            )

        if request.include_possible_actions and request.username:
            bundle["possible_actions"] = await self.client.get_possible_transitions(
                request.ticket_id,
                request.username,
                selector="ticket_data.possible_actions",
            )

        return bundle

    async def extract_snapshot(
        self,
        service_ids: Iterable[str],
        *,
        include_ticket_details: bool = False,
    ) -> list[dict[str, Any]]:
        request = ExtractSnapshotInput(
            service_ids=service_ids,
            include_ticket_details=include_ticket_details,
        )
        snapshots: list[dict[str, Any]] = []

        for service_id in request.service_ids:
            inventory = await self.extract_service_inventory(service_id)
            if request.include_ticket_details:
                ticket_details = []
                for ticket in inventory.get("tickets", []):
                    ticket_id = _ticket_id(ticket)
                    if not ticket_id:
                        continue
                    ticket_details.append(await self.extract_ticket(ticket_id))
                inventory["ticket_details"] = ticket_details
            snapshots.append(inventory)

        return snapshots


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
        return value
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _safe_filename(name: str, fallback: str, suffix: str = "") -> str:
    cleaned = sanitize_name(name or "")
    if not cleaned:
        cleaned = fallback
    return f"{truncate_name(cleaned, 100)}{suffix}"


def _as_rows(value: Any) -> list[dict[str, Any]]:
    current = value
    if isinstance(current, str):
        try:
            current = json.loads(current)
        except Exception:
            return []

    if isinstance(current, Mapping):
        current = _first_non_empty(current.get("rows"), current.get("data"), current.get("items"), [current])

    if not isinstance(current, list):
        return []

    output: list[dict[str, Any]] = []
    for item in current:
        if isinstance(item, Mapping):
            output.append(dict(item))
        else:
            output.append({"value": item})
    return output


def _ticket_id(ticket: Mapping[str, Any]) -> str | None:
    value = _mapping_value(ticket, "root_id", "id", "ticket_id")
    return str(value) if value not in (None, "") else None


def _ticket_code(ticket: Mapping[str, Any]) -> str:
    value = _mapping_value(ticket, "root_code", "code", "ticket_code", "id", "root_id")
    return str(value) if value not in (None, "") else "ticket"


def _ticket_name(ticket: Mapping[str, Any]) -> str:
    value = _mapping_value(ticket, "name", "title", "subject")
    return str(value) if value not in (None, "") else _ticket_code(ticket)


def _service_id(service: Mapping[str, Any]) -> str | None:
    value = _mapping_value(service, "id", "service_id")
    return str(value) if value not in (None, "") else None


def _service_name(service: Mapping[str, Any]) -> str:
    value = _mapping_value(service, "name", "service_name")
    return str(value) if value not in (None, "") else "Service"


def _service_folder_name(service: Mapping[str, Any]) -> str:
    service_id = _service_id(service) or "unknown"
    return _safe_filename(f"[{service_id}] {_service_name(service)}", f"service_{service_id}")


def _ticket_folder_name(ticket: Mapping[str, Any]) -> str:
    code = _ticket_code(ticket)
    return _safe_filename(f"[{code}] {_ticket_name(ticket)}", code)


def _extract_form_items(ticket: Mapping[str, Any]) -> list[dict[str, Any]]:
    root_export = ticket.get("root_export") if isinstance(ticket.get("root_export"), Mapping) else {}
    form = _first_non_empty(ticket.get("form"), root_export.get("form"), [])
    if not isinstance(form, list):
        return []
    return [dict(item) for item in form if isinstance(item, Mapping)]


def _normalize_attachment_entries(value: Any) -> list[dict[str, Any]]:
    current = value
    if current is None:
        return []

    if isinstance(current, str):
        try:
            current = json.loads(current)
        except Exception:
            return []

    if isinstance(current, Mapping):
        nested = _first_non_empty(
            current.get("files"),
            current.get("value"),
            current.get("items"),
            current.get("data"),
        )
        if nested is not None and nested is not current:
            return _normalize_attachment_entries(nested)
        return [dict(current)]

    if not isinstance(current, list):
        return []

    output: list[dict[str, Any]] = []
    for item in current:
        if isinstance(item, Mapping):
            output.append(dict(item))
        elif isinstance(item, str):
            output.extend(_normalize_attachment_entries(item))
    return output


def _attachment_signature(file_info: Mapping[str, Any]) -> str:
    nested = file_info.get("file") if isinstance(file_info.get("file"), Mapping) else None
    signature = _first_non_empty(
        _mapping_value(file_info, "id", "file_id", "download_url", "downloadUrl", "url", "link", "href", "path"),
        _mapping_value(nested, "id", "file_id", "download_url", "downloadUrl", "url", "link", "href", "path"),
        _mapping_value(file_info, "name", "filename", "file_name", "title"),
    )
    return str(signature or json.dumps(dict(file_info), ensure_ascii=False, sort_keys=True, default=str))


def _collect_ticket_attachments(ticket: Mapping[str, Any]) -> list[dict[str, Any]]:
    attachment_candidates: list[dict[str, Any]] = []

    if isinstance(ticket.get("files"), list):
        attachment_candidates.extend(
            dict(file_info)
            for file_info in ticket.get("files", [])
            if isinstance(file_info, Mapping)
        )

    for item in _extract_form_items(ticket):
        if str(item.get("type") or "") != "filebox":
            continue
        attachment_candidates.extend(
            _normalize_attachment_entries(
                _first_non_empty(item.get("value"), item.get("files"), item.get("data"))
            )
        )

    deduped: list[dict[str, Any]] = []
    seen_signatures: set[str] = set()
    for attachment in attachment_candidates:
        signature = _attachment_signature(attachment)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        deduped.append(attachment)
    return deduped


def _flatten_ticket_row(ticket: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "ticket_id": _ticket_id(ticket),
        "ticket_code": _ticket_code(ticket),
        "ticket_name": _ticket_name(ticket),
        "service_id": _mapping_value(ticket, "service_id"),
        "group_id": _mapping_value(ticket, "group_id"),
        "block_id": _mapping_value(ticket, "block_id", "current_ticket_block_id"),
        "root_name": _mapping_value(ticket, "root_name"),
        "created_at": _mapping_value(ticket, "created_at", "created_time", "time_created"),
        "updated_at": _mapping_value(ticket, "updated_at", "last_update", "time_updated"),
        "assignees": _json_text(_mapping_value(ticket, "assignees")),
        "followers": _json_text(_mapping_value(ticket, "followers")),
        "files_count": len(_collect_ticket_attachments(ticket)),
        "custom_field_count": len(_extract_form_items(ticket)),
    }


def _flatten_service_row(service: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "service_id": _service_id(service),
        "service_name": _service_name(service),
        "compound_id": _mapping_value(service, "compound_id"),
        "group_id": _mapping_value(service, "group_id"),
        "description": _mapping_value(service, "description", "content"),
        "raw": _json_text(service),
    }


def _flatten_stage_row(stage: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "stage_id": _mapping_value(stage, "id", "block_id"),
        "stage_name": _mapping_value(stage, "name", "block_name"),
        "type": _mapping_value(stage, "type"),
        "raw": _json_text(stage),
    }


def _extract_attachment_url(file_info: Mapping[str, Any], domain: str) -> str | None:
    direct = _mapping_value(
        file_info,
        "download_url",
        "downloadUrl",
        "url",
        "link",
        "href",
        "file_url",
        "path",
    )
    nested = file_info.get("file") if isinstance(file_info.get("file"), Mapping) else None
    nested_direct = _mapping_value(nested, "download_url", "downloadUrl", "url", "link", "href")
    url = _first_non_empty(direct, nested_direct)
    if not url or not isinstance(url, str):
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/"):
        return f"https://service.{domain}{url}"
    return f"https://service.{domain}/{url.lstrip('/')}"


async def _download_attachment_bytes(
    file_info: Mapping[str, Any],
    *,
    domain: str,
    access_token: str,
) -> bytes | None:
    for key in ("content_base64", "base64", "data_base64"):
        encoded = file_info.get(key)
        if isinstance(encoded, str) and encoded.strip():
            try:
                return base64.b64decode(encoded)
            except Exception:
                pass

    url = _extract_attachment_url(file_info, domain)
    if not url:
        return None

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        for headers in ({}, {"Authorization": f"Bearer {access_token}"}):
            try:
                response = await client.get(url, headers=headers)
                if response.status_code == 200 and response.content:
                    return response.content
            except Exception:
                continue
    return None


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


async def _persist_catalog(
    *,
    gdrive_token: GoogleDriveTokenProvider,
    root_folder_id: str,
    catalog: Mapping[str, Any],
    destination_type: str,
) -> None:
    catalog_folder_id = await gdrive_create_folder(gdrive_token, "01. Danh mục", root_folder_id)
    await _upload_excel_rows(
        gdrive_token,
        catalog_folder_id,
        "Danh sách service.xlsx",
        [_flatten_service_row(service) for service in catalog.get("services", []) if isinstance(service, Mapping)],
        destination_type=destination_type,
    )
    await _upload_excel_rows(
        gdrive_token,
        catalog_folder_id,
        "Danh sách compound.xlsx",
        [dict(item) for item in catalog.get("compounds", []) if isinstance(item, Mapping)],
        destination_type=destination_type,
    )
    await _upload_excel_rows(
        gdrive_token,
        catalog_folder_id,
        "Danh sách group.xlsx",
        [dict(item) for item in catalog.get("groups", []) if isinstance(item, Mapping)],
        destination_type=destination_type,
    )


async def _persist_ticket_artifacts(
    *,
    extractor: ServiceBackupExtractor,
    gdrive_token: GoogleDriveTokenProvider,
    service_domain: str,
    service_access_token: str,
    service_folder_id: str,
    ticket: Mapping[str, Any],
    include_ticket_details: bool,
    include_activity_logs: bool,
    activity_log_filters: Mapping[str, Any] | None,
    log_lines: list[str],
    destination_type: str,
) -> tuple[int, int]:
    ticket_id = _ticket_id(ticket)
    if not ticket_id:
        log_lines.append("    - skip ticket without root_id/id")
        return 0, 0

    ticket_folder_id = await gdrive_create_folder(gdrive_token, _ticket_folder_name(ticket), service_folder_id)
    detail_bundle: dict[str, Any] = {}
    if include_ticket_details or include_activity_logs:
        try:
            detail_bundle = await extractor.extract_ticket(
                ticket_id,
                activity_log_filters=activity_log_filters if include_activity_logs else None,
            )
        except Exception as exc:
            log_lines.append(f"    - ticket {ticket_id}: detail enrich failed: {exc}")

    detail_ticket = detail_bundle.get("ticket") if isinstance(detail_bundle.get("ticket"), Mapping) else {}
    merged_ticket = dict(ticket)
    merged_ticket.update(detail_ticket)

    await _upload_excel_rows(
        gdrive_token,
        ticket_folder_id,
        "Thông tin ticket.xlsx",
        [_flatten_ticket_row(merged_ticket)],
        destination_type=destination_type,
    )
    await _upload_json_artifact(gdrive_token, ticket_folder_id, "ticket.json", merged_ticket)

    form_rows: list[dict[str, Any]] = []
    for item in _extract_form_items(ticket):
        item_type = str(item.get("type") or "")
        item_name = str(item.get("name") or item.get("label") or "Custom field")
        if item_type in {"input-table", "select-master"}:
            rows = _as_rows(item.get("value"))
            if rows:
                await _upload_excel_rows(
                    gdrive_token,
                    ticket_folder_id,
                    _safe_filename(item_name, "custom_table", ".xlsx"),
                    rows,
                    destination_type=destination_type,
                )
        elif item_type == "filebox":
            continue
        else:
            form_rows.append(
                {
                    "field_id": item.get("id"),
                    "field_name": item_name,
                    "field_type": item_type,
                    "value": _json_text(item.get("value")),
                }
            )

    if form_rows:
        await _upload_excel_rows(
            gdrive_token,
            ticket_folder_id,
            "Thông tin trường tùy chỉnh.xlsx",
            form_rows,
            destination_type=destination_type,
        )

    activity_logs = detail_bundle.get("activity_logs") if isinstance(detail_bundle.get("activity_logs"), list) else []
    if include_activity_logs and activity_logs:
        await _upload_excel_rows(
            gdrive_token,
            ticket_folder_id,
            "Nhật ký hoạt động.xlsx",
            [dict(item) for item in activity_logs if isinstance(item, Mapping)],
            destination_type=destination_type,
        )

    attachment_downloaded = 0
    attachment_metadata_only = 0
    files = _collect_ticket_attachments(merged_ticket)
    if files:
        attachments_folder_id = await gdrive_create_folder(gdrive_token, "Tệp đính kèm", ticket_folder_id)
        for index, file_info in enumerate(files, start=1):
            if not isinstance(file_info, Mapping):
                continue
            filename = _safe_filename(
                str(_mapping_value(file_info, "name", "filename", "file_name", "title") or f"attachment_{index}"),
                f"attachment_{index}",
            )
            content = await _download_attachment_bytes(
                file_info,
                domain=service_domain,
                access_token=service_access_token,
            )
            if content:
                mime_type = str(_mapping_value(file_info, "mime_type", "content_type") or "application/octet-stream")
                await gdrive_upload_bytes(gdrive_token, filename, content, mime_type, attachments_folder_id)
                attachment_downloaded += 1
                continue

            await _upload_json_artifact(
                gdrive_token,
                attachments_folder_id,
                _safe_filename(filename, f"attachment_{index}", ".metadata.json"),
                dict(file_info),
            )
            attachment_metadata_only += 1

    log_lines.append(
        f"    ✓ ticket {_ticket_code(ticket)}: {attachment_downloaded} attachment(s) downloaded, {attachment_metadata_only} metadata fallback"
    )
    return attachment_downloaded, attachment_metadata_only


async def run_service_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        await _execute_service_backup(flow_id, run_id, db)


async def _execute_service_backup(flow_id: str, run_id: str, db: AsyncSession) -> None:
    flow = (await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))).scalar_one_or_none()
    run = (await db.execute(select(BackupFlowRun).where(BackupFlowRun.id == run_id))).scalar_one_or_none()
    if not flow or not run:
        return

    run.status = "running"
    log_lines = [f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Service backup started"]
    total_services = 0
    completed_services = 0
    total_tickets = 0
    attachments_downloaded = 0
    attachments_metadata_only = 0
    root_folder_id = None
    service_root_folder_id = None
    current_step_label = "Initializing Service backup"

    async def persist_progress(
        phase: str,
        step_label: str,
        progress_percent: int,
        *,
        structure_path: str | None = None,
        current_service_id: str | None = None,
        current_service_name: str | None = None,
        current_ticket_code: str | None = None,
    ) -> None:
        nonlocal current_step_label
        current_step_label = step_label
        run.execution_details = {
            "app": "service",
            "phase": phase,
            "step_label": step_label,
            "progress_percent": progress_percent,
            "root_folder_id": root_folder_id,
            "base_folder_id": service_root_folder_id,
            "base_folder_name": "Base Service" if service_root_folder_id else None,
            "structure_path": structure_path,
            "total_services": total_services,
            "completed_services": completed_services,
            "total_tickets": total_tickets,
            "attachments_downloaded": attachments_downloaded,
            "attachments_metadata_only": attachments_metadata_only,
            "current_service_id": current_service_id,
            "current_service_name": current_service_name,
            "current_ticket_code": current_ticket_code,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        run.logs = "\n".join(log_lines)
        flow.last_run_at = datetime.now(timezone.utc)
        flow.last_run_status = run.status
        flow.last_run_message = run.error_message or step_label
        await db.commit()

    await persist_progress("starting", current_step_label, 5)

    try:
        from modules.apps.backend.services.app_credential_service import AppCredentialService
        credential_service = AppCredentialService(db)
        source = await credential_service.build_source_runtime(flow.source_credential_id)
        encrypted_access_token = source.get("access_token_encrypted")
        if not encrypted_access_token:
            raise ValueError("No encrypted Service access token found in flow source")

        from modules.credentials.backend.services.google_auth_service import (
            GoogleAuthService,
            decrypt_value,
            validate_service_account_drive_destination,
        )

        service_domain = normalize_service_domain(str(source.get("domain") or ""))
        service_access_token = decrypt_value(encrypted_access_token)
        credentials = ServiceCredentials(domain=service_domain, access_token=service_access_token)

        destination = await credential_service.build_destination_runtime(
            flow.destination_credential_id,
            dict(flow.destination_target or {}) or None,
        )
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
        service_root_folder_id, archived_root_folders = await gdrive_recreate_folder(
            get_gdrive_token,
            "Base Service",
            root_folder_id,
            drive_id=auth.get("drive_id"),
        )
        if archived_root_folders:
            log_lines.append(
                f"[INFO] Moved {archived_root_folders} existing Base Service folder(s) to trash before rebuilding backup tree"
            )
        await persist_progress(
            "preparing_destination",
            "Created Base Service root structure in Google Drive",
            15,
            structure_path="Base Service",
        )

        structure = flow.structure or {}
        include_catalog = bool(structure.get("include_catalog", True))
        include_stages = bool(structure.get("include_stages", True))
        include_ticket_details = bool(structure.get("include_ticket_details", flow.backup_type == "all"))
        include_activity_logs = bool(structure.get("include_activity_logs", False))
        activity_log_filters = structure.get("activity_log_filters") or None

        if include_activity_logs:
            log_lines.append(
                "[WARN] ticket/get.activity.logs is currently global and not ticket-scoped; activity log export was skipped."
            )
            include_activity_logs = False

        async with ServiceManagementClient(credentials) as client:
            extractor = ServiceBackupExtractor(client)
            log_lines.append(f"[INFO] Domain: service.{service_domain}")
            catalog = await extractor.extract_catalog()
            await persist_progress(
                "extracting_catalog",
                "Extracted Service catalog and base metadata",
                30,
                structure_path="Base Service",
            )

            if include_catalog:
                await _persist_catalog(
                    gdrive_token=get_gdrive_token,
                    root_folder_id=service_root_folder_id,
                    catalog=catalog,
                    destination_type=destination_type,
                )
                log_lines.append("[INFO] Catalog artifacts uploaded")

            catalog_services = [service for service in catalog.get("services", []) if isinstance(service, Mapping)]
            service_lookup = {
                str(_service_id(service)): dict(service)
                for service in catalog_services
                if _service_id(service)
            }

            requested_service_ids = structure.get("service_ids") or []
            service_ids = [str(service_id) for service_id in requested_service_ids if str(service_id).strip()]
            if not service_ids:
                service_ids = list(service_lookup.keys())
            if not service_ids:
                raise ValueError("No services available for this token")
            total_services = len(service_ids)
            await persist_progress(
                "planning_scope",
                f"Prepared Service scope with {total_services} service(s)",
                35,
                structure_path="Base Service",
            )

            for service_id in service_ids:
                service_meta = service_lookup.get(service_id, {"id": service_id, "name": f"Service {service_id}"})
                service_name = _service_name(service_meta)
                current_structure_path = f"Base Service / {_service_folder_name(service_meta)}"
                await persist_progress(
                    "processing_services",
                    f"Processing service {service_name}",
                    35 + int((completed_services / max(total_services, 1)) * 50),
                    structure_path=current_structure_path,
                    current_service_id=service_id,
                    current_service_name=service_name,
                )
                log_lines.append(f"[INFO] Service {service_id}: {_service_name(service_meta)}")
                inventory = await extractor.extract_service_inventory(service_id)
                service_folder_id = await gdrive_create_folder(
                    get_gdrive_token,
                    _service_folder_name(service_meta),
                    service_root_folder_id,
                )

                await _upload_excel_rows(
                    get_gdrive_token,
                    service_folder_id,
                    "Thông tin service.xlsx",
                    [_flatten_service_row(service_meta)],
                    destination_type=destination_type,
                )

                tickets = [ticket for ticket in inventory.get("tickets", []) if isinstance(ticket, Mapping)]
                total_tickets += len(tickets)
                await _upload_excel_rows(
                    get_gdrive_token,
                    service_folder_id,
                    "Danh sách ticket.xlsx",
                    [_flatten_ticket_row(ticket) for ticket in tickets],
                    destination_type=destination_type,
                )

                if include_stages:
                    await _upload_excel_rows(
                        get_gdrive_token,
                        service_folder_id,
                        "Danh sách stage.xlsx",
                        [_flatten_stage_row(stage) for stage in inventory.get("stages", []) if isinstance(stage, Mapping)],
                        destination_type=destination_type,
                    )

                if flow.backup_type in {"unstructured", "all"}:
                    tickets_folder_id = await gdrive_create_folder(get_gdrive_token, "Tickets", service_folder_id)
                    await persist_progress(
                        "processing_service_tickets",
                        f"Creating ticket artifacts for service {service_name}",
                        35 + int((completed_services / max(total_services, 1)) * 50),
                        structure_path=f"{current_structure_path} / Tickets",
                        current_service_id=service_id,
                        current_service_name=service_name,
                        current_ticket_code=_ticket_code(tickets[0]) if tickets else None,
                    )
                    for ticket in tickets:
                        downloaded, metadata_only = await _persist_ticket_artifacts(
                            extractor=extractor,
                            gdrive_token=get_gdrive_token,
                            service_domain=service_domain,
                            service_access_token=service_access_token,
                            service_folder_id=tickets_folder_id,
                            ticket=ticket,
                            include_ticket_details=include_ticket_details,
                            include_activity_logs=include_activity_logs,
                            activity_log_filters=activity_log_filters,
                            log_lines=log_lines,
                            destination_type=destination_type,
                        )
                        attachments_downloaded += downloaded
                        attachments_metadata_only += metadata_only

                completed_services += 1
                await persist_progress(
                    "processing_services",
                    f"Finished service {service_name}",
                    35 + int((completed_services / max(total_services, 1)) * 50),
                    structure_path=current_structure_path,
                    current_service_id=service_id,
                    current_service_name=service_name,
                )

        await persist_progress(
            "finalizing",
            "Finalizing Service backup artifacts",
            95,
            structure_path="Base Service",
        )
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        log_lines.append(
            f"[DONE] {total_services} service(s), {total_tickets} ticket(s), {attachments_downloaded} downloaded attachment(s), {attachments_metadata_only} metadata fallback"
        )
        await persist_progress(
            "completed",
            f"Completed Service backup: {total_services} service(s), {total_tickets} ticket(s)",
            100,
            structure_path="Base Service",
        )
    except asyncio.CancelledError:
        run.status = "failed"
        run.completed_at = datetime.now(timezone.utc)
        run.error_message = run.error_message or MANUALLY_STOPPED_RUN_MESSAGE
        log_lines.append(f"[INTERRUPTED] {MANUALLY_STOPPED_RUN_MESSAGE}")
        await persist_progress(
            "failed",
            f"Service backup was manually stopped: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_service_id=(run.execution_details or {}).get("current_service_id"),
            current_service_name=(run.execution_details or {}).get("current_service_name"),
            current_ticket_code=(run.execution_details or {}).get("current_ticket_code"),
        )
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        log_lines.append(f"[ERROR] {exc}\n{traceback.format_exc()}")
        await persist_progress(
            "failed",
            f"Failed while running Service backup: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_service_id=(run.execution_details or {}).get("current_service_id"),
            current_service_name=(run.execution_details or {}).get("current_service_name"),
            current_ticket_code=(run.execution_details or {}).get("current_ticket_code"),
        )
    finally:
        run.logs = "\n".join(log_lines)
        flow_update = (await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))).scalar_one_or_none()
        if flow_update:
            flow_update.last_run_at = datetime.now(timezone.utc)
            flow_update.last_run_status = run.status
            flow_update.last_run_message = run.error_message or (
                f"{total_services} service(s), {total_tickets} ticket(s), {attachments_downloaded} attachment(s) downloaded"
            )
        await db.commit()