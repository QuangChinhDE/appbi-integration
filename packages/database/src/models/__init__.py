from sqlalchemy import Column, String, DateTime, Text, Integer, Boolean, ForeignKey, CheckConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
import uuid

from packages.database.src.base import Base


class UserStatus:
    ACTIVE = 'active'
    DEACTIVATED = 'deactivated'


class AuthProvider:
    PASSWORD = 'password'
    GOOGLE = 'google'


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, unique=True, index=True)
    full_name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=True)
    auth_provider = Column(String(32), nullable=False, server_default=AuthProvider.PASSWORD)
    google_sub = Column(String(255), nullable=True, unique=True, index=True)
    avatar_url = Column(String(1024), nullable=True)
    status = Column(String(32), nullable=False, server_default=UserStatus.ACTIVE)
    permissions = Column(
        JSONB,
        nullable=False,
        server_default=text(
            '\'{"backup":"none","apps":"none","automation":"none","settings":"none"}\'::jsonb'
        ),
    )
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AppConfig(Base):
    """Generic key-value config store. Secrets are Fernet-encrypted."""
    __tablename__ = "app_config"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
    is_secret = Column(Boolean, default=False, nullable=False)
    description = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class GoogleConnection(Base):
    """Stores OAuth2 tokens for a connected Google account."""
    __tablename__ = "google_connections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    google_id = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False, unique=True)
    display_name = Column(String(255), nullable=True)
    picture_url = Column(String(500), nullable=True)
    access_token_encrypted = Column(Text, nullable=False)
    refresh_token_encrypted = Column(Text, nullable=True)
    token_expiry = Column(DateTime(timezone=True), nullable=True)
    scopes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class SourceConnection(Base):
    __tablename__ = "source_connections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    app_id = Column(String(50), nullable=False)
    app_name = Column(String(100), nullable=False)
    domain = Column(String(255), nullable=True)
    access_token_encrypted = Column(Text, nullable=False)
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("app_id IN ('request', 'workflow', 'wework', 'service')", name='check_source_connection_app_id'),
    )


class DestinationProfile(Base):
    __tablename__ = "destination_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    destination_type = Column(String(50), nullable=False)
    auth_mode = Column(String(50), nullable=False)
    auth = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("destination_type IN ('gdrive', 'gsheets')", name='check_destination_profile_type'),
        CheckConstraint("auth_mode IN ('google_oauth', 'service_account')", name='check_destination_profile_auth_mode'),
    )


class BackupSourceApp(Base):
    __tablename__ = "backup_source_apps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id = Column(String(50), nullable=False, unique=True)
    app_name = Column(String(100), nullable=False)
    base_url_template = Column(String(500), nullable=False)
    api_steps = Column(JSONB, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

class BackupFlow(Base):
    __tablename__ = "backup_flows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=True)
    
    # Draft / publish flags
    is_draft = Column(Integer, default=1, nullable=False)
    is_published = Column(Integer, default=0, nullable=False)

    # Source information (JSONB)
    # Structure: {"app": "request", "app_name": "Request", "domain": "company.vn", "access_token_hash": "..."}
    source = Column(JSONB, nullable=True)
    
    # Backup type: structured, unstructured, all
    backup_type = Column(String(50), nullable=True)
    
    # Destination information (JSONB)
    # Structure: {"type": "gdrive", "name": "Google Drive", "auth": {...}}
    destination = Column(JSONB, nullable=True)
    
    # Backup structure (JSONB) - optional
    # Structure: {"objects": [...], "custom_fields": [...], "export_formats": {...}}
    structure = Column(JSONB, nullable=True)
    
    # Schedule information (JSONB) - optional
    # Structure: {"type": "daily", "time": "02:00", "enabled": true}
    schedule = Column(JSONB, nullable=True)
    
    # Status: active, paused, archived
    status = Column(String(20), default='active', nullable=False)
    
    # Last run information
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String(20), nullable=True)
    last_run_message = Column(Text, nullable=True)
    
    # Audit fields
    created_by = Column(String(100), nullable=True)
    updated_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Check constraints
    __table_args__ = (
        CheckConstraint("backup_type IS NULL OR backup_type IN ('structured', 'unstructured', 'all')", name='check_backup_type'),
        CheckConstraint("status IN ('active', 'paused', 'archived')", name='check_status'),
        CheckConstraint("last_run_status IS NULL OR last_run_status IN ('completed', 'failed', 'running')", name='check_last_run_status'),
        CheckConstraint("is_draft IN (0, 1)", name='check_is_draft'),
        CheckConstraint("is_published IN (0, 1)", name='check_is_published'),
    )


class BackupFlowRun(Base):
    __tablename__ = "backup_flow_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    flow_id = Column(UUID(as_uuid=True), ForeignKey('backup_flows.id', ondelete='CASCADE'), nullable=False)
    
    # Run status: pending, running, completed, failed
    status = Column(String(20), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Execution details (JSONB)
    # Structure: {"total_records": 1000, "processed_records": 1000, "output_files": [...], ...}
    execution_details = Column(JSONB, nullable=True)
    
    # Logs and errors
    logs = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Audit
    triggered_by = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Check constraint
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'running', 'completed', 'failed')", name='check_run_status'),
    )
