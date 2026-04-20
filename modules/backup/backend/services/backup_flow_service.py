import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Dict, List, Optional
from datetime import datetime, timezone
from uuid import UUID

from modules.apps.backend.services.app_credential_service import AppCredentialService
from modules.connectors.backend.shared.validation import ConnectorBindingValidationService
from modules.apps.shared.types import GOOGLE_STYLE_APPS, SOURCE_STYLE_APPS
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
    CredentialSummary,
)
from modules.credentials.backend.services.google_auth_service import validate_service_account_drive_destination
from packages.auth.src.resource_permissions import (
    apply_resource_scope,
    batch_effective_permissions,
    fetch_owner_email_lookup,
    get_effective_permission,
    require_credential_access,
)
from packages.database.src.models import AppCredential, BackupFlow, BackupFlowRun, ResourceType, User


BACKUP_RUN_TASKS: Dict[str, asyncio.Task] = {}


class BackupFlowService:
    """Service for managing backup flows.

    A BackupFlow holds references (by id) to two AppCredential rows: one
    used as the source and one used as the destination for this flow.
    Credentials themselves are owned by the Apps module; this service only
    records which credential plays which role and any per-flow overrides.
    """

    INTERRUPTED_RUN_MESSAGE = "Interrupted because the API process restarted while the backup was still running. Start the flow again to resume with a fresh run."
    MANUALLY_STOPPED_RUN_MESSAGE = "Interrupted because the backup was manually stopped. Start the flow again to resume with a fresh run."

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Run lifecycle ─────────────────────────────────────────────────────
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

    # ── Credential resolution ────────────────────────────────────────────
    async def _load_credential(self, credential_id: Optional[UUID]) -> Optional[AppCredential]:
        if credential_id is None:
            return None
        return await self.db.get(AppCredential, credential_id)

    async def _validate_role_assignment(
        self, source_credential_id: UUID, destination_credential_id: UUID,
        current_user: Optional[User] = None,
    ) -> tuple[AppCredential, AppCredential]:
        if current_user is not None:
            source = await require_credential_access(
                self.db, current_user, source_credential_id, min_level='view',
            )
        else:
            source = await self._load_credential(source_credential_id)
        ConnectorBindingValidationService.validate_source_credential(
            source,
            module_key='backup',
        )
        if current_user is not None:
            destination = await require_credential_access(
                self.db, current_user, destination_credential_id, min_level='view',
            )
        else:
            destination = await self._load_credential(destination_credential_id)
        ConnectorBindingValidationService.validate_destination_credential(
            destination,
            module_key='backup',
            pipeline_destination_only=False,
        )
        return source, destination

    @staticmethod
    def _credential_summary(
        credential: Optional[AppCredential],
        *,
        owner_email: Optional[str] = None,
        user_permission: Optional[str] = None,
    ) -> Optional[CredentialSummary]:
        if not credential:
            return None
        # Derive preview inline to avoid importing the service just for this.
        auth = dict(credential.auth or {})
        config = dict(credential.config or {})
        if credential.app_id in SOURCE_STYLE_APPS:
            preview = {"domain": config.get("domain")}
        else:
            preview = {
                "email": auth.get("email"),
                "display_name": auth.get("display_name"),
                "folder_name": config.get("folder_name"),
                "drive_name": config.get("drive_name"),
                "uses_platform_service_account": bool(config.get("uses_platform_service_account")),
            }
        preview = {k: v for k, v in preview.items() if v not in (None, "")}
        return CredentialSummary(
            id=credential.id,
            owner_email=owner_email,
            user_permission=user_permission,
            app_id=credential.app_id,
            app_name=credential.app_name,
            auth_mode=credential.auth_mode,
            name=credential.name,
            preview=preview,
        )

    @staticmethod
    def get_run_blocked_reason_from_destination(
        destination_credential: Optional[AppCredential],
        destination_target: Optional[dict] = None,
    ) -> Optional[str]:
        if not destination_credential:
            return None
        if destination_credential.app_id not in GOOGLE_STYLE_APPS:
            return None
        auth = dict(destination_credential.auth or {})
        config = dict(destination_credential.config or {})
        merged = {**auth}
        for key in ("folder_id", "drive_id", "uses_platform_service_account"):
            if key in config:
                merged.setdefault(key, config[key])
        if destination_target:
            for key in ("folder_id", "drive_id"):
                if key in destination_target:
                    merged[key] = destination_target[key]
        merged["auth_mode"] = destination_credential.auth_mode
        try:
            validate_service_account_drive_destination(merged)
        except ValueError as exc:
            return str(exc)
        return None

    # ── Response hydration ───────────────────────────────────────────────
    async def build_flow_response(self, flow: BackupFlow, current_user: User) -> BackupFlowResponse:
        source = await self._load_credential(flow.source_credential_id)
        destination = await self._load_credential(flow.destination_credential_id)
        credential_items = [item for item in (source, destination) if item is not None]
        credential_owner_lookup = await fetch_owner_email_lookup(
            self.db,
            (item.owner_id for item in credential_items),
        )
        credential_permission_lookup = await batch_effective_permissions(
            self.db,
            current_user,
            credential_items,
            module='apps',
            resource_type=ResourceType.APP_CREDENTIAL,
        )
        flow_owner_lookup = await fetch_owner_email_lookup(self.db, (flow.owner_id,))
        flow_permission = await get_effective_permission(
            self.db,
            current_user,
            flow,
            module='backup',
            resource_type=ResourceType.BACKUP_FLOW,
        )
        return BackupFlowResponse(
            id=flow.id,
            name=flow.name,
            owner_email=flow_owner_lookup.get(flow.owner_id),
            user_permission=flow_permission,
            is_draft=flow.is_draft,
            is_published=flow.is_published,
            source_credential_id=flow.source_credential_id,
            destination_credential_id=flow.destination_credential_id,
            source=self._credential_summary(
                source,
                owner_email=credential_owner_lookup.get(source.owner_id) if source else None,
                user_permission=credential_permission_lookup.get(str(source.id), 'none') if source else None,
            ),
            destination=self._credential_summary(
                destination,
                owner_email=credential_owner_lookup.get(destination.owner_id) if destination else None,
                user_permission=credential_permission_lookup.get(str(destination.id), 'none') if destination else None,
            ),
            destination_target=dict(flow.destination_target or {}) or None,
            backup_type=flow.backup_type,
            structure=dict(flow.structure or {}) or None,
            schedule=dict(flow.schedule or {}) or None,
            status=flow.status,
            last_run_at=flow.last_run_at,
            last_run_status=flow.last_run_status,
            last_run_message=flow.last_run_message,
            created_by=flow.created_by,
            updated_by=flow.updated_by,
            created_at=flow.created_at,
            updated_at=flow.updated_at,
        )

    @staticmethod
    def generate_flow_name(app_name: str, backup_type: str, destination_type: str) -> str:
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        type_map = {
            'structured': 'Structured',
            'unstructured': 'Unstructured',
            'all': 'Complete',
        }
        dest_map = {
            'gdrive': 'GDrive',
            'gsheets': 'GSheets',
        }
        type_short = type_map.get(backup_type, backup_type)
        dest_short = dest_map.get(destination_type, destination_type)
        return f"{app_name}_{type_short}_{dest_short}_{timestamp}"

    # ── Flow CRUD ─────────────────────────────────────────────────────────
    async def create_draft(self, draft_data: BackupFlowDraftCreate, current_user: User) -> BackupFlowResponse:
        source = None
        if draft_data.source is not None:
            source = await require_credential_access(
                self.db,
                current_user,
                draft_data.source.credential_id,
                min_level='view',
            )
            ConnectorBindingValidationService.validate_source_credential(
                source,
                module_key='backup',
            )

        new_flow = BackupFlow(
            owner_id=current_user.id,
            name=draft_data.name.strip() if draft_data.name and draft_data.name.strip() else None,
            source_credential_id=source.id if source else None,
            is_draft=1,
            is_published=0,
            status='active',
            created_by=draft_data.created_by or current_user.email,
        )
        self.db.add(new_flow)
        await self.db.commit()
        await self.db.refresh(new_flow)
        return await self.build_flow_response(new_flow, current_user)

    async def save_flow(self, flow_id: str, save_data: BackupFlowSave, current_user: User) -> Optional[BackupFlowResponse]:
        flow = await self.db.get(BackupFlow, flow_id)
        if not flow:
            return None

        source, destination = await self._validate_role_assignment(
            save_data.source.credential_id,
            save_data.destination.credential_id,
            current_user=current_user,
        )

        flow_name = self.generate_flow_name(
            app_name=source.app_name,
            backup_type=save_data.backup_type,
            destination_type=destination.app_id,
        )

        flow.name = save_data.name.strip() if save_data.name and save_data.name.strip() else flow_name
        flow.source_credential_id = source.id
        flow.destination_credential_id = destination.id
        flow.destination_target = dict(save_data.destination.target or {}) or None
        flow.backup_type = save_data.backup_type
        flow.structure = save_data.structure.model_dump() if save_data.structure else None
        flow.schedule = save_data.schedule.model_dump() if save_data.schedule else None
        flow.is_draft = 0
        flow.is_published = 1
        flow.updated_by = save_data.updated_by or current_user.email

        await self.db.commit()
        await self.db.refresh(flow)
        return await self.build_flow_response(flow, current_user)

    async def autosave_flow(self, flow_id: str, data: BackupFlowAutosave, current_user: Optional[User] = None) -> bool:
        flow = await self.db.get(BackupFlow, flow_id)
        if not flow:
            return False

        if data.name is not None:
            flow.name = data.name.strip() or flow.name

        if data.source is not None:
            if current_user is not None:
                source = await require_credential_access(
                    self.db, current_user, data.source.credential_id, min_level='view',
                )
            else:
                source = await self._load_credential(data.source.credential_id)
            ConnectorBindingValidationService.validate_source_credential(
                source,
                module_key='backup',
            )
            flow.source_credential_id = source.id

        if data.backup_type is not None:
            flow.backup_type = data.backup_type

        if data.destination is not None:
            if current_user is not None:
                destination = await require_credential_access(
                    self.db, current_user, data.destination.credential_id, min_level='view',
                )
            else:
                destination = await self._load_credential(data.destination.credential_id)
            ConnectorBindingValidationService.validate_destination_credential(
                destination,
                module_key='backup',
                pipeline_destination_only=False,
            )
            flow.destination_credential_id = destination.id
            flow.destination_target = dict(data.destination.target or {}) or None

        if data.structure is not None:
            flow.structure = data.structure

        await self.db.commit()
        return True

    async def create_flow(self, flow_data: BackupFlowCreate, current_user: User) -> BackupFlowResponse:
        source, destination = await self._validate_role_assignment(
            flow_data.source.credential_id,
            flow_data.destination.credential_id,
            current_user=current_user,
        )

        flow_name = self.generate_flow_name(
            app_name=source.app_name,
            backup_type=flow_data.backup_type,
            destination_type=destination.app_id,
        )

        new_flow = BackupFlow(
            name=flow_name,
            owner_id=current_user.id,
            source_credential_id=source.id,
            destination_credential_id=destination.id,
            destination_target=dict(flow_data.destination.target or {}) or None,
            backup_type=flow_data.backup_type,
            structure=flow_data.structure.model_dump() if flow_data.structure else None,
            schedule=flow_data.schedule.model_dump() if flow_data.schedule else None,
            created_by=flow_data.created_by or current_user.email,
            status='active',
        )

        self.db.add(new_flow)
        await self.db.commit()
        await self.db.refresh(new_flow)

        return await self.build_flow_response(new_flow, current_user)

    async def list_flows(
        self,
        current_user: User,
        status: Optional[str] = None,
        app: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[BackupFlowListResponse]:
        query = select(BackupFlow)
        query = apply_resource_scope(
            query,
            BackupFlow,
            ResourceType.BACKUP_FLOW,
            current_user,
            module='backup',
        )
        if status:
            query = query.where(BackupFlow.status == status)
        if app:
            # Filter by source app via a join.
            query = query.join(
                AppCredential, BackupFlow.source_credential_id == AppCredential.id
            ).where(AppCredential.app_id == app)
        query = query.order_by(BackupFlow.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        flows = result.scalars().all()

        # Batch-load credentials needed for labels.
        credential_ids = set()
        for flow in flows:
            if flow.source_credential_id:
                credential_ids.add(flow.source_credential_id)
            if flow.destination_credential_id:
                credential_ids.add(flow.destination_credential_id)
        credentials_map: Dict[UUID, AppCredential] = {}
        if credential_ids:
            cred_result = await self.db.execute(
                select(AppCredential).where(AppCredential.id.in_(tuple(credential_ids)))
            )
            credentials_map = {c.id: c for c in cred_result.scalars().all()}
        owner_lookup = await fetch_owner_email_lookup(self.db, (flow.owner_id for flow in flows))
        permission_lookup = await batch_effective_permissions(
            self.db,
            current_user,
            flows,
            module='backup',
            resource_type=ResourceType.BACKUP_FLOW,
        )

        response = []
        for flow in flows:
            source = credentials_map.get(flow.source_credential_id) if flow.source_credential_id else None
            destination = credentials_map.get(flow.destination_credential_id) if flow.destination_credential_id else None

            # Surface credential-level problems before any destination-specific
            # validation, so the wizard/dashboard can explain missing pieces.
            blocked_reason: Optional[str] = None
            if flow.is_draft == 0:
                if flow.source_credential_id and source is None:
                    blocked_reason = "The source credential used by this flow no longer exists in Apps. Edit the flow and pick a new source."
                elif flow.destination_credential_id and destination is None:
                    blocked_reason = "The destination credential used by this flow no longer exists in Apps. Edit the flow and pick a new destination."
                elif not flow.source_credential_id or not flow.destination_credential_id:
                    blocked_reason = "This flow is missing a source or destination credential assignment."
            if blocked_reason is None:
                blocked_reason = self.get_run_blocked_reason_from_destination(
                    destination, dict(flow.destination_target or {}),
                )

            response.append(BackupFlowListResponse(
                id=flow.id,
                name=flow.name,
                owner_email=owner_lookup.get(flow.owner_id),
                user_permission=permission_lookup.get(str(flow.id), 'none'),
                is_draft=flow.is_draft,
                is_published=flow.is_published,
                app=source.app_id if source else None,
                app_name=source.app_name if source else None,
                backup_type=flow.backup_type,
                destination_type=destination.app_id if destination else None,
                destination_name=destination.app_name if destination else None,
                status=flow.status,
                last_run_at=flow.last_run_at,
                last_run_status=flow.last_run_status,
                run_blocked_reason=blocked_reason,
                created_at=flow.created_at,
            ))

        return response

    async def get_flow(self, flow_id: str, current_user: User) -> Optional[BackupFlowResponse]:
        flow = await self.db.get(BackupFlow, flow_id)
        if not flow:
            return None
        return await self.build_flow_response(flow, current_user)

    async def update_flow(
        self, flow_id: str, flow_update: BackupFlowUpdate, current_user: User
    ) -> Optional[BackupFlowResponse]:
        flow = await self.db.get(BackupFlow, flow_id)
        if not flow:
            return None

        if flow_update.source is not None:
            source = await require_credential_access(
                self.db, current_user, flow_update.source.credential_id, min_level='view',
            )
            ConnectorBindingValidationService.validate_source_credential(
                source,
                module_key='backup',
            )
            flow.source_credential_id = source.id

        if flow_update.backup_type:
            flow.backup_type = flow_update.backup_type

        if flow_update.destination is not None:
            destination = await require_credential_access(
                self.db, current_user, flow_update.destination.credential_id, min_level='view',
            )
            ConnectorBindingValidationService.validate_destination_credential(
                destination,
                module_key='backup',
                pipeline_destination_only=False,
            )
            flow.destination_credential_id = destination.id
            flow.destination_target = dict(flow_update.destination.target or {}) or None

        if flow_update.structure:
            flow.structure = flow_update.structure.model_dump()

        if flow_update.schedule:
            flow.schedule = flow_update.schedule.model_dump()

        if flow_update.status:
            flow.status = flow_update.status

        flow.updated_by = flow_update.updated_by or current_user.email

        await self.db.commit()
        await self.db.refresh(flow)
        return await self.build_flow_response(flow, current_user)

    async def delete_flow(self, flow_id: str) -> bool:
        flow = await self.db.get(BackupFlow, flow_id)
        if not flow:
            return False
        await self.db.delete(flow)
        await self.db.commit()
        return True

    async def publish_flow(self, flow_id: str, current_user: User) -> Optional[BackupFlowResponse]:
        flow = await self.db.get(BackupFlow, flow_id)
        if not flow:
            return None
        flow.is_draft = 0
        flow.is_published = 1
        flow.updated_by = current_user.email
        await self.db.commit()
        await self.db.refresh(flow)
        return await self.build_flow_response(flow, current_user)

    # ── Run triggering ───────────────────────────────────────────────────
    async def trigger_flow_run(
        self, flow_id: str, triggered_by: str
    ) -> Optional[BackupFlowRun]:
        flow = await self.db.get(BackupFlow, flow_id)
        if not flow:
            return None

        if not flow.source_credential_id or not flow.destination_credential_id:
            raise ValueError("Backup flow is missing a source or destination credential assignment.")

        source, destination = await self._validate_role_assignment(
            flow.source_credential_id, flow.destination_credential_id
        )

        # Validate destination before launching the runner.
        destination_auth = dict(destination.auth or {})
        destination_config = dict(destination.config or {})
        validation_view = {**destination_auth}
        for key in ("folder_id", "drive_id", "uses_platform_service_account"):
            if key in destination_config:
                validation_view.setdefault(key, destination_config[key])
        destination_target = dict(flow.destination_target or {})
        for key in ("folder_id", "drive_id"):
            if key in destination_target:
                validation_view[key] = destination_target[key]
        validation_view["auth_mode"] = destination.auth_mode
        validate_service_account_drive_destination(validation_view)

        from modules.backup.backend.extractors.generic_connector_extractor import run_generic_connector_backup

        if source.app_id == 'workflow':
            from modules.backup.backend.extractors.workflow_extractor import run_workflow_backup
            runner = run_workflow_backup
        elif source.app_id == 'service':
            from modules.backup.backend.extractors.service_extractor import run_service_backup
            runner = run_service_backup
        elif source.app_id == 'request':
            from modules.backup.backend.extractors.request_extractor import run_request_backup
            runner = run_request_backup
        elif source.app_id == 'wework':
            from modules.backup.backend.extractors.wework_extractor import run_wework_backup
            runner = run_wework_backup
        else:
            runner = run_generic_connector_backup

        new_run = BackupFlowRun(
            flow_id=flow_id,
            status='pending',
            triggered_by=triggered_by,
        )
        self.db.add(new_run)
        await self.db.commit()
        await self.db.refresh(new_run)

        flow.last_run_at = new_run.started_at
        flow.last_run_status = 'running'
        flow.last_run_message = 'Backup is starting'
        await self.db.commit()

        task = asyncio.create_task(runner(str(flow.id), str(new_run.id)))
        run_id_key = str(new_run.id)
        BACKUP_RUN_TASKS[run_id_key] = task
        task.add_done_callback(lambda _: BACKUP_RUN_TASKS.pop(run_id_key, None))

        return new_run

    async def get_flow_runs(self, flow_id: str, limit: int = 10) -> List[BackupFlowRunResponse]:
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
        current_user: User,
        recent_limit: int = 8,
        active_limit: int = 5,
    ) -> BackupDashboardResponse:
        flow_stmt = apply_resource_scope(
            select(BackupFlow).order_by(BackupFlow.created_at.desc()),
            BackupFlow,
            ResourceType.BACKUP_FLOW,
            current_user,
            module='backup',
        )
        flow_result = await self.db.execute(flow_stmt)
        flows = flow_result.scalars().all()
        published_flows = [flow for flow in flows if flow.is_draft == 0]
        flow_map = {str(flow.id): flow for flow in flows}
        flow_ids = tuple(flow.id for flow in flows)

        # Batch-load source credentials for app label rendering.
        source_ids = {flow.source_credential_id for flow in flows if flow.source_credential_id}
        source_map: Dict[UUID, AppCredential] = {}
        if source_ids:
            cred_result = await self.db.execute(
                select(AppCredential).where(AppCredential.id.in_(tuple(source_ids)))
            )
            source_map = {c.id: c for c in cred_result.scalars().all()}

        if flow_ids:
            active_result = await self.db.execute(
                select(BackupFlowRun)
                .where(
                    BackupFlowRun.flow_id.in_(flow_ids),
                    BackupFlowRun.status.in_(("pending", "running")),
                )
                .order_by(BackupFlowRun.started_at.desc())
                .limit(active_limit)
            )
            active_runs = active_result.scalars().all()

            recent_result = await self.db.execute(
                select(BackupFlowRun)
                .where(BackupFlowRun.flow_id.in_(flow_ids))
                .order_by(BackupFlowRun.started_at.desc())
                .limit(recent_limit)
            )
            recent_runs = recent_result.scalars().all()
        else:
            active_runs = []
            recent_runs = []

        configured_apps = len({
            source_map[flow.source_credential_id].app_id
            for flow in published_flows
            if flow.source_credential_id and flow.source_credential_id in source_map
        })

        active_flow_ids = {str(run.flow_id) for run in active_runs}

        def build_run_response(run: BackupFlowRun) -> BackupDashboardRunResponse:
            flow = flow_map.get(str(run.flow_id))
            source = source_map.get(flow.source_credential_id) if flow and flow.source_credential_id else None
            return BackupDashboardRunResponse(
                run_id=run.id,
                flow_id=run.flow_id,
                flow_name=flow.name if flow else None,
                app=source.app_id if source else None,
                app_name=source.app_name if source else None,
                status=run.status,
                started_at=run.started_at,
                completed_at=run.completed_at,
                execution_details=run.execution_details,
                error_message=run.error_message,
                triggered_by=run.triggered_by,
                latest_log_line=_latest_log_line(run.logs),
            )

        return BackupDashboardResponse(
            configured_apps=configured_apps,
            completed_flows=len([
                flow for flow in published_flows
                if flow.last_run_status == 'completed' and str(flow.id) not in active_flow_ids
            ]),
            pending_flows=len([flow for flow in published_flows if not flow.last_run_at]),
            running_flows=len(active_flow_ids),
            active_runs=[build_run_response(run) for run in active_runs],
            recent_runs=[build_run_response(run) for run in recent_runs],
        )

    async def get_flow_model(self, flow_id: str) -> Optional[BackupFlow]:
        return await self.db.get(BackupFlow, flow_id)

    # ── Runtime helpers for connector extractors ────────────────────────
    async def build_source_runtime(self, flow: BackupFlow) -> Dict[str, any]:
        return await AppCredentialService(self.db).build_source_runtime(flow.source_credential_id)

    async def build_destination_runtime(self, flow: BackupFlow) -> Dict[str, any]:
        return await AppCredentialService(self.db).build_destination_runtime(
            flow.destination_credential_id,
            dict(flow.destination_target or {}) or None,
        )


def _latest_log_line(logs: Optional[str]) -> Optional[str]:
    if not logs:
        return None
    for line in reversed(logs.splitlines()):
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return None
