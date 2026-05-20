from __future__ import annotations

from datetime import datetime
from itertools import product
from typing import Any

from modules.backup.backend.extractors._helpers import sanitize_name
from modules.backup.backend.extractors.destination_tokens import (
    build_backup_destination_token_provider,
)
from modules.backup.backend.extractors.destination_writers import (
    BackupDestinationWriter,
    build_backup_destination_writer,
)
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.runtime import ConnectorRuntimeService
from modules.connectors.backend.shared.validation import ConnectorBindingValidationService
from packages.database.src import async_session
from packages.database.src.models import BackupFlow, BackupFlowRun


# ── Helpers ──────────────────────────────────────────────────────────────────


def _singular_stem(key: str) -> str:
    """Naively singularize a stream key: ``'jobs'`` → ``'job'``."""
    if key.endswith('ies'):
        return key[:-3] + 'y'
    if key.endswith('s') and not key.endswith('ss'):
        return key[:-1]
    return key


def _select_stream_keys(connector_key: str, structure: dict[str, Any]) -> list[str]:
    connector = get_connector(connector_key)
    if connector is None:
        raise ValueError(f"Connector '{connector_key}' is not registered")

    backup_streams = connector.get_backup_streams()
    if not backup_streams:
        raise ValueError(
            f"Connector '{connector_key}' has no backup-eligible streams. "
            "Backup targets unstructured or mixed content; pure structured data "
            "should be moved with the Pipeline module instead."
        )
    allowed_keys = {s.stream_key for s in backup_streams}

    # Build a mapping from wizard object names (singular) to actual stream keys.
    # Prefer list streams like 'jobs' for the wizard object 'job'; only fall back
    # to detail streams such as 'job_details' when no list stream exists.
    _alias_map: dict[str, str] = {s.stream_key: s.stream_key for s in backup_streams}
    for s in backup_streams:
        key = s.stream_key
        if key.endswith('ies'):
            _alias_map.setdefault(key[:-3] + 'y', key)
        elif key.endswith('s') and not key.endswith('ss'):
            _alias_map.setdefault(key[:-1], key)
    for s in backup_streams:
        key = s.stream_key
        if key.endswith('_details'):
            _alias_map.setdefault(key[: -len('_details')], key)

    requested = [
        str(item).strip()
        for item in (structure.get('objects') or [])
        if str(item).strip()
    ]
    if requested:
        resolved = []
        rejected = []
        for key in requested:
            match = _alias_map.get(key)
            if match:
                resolved.append(match)
            else:
                rejected.append(key)
        if rejected:
            raise ValueError(
                f"Streams {rejected} are not approved for backup on connector '{connector_key}'. "
                f"Allowed backup streams: {sorted(allowed_keys)}"
            )
        # Deduplicate while preserving order.
        seen: set[str] = set()
        unique = []
        for k in resolved:
            if k not in seen:
                seen.add(k)
                unique.append(k)
        return _expand_with_descendants(unique, backup_streams)

    # Default selection: top-level backup streams with no required config.
    defaults = [
        stream.stream_key
        for stream in backup_streams
        if stream.parent_stream is None and not stream.config_fields
    ]
    return defaults or [backup_streams[0].stream_key]


def _expand_with_descendants(
    selected_keys: list[str],
    backup_streams: tuple,
) -> list[str]:
    """Auto-include descendant backup-eligible streams of already-selected parents."""
    selected_set = set(selected_keys)
    result = list(selected_keys)
    parent_map = {s.stream_key: s.parent_stream for s in backup_streams}

    for s in backup_streams:
        if s.stream_key in selected_set:
            continue
        ancestor = s.parent_stream
        while ancestor:
            if ancestor in selected_set:
                result.append(s.stream_key)
                selected_set.add(s.stream_key)
                break
            ancestor = parent_map.get(ancestor)

    return result


def _topo_sort_streams(
    stream_keys: list[str],
    backup_streams: tuple,
) -> list[str]:
    """Return *stream_keys* ordered so that parent streams come before children."""
    stream_map = {s.stream_key: s for s in backup_streams}

    def _depth(key: str) -> int:
        d = 0
        s = stream_map.get(key)
        while s and s.parent_stream:
            d += 1
            s = stream_map.get(s.parent_stream)
        return d

    return sorted(stream_keys, key=_depth)


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


def _build_display_name_map(
    records: list[dict[str, Any]],
    primary_key: str | None,
    name_fields: tuple[str, ...] = ('name', 'title', 'display_name', 'label'),
) -> dict[str, str]:
    """Map primary-key values to human-readable display names from fetched records."""
    if not primary_key or not records:
        return {}
    result: dict[str, str] = {}
    for record in records:
        pk = record.get(primary_key)
        if pk is None:
            continue
        pk_str = str(pk)
        display = ''
        for field in name_fields:
            val = record.get(field)
            if val and str(val).strip():
                display = str(val).strip()
                break
        result[pk_str] = display or pk_str
    return result


def _cascade_ids(
    stream_def,
    records: list[dict[str, Any]],
    working_structure: dict[str, Any],
    stream_map: dict,
) -> None:
    """Inject primary-key values of *records* into *working_structure* for child config resolution."""
    if not stream_def.primary_key or not records:
        return
    pk = stream_def.primary_key
    ids = list(dict.fromkeys(
        str(r[pk]) for r in records if pk in r and r[pk] not in (None, '')
    ))
    if not ids:
        return

    singular = _singular_stem(stream_def.stream_key)
    expected_field = f"{singular}_id"
    plural_key = f"{singular}_ids"

    for child in stream_map.values():
        if child.parent_stream != stream_def.stream_key:
            continue
        for field in (child.config_fields or ()):
            if field.name == expected_field:
                existing = working_structure.get(plural_key)
                if isinstance(existing, list):
                    working_structure[plural_key] = list(dict.fromkeys(existing + ids))
                else:
                    working_structure[plural_key] = ids
                break


def _find_grouping_config(
    child_keys: list[str],
    stream_map: dict,
    root_keys_set: set[str],
    structure: dict[str, Any],
) -> tuple[str, str, str] | None:
    """
    Identify the top-level grouping dimension for hierarchical folder creation.

    Returns ``(config_field, plural_key, parent_stream_key)`` or ``None``.
    E.g. ``('workflow_id', 'workflow_ids', 'workflows')`` for Workflow connector.
    """
    for key in child_keys:
        stream = stream_map.get(key)
        if not stream or not stream.config_fields or not stream.parent_stream:
            continue
        if stream.parent_stream not in root_keys_set:
            continue
        for field in stream.config_fields:
            plural_key = f"{field.name[:-3]}_ids" if field.name.endswith('_id') else f"{field.name}s"
            group_values = structure.get(plural_key)
            if isinstance(group_values, list) and group_values:
                return (field.name, plural_key, stream.parent_stream)

    return None


# ── Backup upload helper ─────────────────────────────────────────────────────


async def _upload_stream(
    source_connector,
    stream_key: str,
    stream,
    stream_config: dict[str, Any],
    folder_id: str,
    filename: str,
    writer: BackupDestinationWriter,
) -> tuple[list[dict[str, Any]], str]:
    """Read a stream, convert to Excel, upload and return ``(records, file_id)``."""
    ConnectorBindingValidationService.validate_stream_config(stream, stream_config)
    records = await source_connector.read_stream(stream_key, config=stream_config)
    file_id, _ = await writer.upload_excel(folder_id, filename, records or [])
    return (records or []), file_id


# ── Main backup runner ───────────────────────────────────────────────────────


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
                pipeline_destination_only=False,
            )

            run.status = 'running'
            run.logs = f"[RUNNING] Starting generic structured backup for {connector.display_name}"
            await db.commit()

            async def _log(msg: str) -> None:
                ts = datetime.utcnow().strftime('%H:%M:%S')
                run.logs = f"{run.logs or ''}\n[{ts}] {msg}".strip()
                await db.commit()

            destination_auth = {**destination_binding.auth, **destination_binding.config}
            dest_type = destination_binding.credential.app_id
            get_token = await build_backup_destination_token_provider(
                db,
                dest_type,
                destination_auth,
            )

            root_folder_id = destination_auth.get('folder_id') or destination_auth.get('drive_id') or 'root'
            drive_id = destination_auth.get('drive_id')

            await _log('Preparing destination folder...')
            app_folder_name = sanitize_name(connector.display_name)
            writer: BackupDestinationWriter = build_backup_destination_writer(
                destination_type=dest_type,
                get_token=get_token,
                root_folder_id=root_folder_id,
                drive_id=drive_id,
                flow_id=str(flow.id),
                flow_name=flow.name,
                app_folder_name=app_folder_name,
            )
            app_folder_id, archived_count = await writer.prepare_app_folder()
            if archived_count:
                await _log(f'Archived {archived_count} old "{app_folder_name}" folder(s)')

            source_connector = await runtime_service.build_connector(source_binding)
            structure = dict(flow.structure or {})
            stream_keys = _select_stream_keys(connector.connector_key, structure)
            await _log(f'Selected streams: {stream_keys}')
            uploaded_files: list[dict[str, Any]] = []

            # ── Build hierarchy metadata ─────────────────────────────
            backup_streams = connector.get_backup_streams()
            stream_map = {s.stream_key: s for s in backup_streams}
            ordered_keys = _topo_sort_streams(stream_keys, backup_streams)
            selected_set = set(ordered_keys)

            root_keys = [
                k for k in ordered_keys
                if not stream_map.get(k)
                or stream_map[k].parent_stream is None
                or stream_map[k].parent_stream not in selected_set
            ]
            child_keys = [k for k in ordered_keys if k not in set(root_keys)]
            root_keys_set = set(root_keys)

            display_names: dict[str, dict[str, str]] = {}
            subfolder_cache: dict[str, str] = {}
            cascaded = dict(structure)

            # ── Phase 1: Root-level streams ───────────────────────────
            await _log(f'Phase 1: Backing up {len(root_keys)} root stream(s)...')
            for stream_key in root_keys:
                stream = ConnectorBindingValidationService.validate_connector_stream(
                    connector.connector_key, stream_key,
                    capability='read', module_key='backup',
                )
                for stream_config in _resolve_stream_configs(stream, cascaded):
                    suffix = "_".join(
                        str(v) for v in stream_config.values() if v not in (None, '')
                    )
                    filename = sanitize_name(
                        f"{stream_key}{'_' + suffix if suffix else ''}.xlsx"
                    )
                    records, file_id = await _upload_stream(
                        source_connector, stream_key, stream, stream_config,
                        app_folder_id, filename, writer,
                    )
                    if stream.primary_key and records:
                        display_names[stream_key] = _build_display_name_map(
                            records, stream.primary_key,
                        )
                    uploaded_files.append({
                        'stream_key': stream_key,
                        'config': stream_config,
                        'record_count': len(records),
                        'file_id': file_id,
                        'filename': filename,
                    })
                    await _log(f'  Uploaded {filename} ({len(records)} records)')

            # ── Phase 2: Child streams — grouped into subfolders ──────
            if child_keys:
                await _log(f'Phase 2: Backing up {len(child_keys)} child stream(s)...')
            grouping = _find_grouping_config(
                child_keys, stream_map, root_keys_set, cascaded,
            )

            if grouping and child_keys:
                config_field, plural_key, parent_stream_key = grouping
                group_values = cascaded.get(plural_key) or []

                for group_value in group_values:
                    gv = str(group_value)
                    display = display_names.get(parent_stream_key, {}).get(gv, gv)
                    folder_label = sanitize_name(display)
                    if folder_label not in subfolder_cache:
                        subfolder_cache[folder_label] = await writer.create_folder(folder_label, app_folder_id)
                    group_folder_id = subfolder_cache[folder_label]

                    local = {**cascaded, config_field: gv}
                    local.pop(plural_key, None)

                    for child_key in child_keys:
                        stream = ConnectorBindingValidationService.validate_connector_stream(
                            connector.connector_key, child_key,
                            capability='read', module_key='backup',
                        )
                        try:
                            configs = _resolve_stream_configs(stream, local)
                        except ValueError:
                            continue

                        for stream_config in configs:
                            non_group = {
                                k: v for k, v in stream_config.items()
                                if k != config_field and v not in (None, '')
                            }
                            suffix = "_".join(str(v) for v in non_group.values())
                            filename = sanitize_name(
                                f"{child_key}{'_' + suffix if suffix else ''}.xlsx"
                            )
                            records, file_id = await _upload_stream(
                                source_connector, child_key, stream, stream_config,
                                group_folder_id, filename, writer,
                            )
                            _cascade_ids(stream, records, local, stream_map)
                            if stream.primary_key and records:
                                display_names.setdefault(child_key, {}).update(
                                    _build_display_name_map(records, stream.primary_key)
                                )
                            uploaded_files.append({
                                'stream_key': child_key,
                                'config': stream_config,
                                'record_count': len(records),
                                'file_id': file_id,
                                'filename': filename,
                                'folder': folder_label,
                            })

            elif child_keys:
                # No grouping dimension — flat processing (legacy behaviour)
                for child_key in child_keys:
                    stream = ConnectorBindingValidationService.validate_connector_stream(
                        connector.connector_key, child_key,
                        capability='read', module_key='backup',
                    )
                    try:
                        configs = _resolve_stream_configs(stream, cascaded)
                    except ValueError:
                        continue
                    for stream_config in configs:
                        suffix = "_".join(
                            str(v) for v in stream_config.values()
                            if v not in (None, '')
                        )
                        filename = sanitize_name(
                            f"{child_key}{'_' + suffix if suffix else ''}.xlsx"
                        )
                        records, file_id = await _upload_stream(
                            source_connector, child_key, stream, stream_config,
                            app_folder_id, filename, writer,
                        )
                        _cascade_ids(stream, records, cascaded, stream_map)
                        uploaded_files.append({
                            'stream_key': child_key,
                            'config': stream_config,
                            'record_count': len(records),
                            'file_id': file_id,
                            'filename': filename,
                        })

            completed_at = datetime.utcnow()
            run.status = 'completed'
            run.completed_at = completed_at
            run.execution_details = {
                'mode': 'generic_structured_backup',
                'destination_writer': writer.destination_type,
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
