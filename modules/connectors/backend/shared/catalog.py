from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.auth.src.resource_permissions import apply_resource_scope
from packages.database.src.models import AppCredential, ResourceType, User

from modules.connectors.apps._definition_registry import load_packaged_connector_definitions
from modules.connectors.apps._packages import canonical_connector_key

from .contracts import ConnectorDefinition


# Connector registry
# App-specific definitions live under modules/connectors/apps/<app-id>/definition.
CONNECTOR_REGISTRY: tuple[ConnectorDefinition, ...] = load_packaged_connector_definitions()


# Manifest overrides
# definition/manifest.yaml can replace a packaged definition during migration.
def _apply_manifest_overrides(registry: tuple[ConnectorDefinition, ...]) -> tuple[ConnectorDefinition, ...]:
    # Lazy import to avoid a circular dependency with declarative_runtime.
    from modules.connectors.backend.shared.manifest_loader import (
        connector_definition_from_manifest,
        register_all_manifests,
    )

    manifests = register_all_manifests()
    if not manifests:
        return registry

    overridden: list[ConnectorDefinition] = []
    seen_keys: set[str] = set()
    for connector in registry:
        manifest = manifests.get(connector.connector_key)
        if manifest is not None:
            overridden.append(connector_definition_from_manifest(manifest))
            seen_keys.add(connector.connector_key)
        else:
            overridden.append(connector)
            seen_keys.add(connector.connector_key)
    # New manifests that don't match any existing entry are appended.
    for key, manifest in manifests.items():
        if key not in seen_keys:
            overridden.append(connector_definition_from_manifest(manifest))
    return tuple(overridden)


CONNECTOR_REGISTRY = _apply_manifest_overrides(CONNECTOR_REGISTRY)


# ── Lookup helpers ────────────────────────────────────────────────────────────

def get_connector(connector_key: str) -> ConnectorDefinition | None:
    target_key = canonical_connector_key(connector_key)
    for connector in CONNECTOR_REGISTRY:
        if connector.connector_key == target_key:
            return connector
    return None


def get_all_connector_keys() -> set[str]:
    return {c.connector_key for c in CONNECTOR_REGISTRY}


def get_readable_connector_keys() -> set[str]:
    return {c.connector_key for c in CONNECTOR_REGISTRY if c.get_readable_streams()}


def get_writable_connector_keys() -> set[str]:
    return {c.connector_key for c in CONNECTOR_REGISTRY if c.get_writable_streams()}


# ── Derived groupings (Apps and other modules must consume these, not hardcode) ─
# The connector registry is the single source of truth for which apps exist and
# how they authenticate. Apps/Backup/Pipeline MUST import these helpers instead
# of repeating app-id lists in their own modules.

def get_supported_app_names() -> dict[str, str]:
    """Map of app_id -> display_name for every registered connector."""
    return {c.connector_key: c.display_name for c in CONNECTOR_REGISTRY}


def get_google_style_app_ids() -> set[str]:
    """Connectors that authenticate through Google (OAuth or service account)."""
    return {
        c.connector_key
        for c in CONNECTOR_REGISTRY
        if c.auth_spec.auth_type in ('google_oauth', 'service_account')
        or 'google_oauth' in c.auth_spec.supported_auth_modes
    }


def get_source_style_app_ids() -> set[str]:
    """Connectors that use a domain + token style auth (the 'Base' apps)."""
    return {
        c.connector_key
        for c in CONNECTOR_REGISTRY
        if c.auth_spec.auth_type in ('token', 'token_password')
    }


def get_supported_auth_modes() -> set[str]:
    """Auth modes any registered connector can produce at credential creation."""
    modes: set[str] = set()
    for c in CONNECTOR_REGISTRY:
        modes.update(c.auth_spec.supported_auth_modes)
        if c.auth_spec.auth_type == 'token':
            modes.add('access_token')
        elif c.auth_spec.auth_type == 'token_password':
            modes.add('token_password')
    return modes


# ── Catalog service ───────────────────────────────────────────────────────────

class ConnectorCatalogService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── New stream-level API ──────────────────────────────────────────────

    async def list_connectors(self, current_user: User | None = None) -> list[dict[str, object]]:
        counts = await self._load_credential_counts(current_user)
        return [c.to_payload(credential_count=counts.get(c.connector_key, 0)) for c in CONNECTOR_REGISTRY]

    async def list_connectors_by_capability(self, capability: str, current_user: User | None = None) -> list[dict[str, object]]:
        counts = await self._load_credential_counts(current_user)
        result: list[dict[str, object]] = []
        for c in CONNECTOR_REGISTRY:
            matching_streams = [s for s in c.streams if capability in s.capabilities]
            if matching_streams:
                result.append(c.to_payload(credential_count=counts.get(c.connector_key, 0)))
        return result

    async def get_connector_detail(self, connector_key: str, current_user: User | None = None) -> dict[str, object] | None:
        connector = get_connector(connector_key)
        if connector is None:
            return None
        counts = await self._load_credential_counts(current_user)
        return connector.to_payload(credential_count=counts.get(connector.connector_key, 0))

    async def get_stream_detail(self, connector_key: str, stream_key: str) -> dict[str, object] | None:
        connector = get_connector(connector_key)
        if connector is None:
            return None
        stream = connector.get_stream(stream_key)
        if stream is None:
            return None
        return stream.to_payload()

    # ── Backward-compatible API (used by Pipeline overview and Backup) ────

    async def list_source_readers(self, current_user: User | None = None) -> list[dict[str, object]]:
        counts = await self._load_credential_counts(current_user)
        return [
            c.as_source_reader_payload(
                credential_count=counts.get(c.connector_key, 0),
                module_key='pipeline',
            )
            for c in CONNECTOR_REGISTRY
            if c.supports_module('pipeline')
            and c.get_pipeline_source_streams()
            and c.status != 'planned'
        ]

    async def list_destination_writers(self, current_user: User | None = None) -> list[dict[str, object]]:
        counts = await self._load_credential_counts(current_user)
        return [
            c.as_destination_writer_payload(
                credential_count=counts.get(c.connector_key, 0),
                module_key='pipeline',
            )
            for c in CONNECTOR_REGISTRY
            if c.supports_module('pipeline')
            and any(
                s.supports_module('pipeline')
                for s in c.get_pipeline_destination_streams()
            )
            and c.status != 'planned'
        ]

    async def list_backup_sources(self, current_user: User | None = None) -> list[dict[str, object]]:
        counts = await self._load_credential_counts(current_user)
        return [
            c.as_source_reader_payload(
                credential_count=counts.get(c.connector_key, 0),
                module_key='backup',
            )
            for c in CONNECTOR_REGISTRY
            if c.supports_module('backup')
            and c.get_backup_streams()
            and c.status != 'planned'
        ]

    async def build_pipeline_catalog(self, current_user: User | None = None) -> dict[str, object]:
        sources = await self.list_source_readers(current_user)
        destinations = await self.list_destination_writers(current_user)
        return {
            'sources': sources,
            'destinations': destinations,
            'source_credential_count': sum(int(item.get('credential_count') or 0) for item in sources),
            'destination_credential_count': sum(int(item.get('credential_count') or 0) for item in destinations),
            'ready_destination_count': sum(1 for item in destinations if item.get('status') == 'ready'),
            'planned_destination_count': sum(1 for item in destinations if item.get('status') == 'planned'),
        }

    # ── Internal helpers ──────────────────────────────────────────────────

    async def _load_credential_counts(self, current_user: User | None = None) -> dict[str, int]:
        stmt = select(AppCredential.app_id, func.count(AppCredential.id)).group_by(AppCredential.app_id)
        if current_user is not None:
            stmt = apply_resource_scope(
                stmt, AppCredential, ResourceType.APP_CREDENTIAL, current_user, module='apps',
            )
        result = await self.db.execute(stmt)
        counts: dict[str, int] = {}
        for app_id, count in result.all():
            canonical_key = canonical_connector_key(str(app_id))
            counts[canonical_key] = counts.get(canonical_key, 0) + int(count or 0)
        return counts
