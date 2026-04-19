from __future__ import annotations

from datetime import datetime
from itertools import product
from typing import Any

import pandas as pd

from modules.backup.backend.extractors._gdrive import (
    build_cached_gdrive_token_provider,
    gdrive_create_folder,
    gdrive_upload_tabular_bytes,
)
from modules.backup.backend.extractors._helpers import build_excel_bytes, sanitize_name
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.runtime import ConnectorRuntimeService
from modules.connectors.backend.shared.validation import ConnectorBindingValidationService
from modules.credentials.backend.services.google_auth_service import (
    GoogleAuthService,
    validate_service_account_drive_destination,
)
from packages.database.src import async_session
from packages.database.src.models import BackupFlow, BackupFlowRun


def _select_stream_keys(connector_key: str, structure: dict[str, Any]) -> list[str]:
    connector = get_connector(connector_key)
    if connector is None:
        raise ValueError(f"Connector '{connector_key}' is not registered")

    requested = [
        str(item).strip()
        for item in (structure.get('objects') or [])
        if str(item).strip()
    ]
    if requested:
        return requested

    return [
        stream.stream_key
        for stream in connector.get_readable_streams()
        if stream.parent_stream is None and not stream.config_fields
    ] or [connector.get_readable_streams()[0].stream_key]


def _resolve_stream_configs(stream, structure: dict[str, Any]) -> list[dict[str, Any]]:
    if not stream.config_fields:
        return [{}]

    options: list[list[Any]] = []
    keys: list[str] = []
    for field in stream.config_fields:
        direct_value = structure.get(field.name)
        plural_key = f"{field.name[:-3]}_ids" if field.name.endswith('_id') else f"{field.name}s"
        plural_value = structure.get(plural_key)

        values: list[Any] = []
        if direct_value not in (None, ''):
            values = [direct_value]
        elif isinstance(plural_value, list):
            values = [item for item in plural_value if item not in (None, '')]

        if not values:
            if field.required:
                raise ValueError(
                    f"Backup structure is missing required field '{field.name}' for stream '{stream.stream_key}'"
                )
            values = [None]

        keys.append(field.name)
        options.append(values)

    configs: list[dict[str, Any]] = []
    for combination in product(*options):
        config = {}
        for key, value in zip(keys, combination, strict=False):
            if value not in (None, ''):
                config[key] = value
        configs.append(config)
    return configs or [{}]


async def run_generic_connector_backup(flow_id: str, run_id: str) -> None:
    async with async_session() as db:
        flow = await db.get(BackupFlow, flow_id)
        run = await db.get(BackupFlowRun, run_id)
        if flow is None or run is None:
            return

        source_connector = None
        try:
            runtime_service = ConnectorRuntimeService(db)
            source_binding = await runtime_service.get_binding_for_credential_id(flow.source_credential_id)
            destination_binding = await runtime_service.get_binding_for_credential_id(
                flow.destination_credential_id,
                overrides_config=dict(flow.destination_target or {}),
            )

            connector = get_connector(source_binding.credential.app_id)
            if connector is None:
                raise ValueError(f"Source connector '{source_binding.credential.app_id}' is not registered")

            ConnectorBindingValidationService.validate_destination_app_id(
                destination_binding.credential.app_id,
                module_key='backup',
                require_tabular_destination=False,
            )

            run.status = 'running'
            run.logs = f"[RUNNING] Starting generic structured backup for {connector.display_name}"
            await db.commit()

            destination_auth = {**destination_binding.auth, **destination_binding.config}
            validate_service_account_drive_destination(destination_auth)

            google_auth_service = GoogleAuthService(db)

            async def load_gdrive_token(force_refresh: bool = False):
                return await google_auth_service.get_destination_access_token_details(
                    destination_auth,
                    force_refresh=force_refresh,
                )

            get_gdrive_token = build_cached_gdrive_token_provider(load_gdrive_token)

            root_folder_id = destination_auth.get('folder_id') or destination_auth.get('drive_id') or 'root'
            app_folder_id = await gdrive_create_folder(
                get_gdrive_token,
                sanitize_name(connector.display_name),
                root_folder_id,
                drive_id=destination_auth.get('drive_id'),
            )

            source_connector = await runtime_service.build_connector(source_binding)
            structure = dict(flow.structure or {})
            stream_keys = _select_stream_keys(connector.connector_key, structure)
            uploaded_files: list[dict[str, Any]] = []

            for stream_key in stream_keys:
                stream = ConnectorBindingValidationService.validate_connector_stream(
                    connector.connector_key,
                    stream_key,
                    capability='read',
                    module_key='backup',
                )
                for stream_config in _resolve_stream_configs(stream, structure):
                    ConnectorBindingValidationService.validate_stream_config(stream, stream_config)
                    records = await source_connector.read_stream(stream_key, config=stream_config)
                    dataframe = pd.DataFrame(records or [])
                    content = build_excel_bytes(dataframe)
                    suffix = "_".join(str(value) for value in stream_config.values() if value not in (None, ''))
                    filename = sanitize_name(f"{stream_key}{'_' + suffix if suffix else ''}.xlsx")
                    uploaded_id = await gdrive_upload_tabular_bytes(
                        get_gdrive_token,
                        filename,
                        content,
                        app_folder_id,
                        destination_type=destination_binding.credential.app_id,
                    )
                    uploaded_files.append({
                        'stream_key': stream_key,
                        'config': stream_config,
                        'record_count': len(records or []),
                        'file_id': uploaded_id,
                        'filename': filename,
                    })

            completed_at = datetime.utcnow()
            run.status = 'completed'
            run.completed_at = completed_at
            run.execution_details = {
                'mode': 'generic_structured_backup',
                'uploaded_files': uploaded_files,
            }
            run.logs = f"{run.logs}\n[COMPLETED] Uploaded {len(uploaded_files)} backup file(s)"

            flow.last_run_at = completed_at
            flow.last_run_status = 'completed'
            flow.last_run_message = f"Uploaded {len(uploaded_files)} backup file(s)"
            await db.commit()
        except Exception as exc:
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
            if source_connector is not None:
                await source_connector.close()
