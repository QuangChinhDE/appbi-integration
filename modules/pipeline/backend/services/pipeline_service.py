"""
Pipeline CRUD service — create, read, update, delete data pipelines and runs.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from packages.database.src.models import DataPipeline, PipelineRun, PipelineStatus


class PipelineService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── List ──────────────────────────────────────────────────────────────

    async def list_pipelines(
        self,
        *,
        owner_id: UUID | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        stmt = select(DataPipeline).order_by(desc(DataPipeline.updated_at))
        if owner_id:
            stmt = stmt.where(DataPipeline.owner_id == owner_id)
        if status:
            stmt = stmt.where(DataPipeline.status == status)

        result = await self.db.execute(stmt)
        return [self._pipeline_to_dict(p) for p in result.scalars().all()]

    # ── Get ───────────────────────────────────────────────────────────────

    async def get_pipeline(self, pipeline_id: UUID) -> dict[str, Any] | None:
        pipeline = await self.db.get(DataPipeline, pipeline_id)
        if pipeline is None:
            return None
        return self._pipeline_to_dict(pipeline)

    # ── Create ────────────────────────────────────────────────────────────

    async def create_pipeline(self, data: dict[str, Any], owner_id: UUID | None = None) -> dict[str, Any]:
        pipeline = DataPipeline(
            name=data['name'],
            description=data.get('description'),
            owner_id=owner_id,
            status=data.get('status', PipelineStatus.DRAFT),
            source_connector_key=data['source_connector_key'],
            source_credential_id=data.get('source_credential_id'),
            source_streams=data.get('source_streams', []),
            source_config=data.get('source_config'),
            dest_connector_key=data['dest_connector_key'],
            dest_credential_id=data.get('dest_credential_id'),
            dest_stream_key=data['dest_stream_key'],
            dest_config=data.get('dest_config'),
            write_mode=data.get('write_mode', 'append'),
            field_mapping=data.get('field_mapping'),
            schedule=data.get('schedule'),
        )
        self.db.add(pipeline)
        await self.db.flush()
        await self.db.refresh(pipeline)
        return self._pipeline_to_dict(pipeline)

    # ── Update ────────────────────────────────────────────────────────────

    async def update_pipeline(self, pipeline_id: UUID, data: dict[str, Any]) -> dict[str, Any] | None:
        pipeline = await self.db.get(DataPipeline, pipeline_id)
        if pipeline is None:
            return None

        allowed_fields = (
            'name', 'description', 'status',
            'source_connector_key', 'source_credential_id', 'source_streams', 'source_config',
            'dest_connector_key', 'dest_credential_id', 'dest_stream_key', 'dest_config',
            'write_mode', 'field_mapping', 'schedule',
        )
        for key in allowed_fields:
            if key in data:
                setattr(pipeline, key, data[key])

        await self.db.flush()
        await self.db.refresh(pipeline)
        return self._pipeline_to_dict(pipeline)

    # ── Delete ────────────────────────────────────────────────────────────

    async def delete_pipeline(self, pipeline_id: UUID) -> bool:
        pipeline = await self.db.get(DataPipeline, pipeline_id)
        if pipeline is None:
            return False
        await self.db.delete(pipeline)
        await self.db.flush()
        return True

    # ── Runs ──────────────────────────────────────────────────────────────

    async def list_runs(self, pipeline_id: UUID, *, limit: int = 50) -> list[dict[str, Any]]:
        stmt = (
            select(PipelineRun)
            .where(PipelineRun.pipeline_id == pipeline_id)
            .order_by(desc(PipelineRun.started_at))
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        return [self._run_to_dict(r) for r in result.scalars().all()]

    async def get_run(self, run_id: UUID) -> dict[str, Any] | None:
        run = await self.db.get(PipelineRun, run_id)
        if run is None:
            return None
        return self._run_to_dict(run)

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _pipeline_to_dict(p: DataPipeline) -> dict[str, Any]:
        return {
            'id': str(p.id),
            'name': p.name,
            'description': p.description,
            'owner_id': str(p.owner_id) if p.owner_id else None,
            'status': p.status,
            'source_connector_key': p.source_connector_key,
            'source_credential_id': str(p.source_credential_id) if p.source_credential_id else None,
            'source_streams': p.source_streams or [],
            'source_config': p.source_config,
            'dest_connector_key': p.dest_connector_key,
            'dest_credential_id': str(p.dest_credential_id) if p.dest_credential_id else None,
            'dest_stream_key': p.dest_stream_key,
            'dest_config': p.dest_config,
            'write_mode': p.write_mode,
            'field_mapping': p.field_mapping,
            'schedule': p.schedule,
            'last_run_at': p.last_run_at.isoformat() if p.last_run_at else None,
            'last_run_status': p.last_run_status,
            'created_at': p.created_at.isoformat() if p.created_at else None,
            'updated_at': p.updated_at.isoformat() if p.updated_at else None,
        }

    @staticmethod
    def _run_to_dict(r: PipelineRun) -> dict[str, Any]:
        return {
            'id': str(r.id),
            'pipeline_id': str(r.pipeline_id),
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
