from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import List, Optional
import bcrypt
import hashlib
import base64
import os
from datetime import datetime
from cryptography.fernet import Fernet

from models import BackupFlow, BackupFlowRun, BackupSourceApp
from schemas import (
    BackupFlowCreate, 
    BackupFlowDraftCreate,
    BackupFlowSave,
    BackupFlowAutosave,
    BackupFlowUpdate, 
    BackupFlowResponse,
    BackupFlowListResponse,
    BackupFlowRunResponse,
    BackupSourceAppResponse
)

class BackupFlowService:
    """Service for managing backup flows"""
    
    def __init__(self, db: AsyncSession):
        self.db = db

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
        return BackupFlowResponse.model_validate(new_flow)

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
        dest_dict = save_data.destination.model_dump()
        if 'refresh_token' in dest_dict.get('auth', {}):
            refresh_token = dest_dict['auth'].pop('refresh_token')
            dest_dict['auth']['refresh_token_hash'] = self.hash_token(refresh_token)

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
        return BackupFlowResponse.model_validate(flow)

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
            flow.destination = data.destination

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
        dest_dict = flow_data.destination.model_dump()
        if 'refresh_token' in dest_dict.get('auth', {}):
            refresh_token = dest_dict['auth'].pop('refresh_token')
            dest_dict['auth']['refresh_token_hash'] = self.hash_token(refresh_token)
        
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
        
        return BackupFlowResponse.model_validate(new_flow)
    
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
        
        return BackupFlowResponse.model_validate(flow)
    
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
            dest_dict = flow_update.destination.model_dump()
            if 'refresh_token' in dest_dict.get('auth', {}):
                refresh_token = dest_dict['auth'].pop('refresh_token')
                dest_dict['auth']['refresh_token_hash'] = self.hash_token(refresh_token)
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
        
        return BackupFlowResponse.model_validate(flow)
    
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
        return BackupFlowResponse.model_validate(flow)
    
    async def trigger_flow_run(
        self, 
        flow_id: str, 
        triggered_by: str
    ) -> Optional[BackupFlowRun]:
        """Trigger a backup flow execution"""
        
        # Check if flow exists
        query = select(BackupFlow).where(BackupFlow.id == flow_id)
        result = await self.db.execute(query)
        flow = result.scalar_one_or_none()
        
        if not flow:
            return None
        
        # Create a new run record
        new_run = BackupFlowRun(
            flow_id=flow_id,
            status='pending',
            triggered_by=triggered_by
        )
        
        self.db.add(new_run)
        await self.db.commit()
        await self.db.refresh(new_run)
        
        # TODO: Queue the actual backup job in a task queue (Celery, RQ, etc.)
        # For now, just return the run record
        
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


class BackupSourceAppService:
    """Service for accessing source app API definitions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_source_apps(self) -> List[BackupSourceAppResponse]:
        query = select(BackupSourceApp).where(BackupSourceApp.is_active == True)
        result = await self.db.execute(query)
        apps = result.scalars().all()
        return [BackupSourceAppResponse.model_validate(a) for a in apps]

    async def get_source_app(self, app_id: str) -> Optional[BackupSourceAppResponse]:
        query = select(BackupSourceApp).where(
            BackupSourceApp.app_id == app_id,
            BackupSourceApp.is_active == True
        )
        result = await self.db.execute(query)
        app = result.scalar_one_or_none()
        if not app:
            return None
        return BackupSourceAppResponse.model_validate(app)
