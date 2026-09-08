"""Domain enumerations.

These are the product's vocabulary (SRS 5). None of them is an n8n value:
`IRun` statuses, `typeVersion`s and `n8n-nodes-base.*` node types stop at the
engine adapter and are normalized into the members below.
"""

from __future__ import annotations

from enum import Enum


class WorkspaceStatus(str, Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DELETED = "DELETED"


class WorkflowStatus(str, Enum):
    """Lifecycle, not health (SRS 79). Health is derived and cached separately."""

    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    DELETED = "DELETED"


class TriggerType(str, Enum):
    MANUAL = "MANUAL"
    WEBHOOK = "WEBHOOK"
    SCHEDULE = "SCHEDULE"


class ScheduleType(str, Enum):
    INTERVAL = "INTERVAL"
    DAILY = "DAILY"
    CRON = "CRON"


class OverlapPolicy(str, Enum):
    SKIP_IF_RUNNING = "SKIP_IF_RUNNING"
    ALLOW = "ALLOW"


class WebhookAuthMode(str, Enum):
    NONE = "NONE"
    BASIC = "BASIC"
    HEADER_SIGNATURE = "HEADER_SIGNATURE"


class VersionKind(str, Enum):
    """Which artefact a run executed. A draft run is reproducible because the
    snapshot is frozen at dispatch, not read again from the mutable draft."""

    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"


class ExecutionStatus(str, Enum):
    """Product execution state machine (SRS 16.1)."""

    QUEUED = "QUEUED"
    DISPATCHING = "DISPATCHING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCEL_REQUESTED = "CANCEL_REQUESTED"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"
    FAILED_TO_START = "FAILED_TO_START"
    #: The worker lost the engine mid-run and could not confirm an outcome.
    #: Never left as RUNNING forever (ADR-010).
    ENGINE_INTERRUPTED = "ENGINE_INTERRUPTED"

    @property
    def is_terminal(self) -> bool:
        return self in TERMINAL_EXECUTION_STATUSES

    @property
    def is_active(self) -> bool:
        return self in ACTIVE_EXECUTION_STATUSES


TERMINAL_EXECUTION_STATUSES: frozenset[ExecutionStatus] = frozenset({
    ExecutionStatus.SUCCEEDED,
    ExecutionStatus.FAILED,
    ExecutionStatus.CANCELLED,
    ExecutionStatus.TIMED_OUT,
    ExecutionStatus.FAILED_TO_START,
    ExecutionStatus.ENGINE_INTERRUPTED,
})

ACTIVE_EXECUTION_STATUSES: frozenset[ExecutionStatus] = frozenset({
    ExecutionStatus.QUEUED,
    ExecutionStatus.DISPATCHING,
    ExecutionStatus.RUNNING,
    ExecutionStatus.CANCEL_REQUESTED,
})


class NodeRunStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    #: The branch was not taken. An IF that went true leaves its false branch
    #: skipped, which is a different thing from a node that never ran because
    #: the workflow died earlier.
    SKIPPED = "SKIPPED"


class NodeCategory(str, Enum):
    TRIGGER = "TRIGGER"
    ACTION = "ACTION"
    LOGIC = "LOGIC"
    DATA = "DATA"
    APP = "APP"


class Certification(str, Enum):
    SUPPORTED = "SUPPORTED"
    BETA = "BETA"
    HIDDEN = "HIDDEN"
    BLOCKED = "BLOCKED"


class NodeStatus(str, Enum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    DEPRECATED = "DEPRECATED"


class CredentialType(str, Enum):
    NONE = "NONE"
    HTTP_BASIC = "HTTP_BASIC"
    BEARER = "BEARER"
    HEADER_API_KEY = "HEADER_API_KEY"
    QUERY_API_KEY = "QUERY_API_KEY"


class CredentialStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INVALID = "INVALID"
    REVOKED = "REVOKED"
    DELETED = "DELETED"


class EngineType(str, Enum):
    N8N_CORE = "N8N_CORE"


class EngineStatus(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    OFFLINE = "OFFLINE"


class ActorType(str, Enum):
    USER = "USER"
    SYSTEM = "SYSTEM"
    API = "API"
    WEBHOOK = "WEBHOOK"


class AuditResult(str, Enum):
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class AlertEventType(str, Enum):
    EXECUTION_FAILED = "EXECUTION_FAILED"
    CONSECUTIVE_FAILURES = "CONSECUTIVE_FAILURES"
    CREDENTIAL_INVALID = "CREDENTIAL_INVALID"
    SCHEDULE_MISSED = "SCHEDULE_MISSED"
    WEBHOOK_AUTH_FAILURE_BURST = "WEBHOOK_AUTH_FAILURE_BURST"
    ENGINE_DEGRADED = "ENGINE_DEGRADED"
    VERSION_INCOMPATIBLE = "VERSION_INCOMPATIBLE"


class NotificationStatus(str, Enum):
    UNREAD = "UNREAD"
    READ = "READ"
    ACKNOWLEDGED = "ACKNOWLEDGED"


class HealthLevel(str, Enum):
    """Derived, cached, and separate from lifecycle status (SRS 18.3)."""

    HEALTHY = "HEALTHY"
    RUNNING = "RUNNING"
    WARNING = "WARNING"
    ACTION_REQUIRED = "ACTION_REQUIRED"
    FAILED = "FAILED"
    INACTIVE = "INACTIVE"
    DRAFT_ONLY = "DRAFT_ONLY"
    NEVER_RUN = "NEVER_RUN"
