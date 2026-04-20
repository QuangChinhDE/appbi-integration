"""
Service-specific backup extractor.

Produces the hierarchical folder structure:

    Base Service/
    ├── Services/
    │   └── [ID] Service Name/
    │       ├── 1. Thông tin/
    │       │   ├── Thông tin service.xlsx
    │       │   ├── Danh sách ticket.xlsx
    │       │   └── Danh sách stage.xlsx
    │       └── 2. Tickets/                      (only when backup_type ∈ {unstructured, all})
    │           └── [ID] Ticket Name/
    │               ├── 1. Thông tin/
    │               │   ├── Thông tin ticket.xlsx
    │               │   └── ticket.json
    │               ├── 2. Tùy chỉnh/
    │               │   └── Thông tin trường tùy chỉnh.xlsx
    │               └── 3. Tệp đính kèm/
    │                   └── Thông tin files.xlsx
    └── 0. Danh mục chung/
        ├── Danh sách service.xlsx
        ├── Danh sách compound.xlsx
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
from modules.connectors.apps.service.common.auth import ServiceCredentials
from modules.connectors.apps.service.common.client import ServiceManagementClient
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

_ID_FIELDS = ('service_id', 'id')
_NAME_FIELDS = ('name', 'title', 'display_name', 'label')
_TICKET_ID_FIELDS = ('ticket_id', 'id', 'hid')
_TICKET_CODE_FIELDS = ('code', 'ticket_code', 'hid')


def _pick(record: dict, candidates: tuple[str, ...]) -> str:
    for key in candidates:
        val = record.get(key)
        if val not in (None, ''):
            return str(val).strip()
    return ''


def _ensure_list(val: Any) -> list[dict]:
    if isinstance(val, list):
        return [item for item in val if isinstance(item, dict)]
    if isinstance(val, dict):
        for key in ('data', 'items', 'list', 'services', 'tickets', 'compounds', 'groups', 'stages', 'blocks'):
            inner = val.get(key)
            if isinstance(inner, list):
                return [item for item in inner if isinstance(item, dict)]
        return [val]
    return []


def _ensure_dict(val: Any) -> dict:
    if isinstance(val, dict):
        for key in ('data', 'ticket', 'service', 'item'):
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


# ── Main runner ──────────────────────────────────────────────────────────────


async def run_service_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        flow = await db.get(BackupFlow, flow_id)
        run = await db.get(BackupFlowRun, run_id)
        if flow is None or run is None:
            return

        client: ServiceManagementClient | None = None
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
            run.logs = '[RUNNING] Starting Service backup'
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

            # Build Service API client
            domain = source_binding.auth.get('domain') or source_binding.config.get('domain') or ''
            access_token = source_binding.auth.get('access_token') or source_binding.config.get('access_token') or ''
            credentials = ServiceCredentials(domain=domain, access_token=access_token)
            client = ServiceManagementClient(credentials)

            structure = dict(flow.structure or {})
            service_ids = structure.get('service_ids') or []
            backup_type = flow.backup_type or 'all'
            include_catalog = structure.get('include_catalog', True)
            include_stages = structure.get('include_stages', True)
            include_ticket_details = backup_type in ('all', 'unstructured')

            uploaded_files: list[dict[str, Any]] = []
            manifest_entries: list[dict[str, Any]] = []

            # ── Trash old folder and create fresh ────────────────────
            await _update_log(db, run, 'Preparing destination folder...')
            app_folder_name = sanitize_name('Base Service')
            app_folder_id, archived_count = await gdrive_recreate_folder(
                get_token, app_folder_name, root_folder_id, drive_id=drive_id,
            )
            if archived_count:
                await _update_log(db, run, f'Archived {archived_count} old "{app_folder_name}" folder(s)')

            # ── Fetch all services ───────────────────────────────────
            await _update_log(db, run, 'Fetching all services...')
            try:
                all_services_raw = await client.get_all_services("data")
                all_services = _ensure_list(all_services_raw)
            except Exception:
                all_services_raw = await client.get_all_services()
                all_services = _ensure_list(all_services_raw)
            await _update_log(db, run, f'Found {len(all_services)} service(s)')

            if service_ids:
                svc_id_set = set(str(sid) for sid in service_ids)
                selected_services = [
                    s for s in all_services
                    if _pick(s, _ID_FIELDS) in svc_id_set
                ]
            else:
                selected_services = all_services

            await _update_log(db, run, f'Will backup {len(selected_services)} selected service(s)')

            # ── 0. Danh mục chung ─────────────────────────────────────
            await _update_log(db, run, 'Creating "0. Danh mục chung"...')
            common_folder_id = await gdrive_create_folder(
                get_token, '0. Danh mục chung', app_folder_id, drive_id=drive_id,
            )

            # Danh sách service
            fid, cnt = await _upload_excel(
                get_token, common_folder_id, 'Danh sách service.xlsx',
                all_services, dest_type,
            )
            uploaded_files.append({'path': '0. Danh mục chung/Danh sách service.xlsx', 'file_id': fid, 'record_count': cnt})

            # Danh sách compound
            try:
                compounds_raw = await client.get_all_compounds("data")
                compounds = _ensure_list(compounds_raw)
            except Exception:
                compounds = []
            fid, cnt = await _upload_excel(
                get_token, common_folder_id, 'Danh sách compound.xlsx',
                compounds, dest_type,
            )
            uploaded_files.append({'path': '0. Danh mục chung/Danh sách compound.xlsx', 'file_id': fid, 'record_count': cnt})

            # Danh sách group
            try:
                groups_raw = await client.get_all_groups("data")
                groups = _ensure_list(groups_raw)
            except Exception:
                groups = []
            fid, cnt = await _upload_excel(
                get_token, common_folder_id, 'Danh sách group.xlsx',
                groups, dest_type,
            )
            uploaded_files.append({'path': '0. Danh mục chung/Danh sách group.xlsx', 'file_id': fid, 'record_count': cnt})

            # ── Per-service folders ──────────────────────────────────
            services_parent_id = await gdrive_create_folder(
                get_token, 'Services', app_folder_id, drive_id=drive_id,
            )
            total = len(selected_services)
            for svc_index, service in enumerate(selected_services, 1):
                svc_id = _pick(service, _ID_FIELDS)
                svc_name = _pick(service, _NAME_FIELDS)
                svc_label = sanitize_name(f'[{svc_id}] {truncate_name(svc_name)}')
                await _update_log(db, run, f'[{svc_index}/{total}] Processing service "{svc_name}" ...')

                svc_folder_id = await gdrive_create_folder(
                    get_token, svc_label, services_parent_id, drive_id=drive_id,
                )

                manifest_svc: dict[str, Any] = {
                    'service_id': svc_id,
                    'service_name': svc_name,
                    'folder': svc_label,
                    'tickets': [],
                }

                # ── 1. Thông tin/ ────────────────────────────────────
                info_folder_id = await gdrive_create_folder(
                    get_token, '1. Thông tin', svc_folder_id, drive_id=drive_id,
                )

                # Thông tin service.xlsx
                fid, cnt = await _upload_excel(
                    get_token, info_folder_id, 'Thông tin service.xlsx',
                    [service], dest_type,
                )
                uploaded_files.append({
                    'path': f'Services/{svc_label}/1. Thông tin/Thông tin service.xlsx', 'file_id': fid,
                })

                # Danh sách ticket.xlsx
                await _update_log(db, run, f'  Fetching tickets for service "{svc_name}"...')
                try:
                    tickets_raw = await client.get_all_tickets(svc_id, "data")
                    tickets = _ensure_list(tickets_raw)
                except Exception:
                    try:
                        tickets_raw = await client.get_all_tickets(svc_id)
                        tickets = _ensure_list(tickets_raw)
                    except Exception as exc:
                        logger.warning('Failed to load tickets for service %s: %s', svc_id, exc)
                        tickets = []
                await _update_log(db, run, f'  Found {len(tickets)} ticket(s)')

                fid, cnt = await _upload_excel(
                    get_token, info_folder_id, 'Danh sách ticket.xlsx',
                    tickets, dest_type,
                )
                uploaded_files.append({
                    'path': f'Services/{svc_label}/1. Thông tin/Danh sách ticket.xlsx', 'file_id': fid, 'record_count': cnt,
                })

                # Danh sách stage.xlsx
                if include_stages:
                    try:
                        stages_raw = await client.get_service_blocks(svc_id, "data")
                        stages = _ensure_list(stages_raw)
                    except Exception:
                        try:
                            stages_raw = await client.get_service_blocks(svc_id)
                            stages = _ensure_list(stages_raw)
                        except Exception as exc:
                            logger.warning('Failed to load stages for service %s: %s', svc_id, exc)
                            stages = []
                    fid, cnt = await _upload_excel(
                        get_token, info_folder_id, 'Danh sách stage.xlsx',
                        stages, dest_type,
                    )
                    uploaded_files.append({
                        'path': f'Services/{svc_label}/1. Thông tin/Danh sách stage.xlsx', 'file_id': fid, 'record_count': cnt,
                    })

                # ── 2. Tickets/ (per-ticket detail folders) ──────────
                if include_ticket_details and tickets:
                    tickets_parent_id = await gdrive_create_folder(
                        get_token, '2. Tickets', svc_folder_id, drive_id=drive_id,
                    )
                    ticket_total = len(tickets)
                    for t_index, ticket in enumerate(tickets, 1):
                        t_id = _pick(ticket, _TICKET_ID_FIELDS)
t_name = _pick(ticket, _NAME_FIELDS)
        t_label = sanitize_name(f'[{t_id}] {truncate_name(t_name)}')

                        if t_index % 20 == 1 or t_index == ticket_total:
                            await _update_log(db, run, f'  [{t_index}/{ticket_total}] Processing ticket "{t_name}"...')

                        t_folder_id = await gdrive_create_folder(
                            get_token, t_label, tickets_parent_id, drive_id=drive_id,
                        )

                        # ── 1. Thông tin/ (ticket) ────────────────
                        t_info_folder_id = await gdrive_create_folder(
                            get_token, '1. Thông tin', t_folder_id, drive_id=drive_id,
                        )

                        # Fetch ticket detail
                        try:
                            detail_raw = await client.get_ticket_details(t_id, "data")
                            detail = _ensure_dict(detail_raw) if not isinstance(detail_raw, dict) else detail_raw
                        except Exception:
                            try:
                                detail_raw = await client.get_ticket_details(t_id)
                                detail = _ensure_dict(detail_raw)
                            except Exception as exc:
                                logger.warning('Failed to load ticket detail for %s: %s', t_id, exc)
                                detail = ticket

                        # Thông tin ticket.xlsx
                        fid, _ = await _upload_excel(
                            get_token, t_info_folder_id, 'Thông tin ticket.xlsx',
                            [detail], dest_type,
                        )
                        uploaded_files.append({
                            'path': f'Services/{svc_label}/2. Tickets/{t_label}/1. Thông tin/Thông tin ticket.xlsx', 'file_id': fid,
                        })

                        # ticket.json
                        ticket_json = json.dumps(detail, ensure_ascii=False, indent=2, default=str)
                        fid = await _upload_text(get_token, t_info_folder_id, 'ticket.json', ticket_json)
                        uploaded_files.append({
                            'path': f'Services/{svc_label}/2. Tickets/{t_label}/1. Thông tin/ticket.json', 'file_id': fid,
                        })

                        # ── 2. Tùy chỉnh/ (ticket) ──────────────────
                        t_custom_folder_id = await gdrive_create_folder(
                            get_token, '2. Tùy chỉnh', t_folder_id, drive_id=drive_id,
                        )
                        cf_records = _flatten_custom_fields(detail)
                        if cf_records:
                            fid, _ = await _upload_excel(
                                get_token, t_custom_folder_id, 'Thông tin trường tùy chỉnh.xlsx',
                                cf_records, dest_type,
                            )
                            uploaded_files.append({
                                'path': f'Services/{svc_label}/2. Tickets/{t_label}/2. Tùy chỉnh/Thông tin trường tùy chỉnh.xlsx', 'file_id': fid,
                            })

                        # ── 3. Tệp đính kèm/ (ticket) ───────────────
                        file_records = _extract_files(detail)
                        if file_records:
                            attach_folder_id = await gdrive_create_folder(
                                get_token, '3. Tệp đính kèm', t_folder_id, drive_id=drive_id,
                            )
                            fid, _ = await _upload_excel(
                                get_token, attach_folder_id, 'Thông tin files.xlsx',
                                file_records, dest_type,
                            )
                            uploaded_files.append({
                                'path': f'Services/{svc_label}/2. Tickets/{t_label}/3. Tệp đính kèm/Thông tin files.xlsx', 'file_id': fid,
                            })

                        manifest_svc['tickets'].append({
                            'ticket_id': t_id,
                            'ticket_code': str(t_code),
                            'ticket_name': t_name,
                            'folder': t_label,
                        })

                manifest_entries.append(manifest_svc)

            # ── Manifest ─────────────────────────────────────────────
            await _update_log(db, run, 'Writing backup manifest...')
            manifest = {
                'backup_type': backup_type,
                'connector': 'service',
                'service_count': len(selected_services),
                'total_files': len(uploaded_files),
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'services': manifest_entries,
            }
            manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2)
            fid = await _upload_text(get_token, common_folder_id, 'backup_manifest.json', manifest_json)
            uploaded_files.append({'path': '0. Danh mục chung/backup_manifest.json', 'file_id': fid})

            # ── Done ─────────────────────────────────────────────────
            completed_at = datetime.utcnow()
            run.status = 'completed'
            run.completed_at = completed_at
            run.execution_details = {
                'mode': 'service_backup',
                'backup_type': backup_type,
                'uploaded_files': uploaded_files,
            }
            run.logs = f"{run.logs}\n[COMPLETED] Uploaded {len(uploaded_files)} file(s) across {len(selected_services)} service(s)"

            flow.last_run_at = completed_at
            flow.last_run_status = 'completed'
            flow.last_run_message = f"Uploaded {len(uploaded_files)} file(s) across {len(selected_services)} service(s)"
            await db.commit()
        except Exception as exc:
            logger.exception('Service backup failed for flow %s', flow_id)
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
