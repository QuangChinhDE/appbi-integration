import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Dict, List, Optional
import json
import bcrypt
import hashlib
import base64
import os
from datetime import datetime, timezone
from cryptography.fernet import Fernet

from modules.backup.shared.types import (
    BackupDashboardResponse,
    BackupDashboardRunResponse,
    BackupFlowCreate, 
    BackupFlowDraftCreate,
    BackupFlowSave,
    BackupFlowAutosave,
    BackupFlowUpdate, 
    BackupFlowResponse,
    BackupFlowListResponse,
    BackupFlowRunResponse,
)
from modules.credentials.backend.services.google_auth_service import validate_service_account_drive_destination
from packages.database.src.models import BackupFlow, BackupFlowRun


BACKUP_RUN_TASKS: Dict[str, asyncio.Task] = {}

class BackupFlowService:
    """Service for managing backup flows"""

    INTERRUPTED_RUN_MESSAGE = "Interrupted because the API process restarted while the backup was still running. Start the flow again to resume with a fresh run."
    MANUALLY_STOPPED_RUN_MESSAGE = "Interrupted because the backup was manually stopped. Start the flow again to resume with a fresh run."
    
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _mark_runs_interrupted(
        self,
        active_runs: List[BackupFlowRun],
        message: Optional[str] = None,
    ) -> int:
        if not active_runs:
            return 0

        interrupt_message = message or self.INTERRUPTED_RUN_MESSAGE
        interrupted_at = datetime.now(timezone.utc)
        affected_flow_ids = {run.flow_id for run in active_runs}

        for run in active_runs:
            run.status = 'failed'
            run.completed_at = interrupted_at
            run.error_message = run.error_message or interrupt_message
            if run.logs:
                run.logs = (
                    f"{run.logs}\n[INTERRUPTED] {interrupted_at.strftime('%Y-%m-%d %H:%M:%S')} - {interrupt_message}"
                )
            else:
                run.logs = f"[INTERRUPTED] {interrupted_at.strftime('%Y-%m-%d %H:%M:%S')} - {interrupt_message}"

        flow_result = await self.db.execute(
            select(BackupFlow).where(BackupFlow.id.in_(tuple(affected_flow_ids)))
        )
        flow_map = {flow.id: flow for flow in flow_result.scalars().all()}

        latest_run_result = await self.db.execute(
            select(BackupFlowRun)
            .where(BackupFlowRun.flow_id.in_(tuple(affected_flow_ids)))
            .order_by(BackupFlowRun.started_at.desc())
        )
        latest_runs_by_flow = {}
        for run in latest_run_result.scalars().all():
            latest_runs_by_flow.setdefault(run.flow_id, run)

        for flow_id, latest_run in latest_runs_by_flow.items():
            flow = flow_map.get(flow_id)
            if not flow:
                continue
            flow.last_run_at = latest_run.started_at
            flow.last_run_status = latest_run.status
            flow.last_run_message = latest_run.error_message or latest_run.status

        await self.db.commit()
        return len(active_runs)

    async def interrupt_incomplete_runs(self, message: Optional[str] = None) -> int:
        """Mark pending/running runs as failed with the provided interruption message."""
        result = await self.db.execute(
            select(BackupFlowRun).where(BackupFlowRun.status.in_(("pending", "running")))
        )
        active_runs = result.scalars().all()
        return await self._mark_runs_interrupted(active_runs, message)

    async def interrupt_all_running_tasks(self) -> dict:
        cancelled_task_count = 0
        for run_id, task in list(BACKUP_RUN_TASKS.items()):
            if task.done():
                BACKUP_RUN_TASKS.pop(run_id, None)
                continue
            task.cancel()
            cancelled_task_count += 1

        interrupted_run_count = await self.interrupt_incomplete_runs(self.MANUALLY_STOPPED_RUN_MESSAGE)
        return {
            'cancelled_task_count': cancelled_task_count,
            'interrupted_run_count': interrupted_run_count,
        }

    async def interrupt_flow_running_tasks(self, flow_id: str) -> dict:
        result = await self.db.execute(
            select(BackupFlowRun)
            .where(
                and_(
                    BackupFlowRun.flow_id == flow_id,
                    BackupFlowRun.status.in_(("pending", "running")),
                )
            )
            .order_by(BackupFlowRun.started_at.desc())
        )
        active_runs = result.scalars().all()

        cancelled_task_count = 0
        for run in active_runs:
            run_id = str(run.id)
            task = BACKUP_RUN_TASKS.get(run_id)
            if task is None:
                continue
            if task.done():
                BACKUP_RUN_TASKS.pop(run_id, None)
                continue
            task.cancel()
            cancelled_task_count += 1

        interrupted_run_count = await self._mark_runs_interrupted(
            active_runs,
            self.MANUALLY_STOPPED_RUN_MESSAGE,
        )
        return {
            'cancelled_task_count': cancelled_task_count,
            'interrupted_run_count': interrupted_run_count,
        }

    # ── token helpers ──────────────────────────────────────────────────────
    @staticmethod
    def _get_fernet() -> Fernet:
        secret = os.getenv("SECRET_KEY", "change-this-secret-key-in-production-2026")
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
        return Fernet(key)

    @staticmethod
    def hash_token(token: str) -> str:
        """One-way bcrypt hash (for audit/display only)."""
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(token.encode('utf-8'), salt).decode('utf-8')

    @staticmethod
    def encrypt_token(token: str) -> str:
        """Reversible Fernet encryption (used by the runner to call APIs)."""
        f = BackupFlowService._get_fernet()
        return f.encrypt(token.encode()).decode()

    @staticmethod
    def decrypt_token(encrypted: str) -> str:
        """Decrypt a token previously encrypted by encrypt_token."""
        f = BackupFlowService._get_fernet()
        return f.decrypt(encrypted.encode()).decode()

    @staticmethod
    def get_run_blocked_reason(flow: BackupFlow) -> Optional[str]:
        destination = flow.destination or {}
        if destination.get('type') not in {'gdrive', 'gsheets'}:
            return None

        try:
            validate_service_account_drive_destination(dict(destination.get('auth') or {}))
        except ValueError as exc:
            return str(exc)
        return None

    @staticmethod
    def _latest_log_line(logs: Optional[str]) -> Optional[str]:
        if not logs:
            return None

        for line in reversed(logs.splitlines()):
            cleaned = line.strip()
            if cleaned:
                return cleaned
        return None

    @classmethod
    def _build_dashboard_run_response(
        cls,
        run: BackupFlowRun,
        flow: Optional[BackupFlow],
    ) -> BackupDashboardRunResponse:
        source = (flow.source or {}) if flow else {}
        return BackupDashboardRunResponse(
            run_id=run.id,
            flow_id=run.flow_id,
            flow_name=flow.name if flow else None,
            app=source.get('app'),
            app_name=source.get('app_name'),
            status=run.status,
            started_at=run.started_at,
            completed_at=run.completed_at,
            execution_details=run.execution_details,
            error_message=run.error_message,
            triggered_by=run.triggered_by,
            latest_log_line=cls._latest_log_line(run.logs),
        )

    @classmethod
    def prepare_destination(cls, destination: dict) -> dict:
        dest_dict = dict(destination or {})
        auth = dict(dest_dict.get('auth') or {})

        raw_mode = str(auth.get('auth_mode') or auth.get('auth_method') or '').strip().lower()
        if raw_mode == 'oauth':
            raw_mode = 'google_oauth'

        if auth.get('google_oauth_connection_id') and not auth.get('connection_id'):
            auth['connection_id'] = auth.get('google_oauth_connection_id')
        if auth.get('google_oauth_email') and not auth.get('email'):
            auth['email'] = auth.get('google_oauth_email')

        if 'refresh_token' in auth and auth['refresh_token']:
            refresh_token = auth.pop('refresh_token')
            auth['refresh_token_hash'] = cls.hash_token(refresh_token)

        raw_service_account = auth.pop('credentials_json', None)
        if not raw_service_account:
            raw_service_account = auth.pop('service_account_json', None)

        if raw_service_account:
            if isinstance(raw_service_account, str):
                service_account_text = raw_service_account
            else:
                service_account_text = json.dumps(raw_service_account)
            auth['service_account_json_encrypted'] = cls.encrypt_token(service_account_text)

        if auth.get('service_account_json_encrypted') or raw_mode == 'service_account':
            auth['auth_mode'] = 'service_account'
            auth['auth_method'] = 'service_account'
            auth['uses_platform_service_account'] = not bool(auth.get('service_account_json_encrypted'))
        else:
            auth['auth_mode'] = 'google_oauth'
            auth['auth_method'] = 'oauth'
            auth.pop('uses_platform_service_account', None)

        dest_dict['auth'] = auth
        return dest_dict

    @classmethod
    def build_flow_response(cls, flow: BackupFlow, include_source_token: bool = False) -> BackupFlowResponse:
        response = BackupFlowResponse.model_validate(flow)
        source = dict(response.source or {})
        encrypted_token = source.pop('access_token_encrypted', None)
        source.pop('access_token_hash', None)

        if include_source_token and encrypted_token:
            try:
                source['access_token'] = cls.decrypt_token(encrypted_token)
            except Exception:
                source['access_token'] = ''

        response.source = source or None
        return response
    
    @staticmethod
    def generate_flow_name(
        app_name: str, 
        backup_type: str, 
        destination_type: str
    ) -> str:
        """
        Generate a unique flow name based on app, destination, type, and timestamp
        Format: {AppName}_{BackupType}_{Destination}_{YYYYMMDDHHMMSS}
        Example: Request_Complete_GDrive_20260412150230
        """
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        
        # Map backup types to short names
        type_map = {
            'structured': 'Structured',
            'unstructured': 'Unstructured',
            'all': 'Complete'
        }
        
        # Map destination types to short names
        dest_map = {
            'gdrive': 'GDrive',
            'gsheets': 'GSheets'
        }
        
        type_short = type_map.get(backup_type, backup_type)
        dest_short = dest_map.get(destination_type, destination_type)
        
        return f"{app_name}_{type_short}_{dest_short}_{timestamp}"
    
    async def create_draft(self, draft_data: BackupFlowDraftCreate) -> BackupFlowResponse:
        """Create an empty draft flow (is_draft=1, is_published=0, everything else null)"""
        new_flow = BackupFlow(
            is_draft=1,
            is_published=0,
            status='active',
            created_by=draft_data.created_by
        )
        self.db.add(new_flow)
        await self.db.commit()
        await self.db.refresh(new_flow)
        return self.build_flow_response(new_flow)

    async def save_flow(self, flow_id: str, save_data: BackupFlowSave) -> Optional[BackupFlowResponse]:
        """Fill in all details for a draft and publish it (is_draft=0, is_published=1)"""
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()

        if not flow:
            return None

        # Hash the access token (audit) and encrypt it (runner use)
        source_dict = save_data.source.model_dump()
        access_token = source_dict.pop('access_token')
        source_dict['access_token_hash'] = self.hash_token(access_token)
        source_dict['access_token_encrypted'] = self.encrypt_token(access_token)

        # Prepare destination (hash refresh token if exists)
        dest_dict = self.prepare_destination(save_data.destination.model_dump())

        # Generate flow name now that we have all info
        flow_name = self.generate_flow_name(
            app_name=source_dict['app_name'],
            backup_type=save_data.backup_type,
            destination_type=save_data.destination.type
        )

        flow.name = save_data.name if save_data.name and save_data.name.strip() else flow_name
        flow.source = source_dict
        flow.backup_type = save_data.backup_type
        flow.destination = dest_dict
        flow.structure = save_data.structure.model_dump() if save_data.structure else None
        flow.schedule = save_data.schedule.model_dump() if save_data.schedule else None
        flow.is_draft = 0
        flow.is_published = 1
        flow.updated_by = save_data.updated_by

        await self.db.commit()
        await self.db.refresh(flow)
        return self.build_flow_response(flow)

    async def autosave_flow(self, flow_id: str, data: BackupFlowAutosave) -> bool:
        """Partially update a draft at each wizard step. Only updates provided fields."""
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()
        if not flow:
            return False

        if data.name is not None:
            flow.name = data.name.strip() or flow.name

        if data.source is not None:
            src = dict(data.source)
            # encrypt access_token if present
            if 'access_token' in src and src['access_token']:
                token = src.pop('access_token')
                src['access_token_hash'] = self.hash_token(token)
                src['access_token_encrypted'] = self.encrypt_token(token)
            flow.source = src

        if data.backup_type is not None:
            flow.backup_type = data.backup_type

        if data.destination is not None:
            flow.destination = self.prepare_destination(data.destination)

        if data.structure is not None:
            flow.structure = data.structure

        await self.db.commit()
        return True

    async def create_flow(self, flow_data: BackupFlowCreate) -> BackupFlowResponse:
        """Create a new backup flow"""
        
        # Hash the access token (audit) and encrypt it (runner use)
        source_dict = flow_data.source.model_dump()
        access_token = source_dict.pop('access_token')
        source_dict['access_token_hash'] = self.hash_token(access_token)
        source_dict['access_token_encrypted'] = self.encrypt_token(access_token)
        
        # Generate flow name
        flow_name = self.generate_flow_name(
            app_name=source_dict['app_name'],
            backup_type=flow_data.backup_type,
            destination_type=flow_data.destination.type
        )
        
        # Prepare destination (hash refresh token if exists)
        dest_dict = self.prepare_destination(flow_data.destination.model_dump())
        
        # Create the flow
        new_flow = BackupFlow(
            name=flow_name,
            source=source_dict,
            backup_type=flow_data.backup_type,
            destination=dest_dict,
            structure=flow_data.structure.model_dump() if flow_data.structure else None,
            schedule=flow_data.schedule.model_dump() if flow_data.schedule else None,
            created_by=flow_data.created_by,
            status='active'
        )
        
        self.db.add(new_flow)
        await self.db.commit()
        await self.db.refresh(new_flow)
        
        return self.build_flow_response(new_flow)
    
    async def list_flows(
        self, 
        status: Optional[str] = None,
        app: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[BackupFlowListResponse]:
        """List backup flows with optional filtering"""
        
        query = select(BackupFlow)
        
        # Apply filters
        conditions = []
        if status:
            conditions.append(BackupFlow.status == status)
        if app:
            conditions.append(BackupFlow.source['app'].astext == app)
        
        if conditions:
            query = query.where(and_(*conditions))
        
        # Order by created_at descending
        query = query.order_by(BackupFlow.created_at.desc())
        
        # Pagination
        query = query.offset(skip).limit(limit)
        
        result = await self.db.execute(query)
        flows = result.scalars().all()
        
        # Transform to list response format
        response = []
        for flow in flows:
            source = flow.source or {}
            destination = flow.destination or {}
            response.append(BackupFlowListResponse(
                id=flow.id,
                name=flow.name,
                is_draft=flow.is_draft,
                is_published=flow.is_published,
                app=source.get('app'),
                app_name=source.get('app_name'),
                backup_type=flow.backup_type,
                destination_type=destination.get('type'),
                destination_name=destination.get('name'),
                status=flow.status,
                last_run_at=flow.last_run_at,
                last_run_status=flow.last_run_status,
                run_blocked_reason=self.get_run_blocked_reason(flow),
                created_at=flow.created_at
            ))
        
        return response
    
    async def get_flow(self, flow_id: str) -> Optional[BackupFlowResponse]:
        """Get a specific backup flow by ID"""
        
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()
        
        if not flow:
            return None
        
        return self.build_flow_response(flow, include_source_token=True)
    
    async def update_flow(
        self, 
        flow_id: str, 
        flow_update: BackupFlowUpdate
    ) -> Optional[BackupFlowResponse]:
        """Update a backup flow"""
        
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()
        
        if not flow:
            return None
        
        # Update fields if provided
        if flow_update.source:
            source_dict = flow_update.source.model_dump()
            if 'access_token' in source_dict:
                access_token = source_dict.pop('access_token')
                source_dict['access_token_hash'] = self.hash_token(access_token)
            flow.source = source_dict
        
        if flow_update.backup_type:
            flow.backup_type = flow_update.backup_type
        
        if flow_update.destination:
            dest_dict = self.prepare_destination(flow_update.destination.model_dump())
            flow.destination = dest_dict
        
        if flow_update.structure:
            flow.structure = flow_update.structure.model_dump()
        
        if flow_update.schedule:
            flow.schedule = flow_update.schedule.model_dump()
        
        if flow_update.status:
            flow.status = flow_update.status
        
        flow.updated_by = flow_update.updated_by
        
        await self.db.commit()
        await self.db.refresh(flow)
        
        return self.build_flow_response(flow)
    
    async def delete_flow(self, flow_id: str) -> bool:
        """Delete a backup flow"""
        
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()
        
        if not flow:
            return False
        
        await self.db.delete(flow)
        await self.db.commit()
        
        return True

    async def publish_flow(self, flow_id: str) -> Optional[BackupFlowResponse]:
        """Publish a flow: set is_draft=0, is_published=1"""
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()

        if not flow:
            return None

        flow.is_draft = 0
        flow.is_published = 1

        await self.db.commit()
        await self.db.refresh(flow)
        return self.build_flow_response(flow)
    
    async def trigger_flow_run(
        self, 
        flow_id: str, 
        triggered_by: str
    ) -> Optional[BackupFlowRun]:
        """Create a run record and schedule the actual backup as a background task."""
        
        # Check if flow exists
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()
        
        if not flow:
            return None

        destination = flow.destination or {}
        if destination.get('type') in {'gdrive', 'gsheets'}:
            validate_service_account_drive_destination(dict(destination.get('auth') or {}))
        
        # Launch backup asynchronously (non-blocking)
        source = flow.source or {}
        app = source.get('app', '')
        runner = None
        if app == 'request':
            from modules.connectors.apps.request.backup.extractor import run_request_backup
            runner = run_request_backup
        elif app == 'service':
            from modules.connectors.apps.service.backup.extractor import run_service_backup
            runner = run_service_backup
        elif app == 'wework':
            from modules.connectors.apps.wework.backup.extractor import run_wework_backup
            runner = run_wework_backup
        elif app == 'workflow':
            from modules.connectors.apps.workflow.backup.extractor import run_workflow_backup
            runner = run_workflow_backup
        else:
            raise ValueError(f"Unsupported backup app: {app}")

        # Create a new run record
        new_run = BackupFlowRun(
            flow_id=flow_id,
            status='pending',
            triggered_by=triggered_by
        )

        self.db.add(new_run)
        await self.db.commit()
        await self.db.refresh(new_run)

        flow.last_run_at = new_run.started_at
        flow.last_run_status = 'running'
        flow.last_run_message = 'Backup is starting'
        await self.db.commit()

        task = None
        task = asyncio.create_task(
            runner(str(flow.id), str(new_run.id))
        )
        run_id_key = str(new_run.id)
        BACKUP_RUN_TASKS[run_id_key] = task
        task.add_done_callback(lambda _: BACKUP_RUN_TASKS.pop(run_id_key, None))
        
        return new_run
    
    async def get_flow_runs(
        self, 
        flow_id: str, 
        limit: int = 10
    ) -> List[BackupFlowRunResponse]:
        """Get execution history for a backup flow"""
        
        query = select(BackupFlowRun).where(
            BackupFlowRun.flow_id == flow_id
        ).order_by(
            BackupFlowRun.started_at.desc()
        ).limit(limit)
        
        result = await self.db.execute(query)
        runs = result.scalars().all()
        
        return [BackupFlowRunResponse.model_validate(run) for run in runs]

    async def get_dashboard_data(
        self,
        recent_limit: int = 8,
        active_limit: int = 5,
    ) -> BackupDashboardResponse:
        flow_result = await self.db.execute(select(BackupFlow).order_by(BackupFlow.created_at.desc()))
        flows = flow_result.scalars().all()
        published_flows = [flow for flow in flows if flow.is_draft == 0]
        flow_map = {str(flow.id): flow for flow in flows}

        active_result = await self.db.execute(
            select(BackupFlowRun)
            .where(BackupFlowRun.status.in_(("pending", "running")))
            .order_by(BackupFlowRun.started_at.desc())
            .limit(active_limit)
        )
        active_runs = active_result.scalars().all()

        recent_result = await self.db.execute(
            select(BackupFlowRun)
            .order_by(BackupFlowRun.started_at.desc())
            .limit(recent_limit)
        )
        recent_runs = recent_result.scalars().all()

        configured_apps = len({
            (flow.source or {}).get('app')
            for flow in published_flows
            if (flow.source or {}).get('app')
        })

        active_flow_ids = {str(run.flow_id) for run in active_runs}

        return BackupDashboardResponse(
            configured_apps=configured_apps,
            completed_flows=len([
                flow for flow in published_flows
                if flow.last_run_status == 'completed' and str(flow.id) not in active_flow_ids
            ]),
            pending_flows=len([flow for flow in published_flows if not flow.last_run_at]),
            running_flows=len(active_flow_ids),
            active_runs=[
                self._build_dashboard_run_response(run, flow_map.get(str(run.flow_id)))
                for run in active_runs
            ],
            recent_runs=[
                self._build_dashboard_run_response(run, flow_map.get(str(run.flow_id)))
                for run in recent_runs
            ],
        )
