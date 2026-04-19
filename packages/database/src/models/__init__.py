from sqlalchemy import (
    Column,
    String,
    DateTime,
    Text,
    Integer,
    Boolean,
    ForeignKey,
    CheckConstraint,
    UniqueConstraint,
    text,
)
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


class ResourceType:
    APP_CREDENTIAL = 'app_credential'
    BACKUP_FLOW = 'backup_flow'
    DATA_PIPELINE = 'data_pipeline'
    CHOICES = (APP_CREDENTIAL, BACKUP_FLOW, DATA_PIPELINE)


class SharePermission:
    VIEW = 'view'
    EDIT = 'edit'
    CHOICES = (VIEW, EDIT)


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
            '\'{"backup":"none","apps":"none","pipeline":"none","automation":"none","settings":"none"}\'::jsonb'
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


class AppCredential(Base):
    """Unified credential registry for every integration.

    Apps module owns this table: it is a role-neutral store of reusable
    credentials. A Backup flow decides which credential plays the source role
    and which plays the destination role at configuration time.
    """

    __tablename__ = "app_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)
    app_id = Column(String(50), nullable=False)
    app_name = Column(String(100), nullable=False)
    auth_mode = Column(String(50), nullable=False)
    auth = Column(JSONB, nullable=False)
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = ()


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
    owner_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)

    # Draft / publish flags
    is_draft = Column(Integer, default=1, nullable=False)
    is_published = Column(Integer, default=0, nullable=False)

    # Role assignment: which saved credential plays which role for this flow
    source_credential_id = Column(
        UUID(as_uuid=True),
        ForeignKey('app_credentials.id', ondelete='RESTRICT'),
        nullable=True,
    )
    destination_credential_id = Column(
        UUID(as_uuid=True),
        ForeignKey('app_credentials.id', ondelete='RESTRICT'),
        nullable=True,
    )

    # Per-flow destination target selection (folder/drive picked for this backup)
    destination_target = Column(JSONB, nullable=True)

    backup_type = Column(String(50), nullable=True)
    structure = Column(JSONB, nullable=True)
    schedule = Column(JSONB, nullable=True)

    status = Column(String(20), default='active', nullable=False)

    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String(20), nullable=True)
    last_run_message = Column(Text, nullable=True)

    created_by = Column(String(100), nullable=True)
    updated_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

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

    status = Column(String(20), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    execution_details = Column(JSONB, nullable=True)

    logs = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    triggered_by = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('pending', 'running', 'completed', 'failed')", name='check_run_status'),
    )


# ── Data Pipeline ─────────────────────────────────────────────────────────────

class PipelineStatus:
    DRAFT = 'draft'
    ACTIVE = 'active'
    PAUSED = 'paused'
    ARCHIVED = 'archived'


class DataPipeline(Base):
    """A configured data pipeline that moves data from a source to a destination."""
    __tablename__ = "data_pipelines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)

    status = Column(String(20), nullable=False, server_default=PipelineStatus.DRAFT)

    # Source configuration
    source_connector_key = Column(String(50), nullable=False)
    source_credential_id = Column(
        UUID(as_uuid=True),
        ForeignKey('app_credentials.id', ondelete='RESTRICT'),
        nullable=True,
    )
    source_stream_key = Column(String(100), nullable=True)
    source_streams = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    source_config = Column(JSONB, nullable=True)

    # Destination configuration
    dest_connector_key = Column(String(50), nullable=False)
    dest_credential_id = Column(
        UUID(as_uuid=True),
        ForeignKey('app_credentials.id', ondelete='RESTRICT'),
        nullable=True,
    )
    dest_stream_key = Column(String(100), nullable=False)
    dest_config = Column(JSONB, nullable=True)
    write_mode = Column(String(20), nullable=False, server_default='append')

    # Field mapping — snapshot at config time; re-discovered each run if dynamic
    field_mapping = Column(JSONB, nullable=True)

    # Schedule
    schedule = Column(JSONB, nullable=True)

    # Run summary cache
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String(20), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'active', 'paused', 'archived')",
            name='check_pipeline_status',
        ),
        CheckConstraint(
            "write_mode IN ('append', 'replace', 'upsert')",
            name='check_pipeline_write_mode',
        ),
        CheckConstraint(
            "last_run_status IS NULL OR last_run_status IN ('pending', 'running', 'completed', 'failed')",
            name='check_pipeline_last_run_status',
        ),
    )


class PipelineRun(Base):
    """A single execution of a data pipeline."""
    __tablename__ = "pipeline_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pipeline_id = Column(UUID(as_uuid=True), ForeignKey('data_pipelines.id', ondelete='CASCADE'), nullable=False, index=True)

    status = Column(String(20), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    records_read = Column(Integer, nullable=True)
    records_written = Column(Integer, nullable=True)
    error_count = Column(Integer, nullable=True)

    # Snapshot of config used for this run (so config changes don't affect history)
    run_config = Column(JSONB, nullable=True)

    logs = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    triggered_by = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed')",
            name='check_pipeline_run_status',
        ),
    )


class ResourceShare(Base):
    __tablename__ = "resource_shares"

    id = Column(Integer, primary_key=True, autoincrement=True)
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(String(64), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    permission = Column(String(16), nullable=False, server_default=SharePermission.VIEW)
    shared_by = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(
            f"resource_type IN {ResourceType.CHOICES}",
            name='check_resource_share_resource_type',
        ),
        CheckConstraint(
            f"permission IN {SharePermission.CHOICES}",
            name='check_resource_share_permission',
        ),
        UniqueConstraint("resource_type", "resource_id", "user_id", name="uq_resource_shares"),
    )
