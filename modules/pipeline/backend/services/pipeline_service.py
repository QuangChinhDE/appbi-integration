"""
Pipeline service: scoped CRUD, validation, execution, and schedule polling.

A pipeline pairs one source credential with one destination credential and
contains a list of *bindings* — each binding is a (source_stream ->
dest_stream) transfer with its own write_mode, config overrides, and field
mapping. A run iterates bindings in order; partial failures mark the run as
failed but still record the per-binding counts.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.connectors.backend.shared.runtime import ConnectorRuntimeService
from modules.connectors.backend.shared.validation import ConnectorBindingValidationService


def _infer_scalar_type(value: Any) -> str:
    """Coarse runtime type for discovered field values.

    Nested objects/arrays are reported as 'object'/'array' without inspecting
    their contents — destinations (BigQuery, Sheets) treat them as a single
    JSON-typed column.
    """
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, list):
        return 'array'
    if isinstance(value, Mapping):
        return 'object'
    return 'unknown'


def _merge_field_types(existing: str | None, incoming: str) -> str:
    if existing is None or existing == 'null':
        return incoming
    if incoming == 'null' or incoming == existing:
        return existing
    # Mixed types across records → fall back to 'mixed' so the UI can flag it.
    return 'mixed'
from packages.auth.src.resource_permissions import (
    apply_resource_scope,
    batch_effective_permissions,
    fetch_owner_email_lookup,
    get_effective_permission,
    require_credential_access,
)
from packages.database.src import async_session
from packages.database.src.models import (
    AppCredential,
    DataPipeline,
    PipelineRun,
    PipelineStatus,
    ResourceType,
    User,
)


PIPELINE_RUN_TASKS: dict[str, asyncio.Task] = {}


class PipelineService:
    INTERRUPTED_RUN_MESSAGE = "Interrupted because the API process restarted while the pipeline was still running. Start it again to resume with a fresh run."
    MANUALLY_STOPPED_RUN_MESSAGE = "Interrupted because the pipeline was manually stopped."

    def __init__(self, db: AsyncSession):
        self.db = db

    async def interrupt_incomplete_runs(self, message: str | None = None) -> int:
        result = await self.db.execute(
            select(PipelineRun).where(PipelineRun.status.in_(("pending", "running")))
        )
        active_runs = result.scalars().all()
        if not active_runs:
            return 0

        interrupt_message = message or self.INTERRUPTED_RUN_MESSAGE
        completed_at = datetime.now(timezone.utc)
        pipeline_ids = {run.pipeline_id for run in active_runs}

        for run in active_runs:
            run.status = 'failed'
            run.completed_at = completed_at
            run.error_message = run.error_message or interrupt_message
            run.logs = self._append_log(run.logs, f"[INTERRUPTED] {interrupt_message}")

        result = await self.db.execute(
            select(DataPipeline).where(DataPipeline.id.in_(tuple(pipeline_ids)))
        )
        for pipeline in result.scalars().all():
            pipeline.last_run_status = 'failed'
            pipeline.last_run_at = completed_at

        await self.db.commit()
        return len(active_runs)

    async def interrupt_pipeline_running_tasks(self, pipeline_id: UUID, message: str | None = None) -> dict[str, int]:
        result = await self.db.execute(
            select(PipelineRun)
            .where(
                and_(
                    PipelineRun.pipeline_id == pipeline_id,
                    PipelineRun.status.in_(("pending", "running")),
                )
            )
            .order_by(PipelineRun.started_at.desc())
        )
        active_runs = result.scalars().all()
        cancelled_task_count = 0
        for run in active_runs:
            task = PIPELINE_RUN_TASKS.get(str(run.id))
            if task is None:
                continue
            if task.done():
                PIPELINE_RUN_TASKS.pop(str(run.id), None)
                continue
            task.cancel()
            cancelled_task_count += 1

        interrupted_run_count = 0
        if active_runs:
            completed_at = datetime.now(timezone.utc)
            interrupt_message = message or self.MANUALLY_STOPPED_RUN_MESSAGE
            for run in active_runs:
                run.status = 'failed'
                run.completed_at = completed_at
                run.error_message = run.error_message or interrupt_message
                run.logs = self._append_log(run.logs, f"[INTERRUPTED] {interrupt_message}")

            pipeline = await self.db.get(DataPipeline, pipeline_id)
            if pipeline is not None:
                pipeline.last_run_status = 'failed'
                pipeline.last_run_at = completed_at

            await self.db.commit()
            interrupted_run_count = len(active_runs)

        return {
            'cancelled_task_count': cancelled_task_count,
            'interrupted_run_count': interrupted_run_count,
        }

    async def list_pipelines(
        self,
        current_user: User,
        *,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        stmt = select(DataPipeline).order_by(desc(DataPipeline.updated_at))
        stmt = apply_resource_scope(
            stmt,
            DataPipeline,
            ResourceType.DATA_PIPELINE,
            current_user,
            module='pipeline',
        )
        if status:
            stmt = stmt.where(DataPipeline.status == status)

        result = await self.db.execute(stmt)
        items = result.scalars().all()
        owner_lookup = await fetch_owner_email_lookup(self.db, (item.owner_id for item in items))
        permission_map = await batch_effective_permissions(
            self.db,
            current_user,
            items,
            module='pipeline',
            resource_type=ResourceType.DATA_PIPELINE,
        )
        return [
            self._pipeline_to_dict(
                item,
                owner_email=owner_lookup.get(item.owner_id),
                user_permission=permission_map.get(str(item.id), 'none'),
            )
            for item in items
        ]

    async def get_pipeline(self, pipeline: DataPipeline, current_user: User) -> dict[str, Any]:
        owner_lookup = await fetch_owner_email_lookup(self.db, (pipeline.owner_id,))
        user_permission = await get_effective_permission(
            self.db,
            current_user,
            pipeline,
            module='pipeline',
            resource_type=ResourceType.DATA_PIPELINE,
        )
        return self._pipeline_to_dict(
            pipeline,
            owner_email=owner_lookup.get(pipeline.owner_id),
            user_permission=user_permission,
        )

    async def create_pipeline(self, data: dict[str, Any], current_user: User) -> dict[str, Any]:
        payload = await self._validate_pipeline_payload(data, current_user)
        pipeline = DataPipeline(
            name=payload['name'],
            description=payload.get('description'),
            owner_id=current_user.id,
            status=payload.get('status', PipelineStatus.DRAFT),
            source_connector_key=payload['source_connector_key'],
            source_credential_id=payload['source_credential_id'],
            dest_connector_key=payload['dest_connector_key'],
            dest_credential_id=payload['dest_credential_id'],
            bindings=payload['bindings'],
            schedule=payload.get('schedule'),
        )
        self.db.add(pipeline)
        await self.db.flush()
        await self.db.refresh(pipeline)
        return await self.get_pipeline(pipeline, current_user)

    async def update_pipeline(
        self,
        pipeline: DataPipeline,
        data: dict[str, Any],
        current_user: User,
    ) -> dict[str, Any]:
        merged = {
            'name': pipeline.name,
            'description': pipeline.description,
            'status': pipeline.status,
            'source_connector_key': pipeline.source_connector_key,
            'source_credential_id': pipeline.source_credential_id,
            'dest_connector_key': pipeline.dest_connector_key,
            'dest_credential_id': pipeline.dest_credential_id,
            'bindings': list(pipeline.bindings or []),
            'schedule': pipeline.schedule,
        }
        merged.update(data)
        payload = await self._validate_pipeline_payload(merged, current_user)

        for key in (
            'name', 'description', 'status',
            'source_connector_key', 'source_credential_id',
            'dest_connector_key', 'dest_credential_id',
            'bindings', 'schedule',
        ):
            setattr(pipeline, key, payload.get(key))

        await self.db.flush()
        await self.db.refresh(pipeline)
        return await self.get_pipeline(pipeline, current_user)

    async def delete_pipeline(self, pipeline: DataPipeline) -> bool:
        await self.db.delete(pipeline)
        await self.db.flush()
        return True

    async def list_runs(self, pipeline: DataPipeline, current_user: User, *, limit: int = 50) -> list[dict[str, Any]]:
        stmt = (
            select(PipelineRun)
            .where(PipelineRun.pipeline_id == pipeline.id)
            .order_by(desc(PipelineRun.started_at))
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        permission = await get_effective_permission(
            self.db,
            current_user,
            pipeline,
            module='pipeline',
            resource_type=ResourceType.DATA_PIPELINE,
        )
        return [self._run_to_dict(run, pipeline_id=str(pipeline.id), user_permission=permission) for run in result.scalars().all()]

    async def get_run(self, run: PipelineRun, current_user: User) -> dict[str, Any]:
        pipeline = await self.db.get(DataPipeline, run.pipeline_id)
        user_permission = None
        if pipeline is not None:
            user_permission = await get_effective_permission(
                self.db,
                current_user,
                pipeline,
                module='pipeline',
                resource_type=ResourceType.DATA_PIPELINE,
            )
        return self._run_to_dict(run, pipeline_id=str(run.pipeline_id), user_permission=user_permission)

    async def trigger_run(self, pipeline: DataPipeline, triggered_by: str) -> dict[str, Any]:
        await self._validate_pipeline_payload(self._model_to_validation_payload(pipeline))

        run = PipelineRun(
            pipeline_id=pipeline.id,
            status='pending',
            triggered_by=triggered_by,
            run_config=self._snapshot_run_config(pipeline),
            logs='[PENDING] Pipeline run queued',
        )
        self.db.add(run)
        await self.db.commit()
        await self.db.refresh(run)

        pipeline.last_run_status = 'running'
        pipeline.last_run_at = run.started_at
        await self.db.commit()

        task = asyncio.create_task(self._execute_pipeline_run(pipeline.id, run.id))
        run_key = str(run.id)
        PIPELINE_RUN_TASKS[run_key] = task
        task.add_done_callback(lambda _: PIPELINE_RUN_TASKS.pop(run_key, None))

        return self._run_to_dict(run, pipeline_id=str(pipeline.id))

    async def stop_pipeline(self, pipeline: DataPipeline) -> dict[str, int]:
        return await self.interrupt_pipeline_running_tasks(
            pipeline.id,
            self.MANUALLY_STOPPED_RUN_MESSAGE,
        )

    async def discover_source_fields(
        self,
        *,
        source_credential_id: UUID | str,
        source_connector_key: str,
        source_stream_key: str,
        source_config: Mapping[str, Any] | None = None,
        sample_size: int = 10,
        current_user: User,
    ) -> dict[str, Any]:
        """Run a live read against the source stream and report top-level keys.

        This is the "test & discover" path the wizard uses: it validates the
        stream config, opens a connector from the saved credential, calls
        ``read_stream``, and unions the top-level keys across up to
        ``sample_size`` records. Nested values are classified as ``object`` /
        ``array`` without drilling down — destinations treat them as one JSON
        column.
        """
        credential = await require_credential_access(
            self.db, current_user, source_credential_id, min_level='view',
        )
        ConnectorBindingValidationService.validate_source_credential(
            credential,
            module_key='pipeline',
        )
        ConnectorBindingValidationService.validate_credential_connector_match(
            credential,
            str(source_connector_key),
        )
        ConnectorBindingValidationService.validate_source_stream(
            str(source_connector_key),
            str(source_stream_key),
            dict(source_config or {}),
            module_key='pipeline',
        )

        runtime = ConnectorRuntimeService(self.db)
        connector = await runtime.build_connector_from_credential_id(credential.id)
        try:
            records = await connector.read_stream(
                str(source_stream_key),
                config=dict(source_config or {}),
            )
        finally:
            await connector.close()

        records = list(records or [])
        sample = records[:max(1, int(sample_size))]
        field_types: dict[str, str] = {}
        for record in sample:
            if not isinstance(record, Mapping):
                continue
            for key, value in record.items():
                key_str = str(key)
                field_types[key_str] = _merge_field_types(
                    field_types.get(key_str),
                    _infer_scalar_type(value),
                )

        fields = [
            {'name': name, 'type': field_types[name]}
            for name in sorted(field_types)
        ]
        return {
            'source_connector_key': str(source_connector_key),
            'source_stream_key': str(source_stream_key),
            'sample_size': len(sample),
            'total_records_read': len(records),
            'fields': fields,
        }

    async def run_due_schedules_once(self) -> int:
        stmt = (
            select(DataPipeline)
            .where(DataPipeline.status == PipelineStatus.ACTIVE)
            .order_by(DataPipeline.updated_at.asc())
        )
        result = await self.db.execute(stmt)
        pipelines = result.scalars().all()
        triggered = 0

        active_result = await self.db.execute(
            select(PipelineRun.pipeline_id).where(PipelineRun.status.in_(("pending", "running")))
        )
        active_pipeline_ids = {row[0] for row in active_result.all()}

        for pipeline in pipelines:
            if pipeline.id in active_pipeline_ids:
                continue
            if not self._is_schedule_due(dict(pipeline.schedule or {}), pipeline.last_run_at):
                continue
            await self.trigger_run(pipeline, 'scheduler')
            triggered += 1
        return triggered

    # ── Validation ────────────────────────────────────────────────────────

    async def _validate_pipeline_payload(self, data: Mapping[str, Any], current_user: User | None = None) -> dict[str, Any]:
        payload = dict(data or {})
        name = str(payload.get('name') or '').strip()
        if not name:
            raise ValueError('Pipeline name is required')
        payload['name'] = name

        if not payload.get('source_connector_key'):
            raise ValueError('source_connector_key is required')
        if not payload.get('dest_connector_key'):
            raise ValueError('dest_connector_key is required')
        if not payload.get('source_credential_id'):
            raise ValueError('source_credential_id is required')
        if not payload.get('dest_credential_id'):
            raise ValueError('dest_credential_id is required')

        if current_user is not None:
            source_credential = await require_credential_access(
                self.db, current_user, payload.get('source_credential_id'), min_level='view',
            )
            dest_credential = await require_credential_access(
                self.db, current_user, payload.get('dest_credential_id'), min_level='view',
            )
        else:
            source_credential = await self._load_credential(payload.get('source_credential_id'))
            dest_credential = await self._load_credential(payload.get('dest_credential_id'))

        ConnectorBindingValidationService.validate_source_credential(
            source_credential,
            module_key='pipeline',
        )
        ConnectorBindingValidationService.validate_destination_credential(
            dest_credential,
            module_key='pipeline',
            pipeline_destination_only=True,
        )
        ConnectorBindingValidationService.validate_credential_connector_match(
            source_credential,
            str(payload['source_connector_key']),
        )
        ConnectorBindingValidationService.validate_credential_connector_match(
            dest_credential,
            str(payload['dest_connector_key']),
        )

        bindings = self._normalize_bindings(
            payload.get('bindings'),
            source_connector_key=str(payload['source_connector_key']),
            dest_connector_key=str(payload['dest_connector_key']),
        )
        payload['bindings'] = bindings

        payload['schedule'] = self._normalize_schedule(payload.get('schedule'))

        status = str(payload.get('status') or PipelineStatus.DRAFT).strip().lower()
        if status not in {PipelineStatus.DRAFT, PipelineStatus.ACTIVE, PipelineStatus.PAUSED, PipelineStatus.ARCHIVED}:
            raise ValueError('status must be one of: draft, active, paused, archived')
        if status == PipelineStatus.ACTIVE and not bindings:
            raise ValueError('Active pipelines require at least one binding')
        payload['status'] = status

        return payload

    # Airbyte-style sync modes. Each value pairs a read strategy with a write
    # strategy; the destination writer only sees the resolved write_mode.
    SYNC_MODES = {
        'full_refresh_overwrite': 'replace',
        'full_refresh_append': 'append',
        'incremental_append': 'append',
        'incremental_dedup': 'upsert',
    }

    @classmethod
    def _resolve_sync_mode(cls, item: Mapping[str, Any]) -> tuple[str, str]:
        """Pick a canonical (sync_mode, write_mode) pair from a binding payload.

        Accepts either the new ``sync_mode`` field (Airbyte-style) or the legacy
        ``write_mode`` field on its own. Returns the resolved (sync_mode,
        write_mode) tuple so downstream code can rely on both being present.
        """
        sync_mode = str(item.get('sync_mode') or '').strip().lower()
        if sync_mode:
            if sync_mode not in cls.SYNC_MODES:
                raise ValueError(
                    f"Invalid sync_mode '{sync_mode}'. Must be one of: "
                    + ', '.join(sorted(cls.SYNC_MODES))
                )
            return sync_mode, cls.SYNC_MODES[sync_mode]

        # Back-fill sync_mode from legacy write_mode for pipelines created
        # before the Airbyte-style picker landed.
        legacy_write = str(item.get('write_mode') or 'append').strip().lower()
        if legacy_write == 'replace':
            return 'full_refresh_overwrite', 'replace'
        if legacy_write == 'upsert':
            return 'incremental_dedup', 'upsert'
        return 'full_refresh_append', 'append'

    @classmethod
    def _normalize_bindings(
        cls,
        bindings: Any,
        *,
        source_connector_key: str,
        dest_connector_key: str,
    ) -> list[dict[str, Any]]:
        if not isinstance(bindings, list) or not bindings:
            raise ValueError('At least one binding is required (source_stream_key → dest_stream_key)')

        seen: set[tuple[str, str]] = set()
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(bindings):
            if not isinstance(item, Mapping):
                raise ValueError(f"Binding #{index + 1} must be an object")

            source_stream_key = str(item.get('source_stream_key') or '').strip()
            dest_stream_key = str(item.get('dest_stream_key') or '').strip()
            if not source_stream_key:
                raise ValueError(f"Binding #{index + 1} is missing source_stream_key")
            if not dest_stream_key:
                raise ValueError(f"Binding #{index + 1} is missing dest_stream_key")

            dedupe_key = (source_stream_key, dest_stream_key)
            if dedupe_key in seen:
                raise ValueError(
                    f"Duplicate binding for '{source_stream_key}' → '{dest_stream_key}'"
                )
            seen.add(dedupe_key)

            source_config = dict(item.get('source_config') or {})
            dest_config = dict(item.get('dest_config') or {})

            source_stream = ConnectorBindingValidationService.validate_source_stream(
                source_connector_key,
                source_stream_key,
                source_config,
                module_key='pipeline',
            )
            dest_stream = ConnectorBindingValidationService.validate_destination_stream(
                dest_connector_key,
                dest_stream_key,
                dest_config,
                module_key='pipeline',
                pipeline_destination_only=True,
            )

            sync_mode, write_mode = cls._resolve_sync_mode(item)

            # Validate write_mode against destination capabilities.
            if dest_stream.write_config and write_mode not in dest_stream.write_config.supported_modes:
                raise ValueError(
                    f"Destination stream '{dest_stream_key}' does not support write mode '{write_mode}' "
                    f"(required for sync_mode='{sync_mode}'). Supported: {list(dest_stream.write_config.supported_modes)}"
                )

            # Resource-kind destinations only make sense with append semantics —
            # they create new records, there's no meaningful 'replace' or
            # 'upsert' without a merge key strategy.
            if (
                dest_stream.write_config
                and dest_stream.write_config.target_kind == 'resource'
                and write_mode != 'append'
            ):
                raise ValueError(
                    f"Destination stream '{dest_stream_key}' is a resource target and only supports "
                    f"full_refresh_append or incremental_append sync modes"
                )

            # Incremental sync modes need a cursor_field. Prefer the binding
            # override; fall back to the stream's declared cursor_field.
            cursor_field = item.get('cursor_field') or source_stream.cursor_field
            if sync_mode.startswith('incremental_') and not cursor_field:
                raise ValueError(
                    f"Binding #{index + 1} uses sync_mode='{sync_mode}' but no cursor_field is "
                    f"available. Either set cursor_field on the binding or pick a stream that "
                    f"declares one."
                )

            # Dedup needs primary_key(s) to identify duplicates. Prefer override.
            primary_key = item.get('primary_key')
            if primary_key is not None and not isinstance(primary_key, list):
                raise ValueError(f"Binding #{index + 1}: primary_key must be a list of field names")
            if not primary_key and source_stream.primary_key:
                primary_key = [source_stream.primary_key]
            if sync_mode == 'incremental_dedup' and not primary_key:
                raise ValueError(
                    f"Binding #{index + 1} uses sync_mode='incremental_dedup' but no primary_key "
                    f"is set. Either set primary_key on the binding or pick a stream that declares one."
                )

            # selected_fields: list of top-level keys or dotted paths to keep
            # in each record. None / [] = pass through every field.
            selected_fields = item.get('selected_fields')
            if selected_fields is not None and not isinstance(selected_fields, list):
                raise ValueError(f"Binding #{index + 1}: selected_fields must be a list of field paths")

            field_mapping = item.get('field_mapping') or {}
            if not isinstance(field_mapping, Mapping):
                raise ValueError(f"Binding #{index + 1}: field_mapping must be an object")

            normalized.append({
                'source_stream_key': source_stream_key,
                'source_config': source_config,
                'dest_stream_key': dest_stream_key,
                'dest_config': dest_config,
                'sync_mode': sync_mode,
                'write_mode': write_mode,
                'cursor_field': cursor_field or None,
                'primary_key': list(primary_key) if primary_key else None,
                'selected_fields': list(selected_fields) if selected_fields else None,
                'field_mapping': dict(field_mapping),
            })

            # Touch source_stream so we exercise the config-field check path.
            _ = source_stream.can_read

        return normalized

    # ── Execution ─────────────────────────────────────────────────────────

    async def _execute_pipeline_run(self, pipeline_id: UUID, run_id: UUID) -> None:
        async with async_session() as db:
            service = PipelineService(db)
            pipeline = await db.get(DataPipeline, pipeline_id)
            run = await db.get(PipelineRun, run_id)
            if pipeline is None or run is None:
                return

            source_connector = None
            dest_connector = None
            try:
                runtime_service = ConnectorRuntimeService(db)
                source_connector = await runtime_service.build_connector_from_credential_id(pipeline.source_credential_id)
                dest_connector = await runtime_service.build_connector_from_credential_id(pipeline.dest_credential_id)

                run.status = 'running'
                run.logs = service._append_log(run.logs, '[RUNNING] Executing bindings')
                await db.commit()

                total_read = 0
                total_written = 0
                total_errors = 0
                binding_results: list[dict[str, Any]] = []

                for index, binding in enumerate(pipeline.bindings or []):
                    source_stream_key = str(binding.get('source_stream_key') or '')
                    dest_stream_key = str(binding.get('dest_stream_key') or '')
                    source_config = dict(binding.get('source_config') or {})
                    dest_config = dict(binding.get('dest_config') or {})
                    # Resolve sync_mode + write_mode together so legacy
                    # bindings (write_mode only) and new bindings (sync_mode)
                    # both work without the executor branching.
                    sync_mode, write_mode = PipelineService._resolve_sync_mode(binding)
                    cursor_field = binding.get('cursor_field')
                    primary_key = binding.get('primary_key') or []
                    selected_fields = binding.get('selected_fields')
                    field_mapping = dict(binding.get('field_mapping') or {})

                    run.logs = service._append_log(
                        run.logs,
                        f"[RUNNING] Binding {index + 1}/{len(pipeline.bindings or [])}: "
                        f"{source_stream_key} → {dest_stream_key} ({sync_mode})",
                    )
                    await db.commit()

                    # Incremental syncs read the prior checkpoint and pass it
                    # to the connector via the `cursor` argument so declarative
                    # connectors can inject it into the request (e.g. updated_from).
                    cursor_state: dict[str, Any] | None = None
                    if sync_mode.startswith('incremental_') and cursor_field:
                        cursor_state = await service._read_cursor_state(
                            pipeline_id=pipeline.id,
                            binding_index=index,
                        )

                    source_records = await source_connector.read_stream(
                        source_stream_key,
                        config=source_config,
                        cursor=cursor_state,
                    )

                    # Field selection (AirByte Fields drawer toggles) — drop
                    # any keys the user disabled before they hit the destination.
                    if selected_fields:
                        source_records = [
                            service._filter_record_fields(rec, selected_fields)
                            for rec in source_records
                        ]

                    mapped_records = service._apply_field_mapping(source_records, field_mapping)

                    # Dedup (Append + Deduped) maps to write_mode='upsert' with
                    # the first primary_key as the merge_key (BigQuery accepts
                    # one merge_key today).
                    write_config = {**dest_config, 'write_mode': write_mode}
                    if sync_mode == 'incremental_dedup' and primary_key:
                        write_config.setdefault('merge_key', primary_key[0])
                    write_result = await dest_connector.write_stream(
                        dest_stream_key,
                        mapped_records,
                        config=write_config,
                    )

                    # After a successful write, persist the maximum observed
                    # cursor value so the next run picks up where we left off.
                    if sync_mode.startswith('incremental_') and cursor_field:
                        new_cursor = service._extract_max_cursor_value(source_records, cursor_field)
                        if new_cursor is not None:
                            await service._write_cursor_state(
                                pipeline_id=pipeline.id,
                                binding_index=index,
                                cursor_field=cursor_field,
                                cursor_value=new_cursor,
                            )

                    read_count = len(source_records)
                    written_count = service._extract_written_count(write_result, fallback=len(mapped_records))
                    errors_count = int(write_result.get('errors') or write_result.get('error_count') or 0)

                    total_read += read_count
                    total_written += written_count
                    total_errors += errors_count
                    binding_results.append({
                        'source_stream_key': source_stream_key,
                        'dest_stream_key': dest_stream_key,
                        'sync_mode': sync_mode,
                        'records_read': read_count,
                        'records_written': written_count,
                        'errors': errors_count,
                    })

                completed_at = datetime.now(timezone.utc)
                run.status = 'completed' if total_errors == 0 else 'failed'
                run.completed_at = completed_at
                run.records_read = total_read
                run.records_written = total_written
                run.error_count = total_errors
                run.run_config = {**(run.run_config or {}), 'binding_results': binding_results}
                status_label = 'COMPLETED' if total_errors == 0 else 'FAILED'
                run.logs = service._append_log(
                    run.logs,
                    f"[{status_label}] read={total_read} written={total_written} errors={total_errors}",
                )

                pipeline.last_run_at = completed_at
                pipeline.last_run_status = run.status
                await db.commit()
            except asyncio.CancelledError:
                completed_at = datetime.now(timezone.utc)
                run.status = 'failed'
                run.completed_at = completed_at
                run.error_message = self.MANUALLY_STOPPED_RUN_MESSAGE
                run.logs = service._append_log(run.logs, f"[FAILED] {self.MANUALLY_STOPPED_RUN_MESSAGE}")
                pipeline.last_run_at = completed_at
                pipeline.last_run_status = 'failed'
                await db.commit()
                raise
            except Exception as exc:
                completed_at = datetime.now(timezone.utc)
                run.status = 'failed'
                run.completed_at = completed_at
                run.error_message = str(exc)
                run.logs = service._append_log(run.logs, f"[FAILED] {exc}")
                pipeline.last_run_at = completed_at
                pipeline.last_run_status = 'failed'
                await db.commit()
            finally:
                if source_connector is not None:
                    await source_connector.close()
                if dest_connector is not None:
                    await dest_connector.close()

    # ── Schedule helpers ──────────────────────────────────────────────────

    @staticmethod
    def _normalize_schedule(schedule: Any) -> dict[str, Any]:
        payload = dict(schedule or {})
        schedule_type = str(payload.get('type') or 'manual').strip().lower()
        if schedule_type not in {'manual', 'interval', 'cron'}:
            raise ValueError('schedule.type must be manual, interval, or cron')

        normalized = {
            'type': schedule_type,
            'enabled': bool(payload.get('enabled', schedule_type != 'manual')),
            'timezone': str(payload.get('timezone') or 'UTC').strip() or 'UTC',
        }

        try:
            ZoneInfo(normalized['timezone'])
        except Exception as exc:
            raise ValueError(f"Invalid schedule timezone '{normalized['timezone']}'") from exc

        if schedule_type == 'interval':
            interval_hours = int(payload.get('interval_hours') or 0)
            if interval_hours <= 0:
                raise ValueError('schedule.interval_hours must be a positive integer')
            normalized['interval_hours'] = interval_hours
        elif schedule_type == 'cron':
            cron = str(payload.get('cron') or '').strip()
            if not cron:
                raise ValueError('schedule.cron is required for cron schedules')
            if len(cron.split()) != 5:
                raise ValueError('schedule.cron must contain 5 fields')
            normalized['cron'] = cron

        return normalized

    @staticmethod
    def _is_schedule_due(schedule: Mapping[str, Any] | None, last_run_at: datetime | None) -> bool:
        payload = dict(schedule or {})
        schedule_type = str(payload.get('type') or 'manual').strip().lower()
        if schedule_type == 'manual' or payload.get('enabled') is False:
            return False

        timezone_name = str(payload.get('timezone') or 'UTC').strip() or 'UTC'
        now = datetime.now(ZoneInfo(timezone_name))
        last_run_local = last_run_at.astimezone(ZoneInfo(timezone_name)) if last_run_at else None

        if schedule_type == 'interval':
            interval_hours = int(payload.get('interval_hours') or 0)
            if interval_hours <= 0:
                return False
            if last_run_local is None:
                return True
            return now >= last_run_local + timedelta(hours=interval_hours)

        cron = str(payload.get('cron') or '').strip()
        if not cron:
            return False
        minute_mark = now.replace(second=0, microsecond=0)
        if last_run_local is not None and last_run_local.replace(second=0, microsecond=0) >= minute_mark:
            return False
        return PipelineService._cron_matches(minute_mark, cron)

    @staticmethod
    def _cron_matches(dt: datetime, expression: str) -> bool:
        minute, hour, day, month, weekday = expression.split()
        return (
            PipelineService._cron_field_matches(dt.minute, minute, 0, 59)
            and PipelineService._cron_field_matches(dt.hour, hour, 0, 23)
            and PipelineService._cron_field_matches(dt.day, day, 1, 31)
            and PipelineService._cron_field_matches(dt.month, month, 1, 12)
            and PipelineService._cron_field_matches((dt.weekday() + 1) % 7, weekday, 0, 6)
        )

    @staticmethod
    def _cron_field_matches(value: int, token: str, min_value: int, max_value: int) -> bool:
        token = str(token or '').strip()
        if token == '*':
            return True
        for part in token.split(','):
            part = part.strip()
            if '/' in part:
                base, step_text = part.split('/', 1)
                step = int(step_text)
                if step <= 0:
                    return False
                if base == '*':
                    if (value - min_value) % step == 0:
                        return True
                    continue
                if '-' in base:
                    start_text, end_text = base.split('-', 1)
                    start = int(start_text)
                    end = int(end_text)
                    if start <= value <= end and (value - start) % step == 0:
                        return True
                    continue
            if '-' in part:
                start_text, end_text = part.split('-', 1)
                if int(start_text) <= value <= int(end_text):
                    return True
                continue
            if part.isdigit() and int(part) == value:
                return True
        return False

    # ── Misc helpers ──────────────────────────────────────────────────────

    async def _load_credential(self, credential_id: UUID | str | None) -> AppCredential | None:
        if credential_id in (None, ''):
            return None
        return await self.db.get(AppCredential, UUID(str(credential_id)))

    # ── Field selection helpers ───────────────────────────────────────────

    @staticmethod
    def _filter_record_fields(record: Any, selected_fields: list[str]) -> dict[str, Any]:
        """Keep only the keys listed in selected_fields (top-level or dotted path).

        Mirrors AirByte's Fields drawer toggle behavior: a field path like
        ``account_export.hid`` keeps that nested value alone; ``account_export``
        alone keeps the entire nested object. When nested paths and their
        parent both appear, the parent wins (broader selection takes precedence).
        """
        if not isinstance(record, Mapping):
            return {}
        if not selected_fields:
            return dict(record)

        # Group selectors by top-level key; ``None`` value means "keep entire
        # top-level value", otherwise list of nested sub-paths to keep.
        roots: dict[str, list[str] | None] = {}
        for path in selected_fields:
            text = str(path or '').strip()
            if not text:
                continue
            head, _, rest = text.partition('.')
            if rest == '':
                roots[head] = None  # whole key wins over any sub-path
            else:
                existing = roots.get(head, [])
                if existing is None:
                    continue  # parent already selected in full
                existing.append(rest)
                roots[head] = existing

        result: dict[str, Any] = {}
        for head, sub_paths in roots.items():
            if head not in record:
                continue
            value = record[head]
            if sub_paths is None:
                result[head] = value
            elif isinstance(value, Mapping):
                result[head] = PipelineService._filter_record_fields(dict(value), sub_paths)
            else:
                # Sub-path requested but value isn't a mapping — drop it.
                continue
        return result

    # ── Incremental cursor state ──────────────────────────────────────────

    async def _read_cursor_state(
        self,
        *,
        pipeline_id: UUID,
        binding_index: int,
    ) -> dict[str, Any] | None:
        """Return ``{cursor_field: cursor_value}`` from the last successful run, or None."""
        from packages.database.src.models import PipelineCursorState
        result = await self.db.execute(
            select(PipelineCursorState).where(
                and_(
                    PipelineCursorState.pipeline_id == pipeline_id,
                    PipelineCursorState.binding_index == binding_index,
                )
            )
        )
        row = result.scalar_one_or_none()
        if row is None or not row.cursor_value:
            return None
        return {row.cursor_field: row.cursor_value}

    async def _write_cursor_state(
        self,
        *,
        pipeline_id: UUID,
        binding_index: int,
        cursor_field: str,
        cursor_value: Any,
    ) -> None:
        """Upsert the cursor checkpoint for one binding."""
        from packages.database.src.models import PipelineCursorState
        existing = await self.db.execute(
            select(PipelineCursorState).where(
                and_(
                    PipelineCursorState.pipeline_id == pipeline_id,
                    PipelineCursorState.binding_index == binding_index,
                )
            )
        )
        row = existing.scalar_one_or_none()
        if row is None:
            self.db.add(PipelineCursorState(
                pipeline_id=pipeline_id,
                binding_index=binding_index,
                cursor_field=cursor_field,
                cursor_value=str(cursor_value),
            ))
        else:
            row.cursor_field = cursor_field
            row.cursor_value = str(cursor_value)
            row.updated_at = datetime.now(timezone.utc)
        await self.db.commit()

    @staticmethod
    def _extract_max_cursor_value(
        records: list[dict[str, Any]],
        cursor_field: str,
    ) -> Any | None:
        """Pick the largest value of ``cursor_field`` across a batch of records.

        Used to advance the per-binding cursor after a successful sync. Strings
        are compared lexicographically (correct for ISO-8601 dates and zero-
        padded numeric strings); numbers are compared numerically.
        """
        best: Any = None
        for record in records:
            if not isinstance(record, Mapping):
                continue
            value = record.get(cursor_field)
            if value in (None, ''):
                continue
            if best is None:
                best = value
                continue
            try:
                if value > best:
                    best = value
            except TypeError:
                # Mixed-type comparison — fall back to string.
                if str(value) > str(best):
                    best = value
        return best

    @staticmethod
    def _apply_field_mapping(records: list[dict[str, Any]], field_mapping: Mapping[str, Any]) -> list[dict[str, Any]]:
        mapping = {
            str(dest_key): str(source_key)
            for dest_key, source_key in dict(field_mapping or {}).items()
            if str(dest_key).strip() and str(source_key).strip()
        }
        if not mapping:
            return records
        mapped_records = []
        for record in records:
            mapped_records.append({dest_key: record.get(source_key) for dest_key, source_key in mapping.items()})
        return mapped_records

    @staticmethod
    def _extract_written_count(result: Mapping[str, Any], *, fallback: int = 0) -> int:
        for key in ('written', 'inserted', 'merged', 'created', 'uploaded'):
            value = result.get(key)
            if value is not None:
                try:
                    return int(value)
                except (TypeError, ValueError):
                    continue
        return fallback

    @staticmethod
    def _append_log(logs: str | None, line: str) -> str:
        timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        entry = f"{timestamp} {line}"
        return f"{logs}\n{entry}" if logs else entry

    @staticmethod
    def _snapshot_run_config(pipeline: DataPipeline) -> dict[str, Any]:
        return {
            'source_connector_key': pipeline.source_connector_key,
            'source_credential_id': str(pipeline.source_credential_id) if pipeline.source_credential_id else None,
            'dest_connector_key': pipeline.dest_connector_key,
            'dest_credential_id': str(pipeline.dest_credential_id) if pipeline.dest_credential_id else None,
            'bindings': list(pipeline.bindings or []),
            'schedule': dict(pipeline.schedule or {}),
        }

    @staticmethod
    def _model_to_validation_payload(pipeline: DataPipeline) -> dict[str, Any]:
        return {
            'name': pipeline.name,
            'description': pipeline.description,
            'status': pipeline.status,
            'source_connector_key': pipeline.source_connector_key,
            'source_credential_id': pipeline.source_credential_id,
            'dest_connector_key': pipeline.dest_connector_key,
            'dest_credential_id': pipeline.dest_credential_id,
            'bindings': list(pipeline.bindings or []),
            'schedule': dict(pipeline.schedule or {}),
        }

    @staticmethod
    def _pipeline_to_dict(
        p: DataPipeline,
        *,
        owner_email: str | None = None,
        user_permission: str | None = None,
    ) -> dict[str, Any]:
        return {
            'id': str(p.id),
            'name': p.name,
            'description': p.description,
            'owner_id': str(p.owner_id) if p.owner_id else None,
            'owner_email': owner_email,
            'user_permission': user_permission,
            'status': p.status,
            'source_connector_key': p.source_connector_key,
            'source_credential_id': str(p.source_credential_id) if p.source_credential_id else None,
            'dest_connector_key': p.dest_connector_key,
            'dest_credential_id': str(p.dest_credential_id) if p.dest_credential_id else None,
            'bindings': list(p.bindings or []),
            'schedule': p.schedule,
            'last_run_at': p.last_run_at.isoformat() if p.last_run_at else None,
            'last_run_status': p.last_run_status,
            'created_at': p.created_at.isoformat() if p.created_at else None,
            'updated_at': p.updated_at.isoformat() if p.updated_at else None,
        }

    @staticmethod
    def _run_to_dict(
        r: PipelineRun,
        *,
        pipeline_id: str | None = None,
        user_permission: str | None = None,
    ) -> dict[str, Any]:
        return {
            'id': str(r.id),
            'pipeline_id': pipeline_id or str(r.pipeline_id),
            'user_permission': user_permission,
            'status': r.status,
            'started_at': r.started_at.isoformat() if r.started_at else None,
            'completed_at': r.completed_at.isoformat() if r.completed_at else None,
            'records_read': r.records_read,
            'records_written': r.records_written,
            'error_count': r.error_count,
            'run_config': r.run_config,
            'logs': r.logs,
            'error_message': r.error_message,
            'triggered_by': r.triggered_by,
            'created_at': r.created_at.isoformat() if r.created_at else None,
        }
