"""Runtime configuration.

One settings object, read from the environment. Anything that differs between
a laptop and production is here rather than inline, and the few values that
must never carry a development default in production are checked at startup
(see app/core/readiness.py).
"""

from __future__ import annotations

import os
import pathlib
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

#: Settings that may be delivered as a file instead of a value.
#:
#: `DATABASE_URL_FILE=/run/secrets/database_url` is read and used as
#: `DATABASE_URL`. That is how Docker secrets and Kubernetes projected volumes
#: hand over a secret, and it is the better channel: `docker inspect` and
#: `/proc/<pid>/environ` both show environment variables to anybody who can
#: read them, while a file can be root-owned and mode 0400.
_FILE_BACKED = (
    "DATABASE_URL",
    "JWT_SECRET",
    "SECRET_ENCRYPTION_KEY",
    "ENGINE_INTERNAL_TOKEN",
)


def _load_file_backed_secrets() -> None:
    """Promote every `NAME_FILE` to `NAME`, before Settings is constructed.

    Done here rather than in a validator so that the rest of the application --
    and `readiness.configuration_problems`, which decides whether to boot at
    all -- sees one uniform source. A field that could come from two places is
    a field two people will disagree about.

    An unreadable `_FILE` raises. Falling back to the environment or to a
    default would start the deployment with a secret nobody chose: the API
    would sign sessions with a development key, or fail every engine dispatch
    on authentication, and nothing in the logs would say why.
    """
    for name in _FILE_BACKED:
        path = os.environ.get(f"{name}_FILE")
        if not path:
            continue
        try:
            value = pathlib.Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError(
                f"{name}_FILE is set to {path!r} but it cannot be read: {exc}. "
                "Refusing to fall back to an environment value or a default -- "
                "a deployment running with a secret nobody chose is worse than "
                "one that does not start."
            ) from exc
        if not value:
            raise RuntimeError(f"{name}_FILE ({path}) is empty.")
        os.environ[name] = value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore"
    )

    # ── identity of this deployment ────────────────────────────────────────
    app_env: str = "development"
    service_name: str = "appbi-workflow-api"
    product_version: str = "1.0.0"
    log_level: str = "INFO"
    log_format: str = "json"

    # ── database ───────────────────────────────────────────────────────────
    database_url: str = (
        "postgresql+asyncpg://appbi:appbi@localhost:5433/appbi_workflow"
    )

    # ── auth ───────────────────────────────────────────────────────────────
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    session_ttl_seconds: int = 60 * 60 * 12
    session_cookie_name: str = "appbi_workflow_session"
    session_cookie_secure: bool = False
    login_max_attempts: int = 8
    login_lockout_seconds: int = 300
    #: Per source address, shared across replicas. The per-account lockout
    #: above is a different control: this one is about one IP spraying many
    #: accounts.
    login_rate_limit_per_minute: int = 30

    # ── secrets ────────────────────────────────────────────────────────────
    #: 32-byte urlsafe-base64. Generate with:
    #:   python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
    secret_encryption_key: str = ""
    allow_derived_encryption_key: bool = True

    # ── engine boundary ────────────────────────────────────────────────────
    engine_type: str = "N8N_CORE"
    #: Internal only. Never rendered to a browser, never in an API response.
    engine_base_url: str = "http://localhost:8099"
    engine_internal_token: str = "dev-engine-token"
    engine_timeout_seconds: float = 30.0
    engine_validate_timeout_seconds: float = 30.0
    engine_dispatch_timeout_seconds: float = 15.0
    adapter_contract_version: str = "1"
    #: Refuse to boot in production if the engine is unreachable.
    startup_require_engine: bool = False

    # ── execution policy ───────────────────────────────────────────────────
    execution_max_runtime_seconds: int = 20 * 60
    #: How long a RUNNING execution may go without the engine confirming it
    #: before the reconciler calls it ENGINE_INTERRUPTED.
    execution_stale_after_seconds: int = 120
    max_concurrent_executions_per_workflow: int = 1
    max_concurrent_executions_per_workspace: int = 10
    execution_payload_preview_bytes: int = 64 * 1024
    execution_preview_retention_days: int = 14

    # ── worker ─────────────────────────────────────────────────────────────
    worker_poll_interval_seconds: float = 1.0
    worker_schedule_interval_seconds: float = 10.0
    worker_reconcile_interval_seconds: float = 10.0
    worker_batch_size: int = 5

    # ── webhook gateway ────────────────────────────────────────────────────
    webhook_max_body_bytes: int = 512 * 1024
    webhook_rate_limit_per_minute: int = 120
    public_base_url: str = "http://localhost:8000"

    # ── HTTP Request egress policy (SRS 32.2) ──────────────────────────────
    #: Enforced by the engine, configured by the product so an operator has one
    #: place to look.
    egress_allow_private_networks: bool = False
    egress_allowed_hosts: str = ""
    egress_blocked_hosts: str = "169.254.169.254,metadata.google.internal"
    egress_max_redirects: int = 5
    egress_max_response_bytes: int = 8 * 1024 * 1024
    egress_request_timeout_seconds: int = 60

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def egress_allowed_host_list(self) -> list[str]:
        return [h.strip() for h in self.egress_allowed_hosts.split(",") if h.strip()]

    @property
    def egress_blocked_host_list(self) -> list[str]:
        return [h.strip() for h in self.egress_blocked_hosts.split(",") if h.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_file_backed_secrets()
    return Settings()


settings = get_settings()
