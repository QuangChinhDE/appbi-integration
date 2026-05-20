"""Load declarative manifest YAML files and turn them into ConnectorDefinitions.

Each app may provide a ``definition/manifest.yaml`` inside its Python package,
e.g.::

    modules/connectors/apps/workflow/definition/manifest.yaml

The older root-level ``manifest.yaml`` path is still supported during
migration.

When present, :func:`load_manifest` parses it into a :class:`ConnectorManifest`
and :func:`connector_definition_from_manifest` synthesizes the compatible
``ConnectorDefinition`` / ``StreamDefinition`` objects so the existing catalog,
validation, and wizard code keep working unchanged.

The manifest system is *additive*: apps without a manifest continue to use
their hand-coded connector class (see :mod:`runtime`).
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Optional

import yaml

from modules.connectors.apps._packages import APPS_ROOT, get_app_package, iter_app_packages
from modules.connectors.backend.shared.airbyte_manifest import (
    convert_airbyte_manifest,
    is_airbyte_manifest,
)
from modules.connectors.backend.shared.contracts import (
    AuthSpec,
    ConnectorDefinition,
    FieldDescriptor,
    StreamDefinition,
)
from modules.connectors.backend.shared.manifest import (
    ConnectorManifest,
    ManifestAuth,
    ManifestStream,
)


logger = logging.getLogger(__name__)


_APPS_ROOT = APPS_ROOT


def _manifest_path(connector_key: str) -> Path:
    package = get_app_package(connector_key, _APPS_ROOT)
    for candidate in package.manifest_candidates:
        if candidate.exists():
            return candidate
    return package.manifest_candidates[0]


def load_manifest(connector_key: str) -> Optional[ConnectorManifest]:
    path = _manifest_path(connector_key)
    if not path.exists():
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
    except Exception as exc:
        logger.exception("Failed to parse manifest %s: %s", path, exc)
        return None
    if not isinstance(data, dict):
        logger.error("Manifest %s is not a mapping", path)
        return None
    try:
        if is_airbyte_manifest(data):
            return convert_airbyte_manifest(data)
        return ConnectorManifest.model_validate(data)
    except Exception as exc:
        logger.exception("Manifest %s failed validation: %s", path, exc)
        return None


def discover_manifests() -> Dict[str, ConnectorManifest]:
    """Return every manifest that can be loaded from the apps folder."""
    manifests: Dict[str, ConnectorManifest] = {}
    if not _APPS_ROOT.exists():
        return manifests
    for package in iter_app_packages(_APPS_ROOT):
        manifest = load_manifest(package.connector_key)
        if manifest is not None:
            manifests[manifest.connector_key] = manifest
    return manifests


# ── ManifestStream → StreamDefinition ────────────────────────────────────────

def _field_descriptor_from_manifest(field) -> FieldDescriptor:
    return FieldDescriptor(
        name=field.name,
        field_type=field.type,
        required=field.required,
        description=field.description or '',
        secret=field.secret,
        storage=field.storage,
        input_kind='password' if field.secret else 'text',
    )


def _primary_json_type(prop: Any) -> str:
    """Return the first non-null JSON type from a JSON Schema property."""
    if not isinstance(prop, dict):
        return 'string'
    json_type = prop.get('type')
    if isinstance(json_type, list):
        non_null = [t for t in json_type if t != 'null'] or ['string']
        return str(non_null[0])
    if json_type:
        return str(json_type)
    # ``anyOf`` (e.g. cover field) → fall back to string.
    if isinstance(prop.get('anyOf'), list):
        return 'string'
    return 'string'


def _flatten_jsonschema(
    props: dict,
    *,
    parent_path: str = '',
    depth: int = 0,
    out: list[FieldDescriptor] | None = None,
) -> list[FieldDescriptor]:
    """Recursively flatten a JSON Schema ``properties`` block into FieldDescriptors.

    Mirrors Airbyte's Fields drawer: each top-level field gets an entry, and
    ``type: object`` fields drill down into ``properties`` using dotted paths
    (``account_export.hid``). ``type: array`` fields are surfaced as a single
    descriptor — the consumer treats them as JSON columns. Depth is capped to
    avoid pathological self-referencing schemas.
    """
    if out is None:
        out = []
    if depth > 4 or not isinstance(props, dict):
        return out

    for name, prop in props.items():
        path = f"{parent_path}.{name}" if parent_path else str(name)
        field_type = _primary_json_type(prop)
        out.append(FieldDescriptor(
            name=path,
            field_type=field_type,
            required=False,
            description='',
            secret=False,
            storage='runtime',
            input_kind='text',
        ))
        # Drill into nested objects so the wizard can show ``account_export.hid``
        # as its own row. Arrays of objects are intentionally NOT expanded —
        # they're handled as JSON-serialized columns at write time.
        if field_type == 'object' and isinstance(prop.get('properties'), dict):
            _flatten_jsonschema(
                prop['properties'],
                parent_path=path,
                depth=depth + 1,
                out=out,
            )
    return out


def _schema_fields_from_jsonschema(schema: dict) -> tuple[FieldDescriptor, ...]:
    props = schema.get('properties') if isinstance(schema, dict) else None
    if not isinstance(props, dict):
        return ()
    return tuple(_flatten_jsonschema(props))


def _stream_definition_from_manifest(
    stream: ManifestStream,
    *,
    supported_modules: tuple[str, ...],
) -> StreamDefinition:
    config_fields = tuple(_field_descriptor_from_manifest(f) for f in stream.config_fields)
    # If the stream has a parent, the partition field is effectively a required config.
    if stream.parent_stream:
        parent_field = FieldDescriptor(
            name=stream.parent_stream.partition_field,
            field_type='string',
            required=True,
            description=f"{stream.parent_stream.name} {stream.parent_stream.parent_key}",
            secret=False,
            storage='config',
            input_kind='text',
        )
        # If the user-supplied config_fields already include it, don't duplicate.
        if not any(f.name == parent_field.name for f in config_fields):
            config_fields = (parent_field,) + config_fields

    # Sync modes follow the declared cursor support: a manifest that ships
    # incremental → both full_refresh and incremental are available; otherwise
    # only full_refresh. This drives which entries the per-stream sync_mode
    # dropdown enables in the wizard.
    sync_modes: tuple[str, ...] = (
        ('full_refresh', 'incremental') if stream.incremental else ('full_refresh',)
    )
    cursor_field = stream.incremental.cursor_field if stream.incremental else None

    return StreamDefinition(
        stream_key=stream.name,
        display_name=stream.display_name or stream.name.title(),
        capabilities=tuple(stream.capabilities) or ('read',),
        sync_modes=sync_modes,
        cursor_field=cursor_field,
        primary_key=stream.primary_key,
        parent_stream=stream.parent_stream.name if stream.parent_stream else None,
        read_operation=None,
        write_operation=None,
        schema_fields=_schema_fields_from_jsonschema(stream.schema_),
        config_fields=config_fields,
        write_config=None,
        supported_modules=supported_modules,
    )


def _auth_spec_from_manifest(auth: ManifestAuth) -> AuthSpec:
    fields = tuple(_field_descriptor_from_manifest(f) for f in auth.fields)
    supported_modes: tuple[str, ...] = ()
    if auth.type == 'token':
        supported_modes = ('access_token',)
    elif auth.type == 'token_password':
        supported_modes = ('token_password',)
    elif auth.type == 'google_oauth':
        supported_modes = ('google_oauth', 'service_account')
    elif auth.type == 'service_account':
        supported_modes = ('service_account',)
    return AuthSpec(
        auth_type=auth.type,
        fields=fields,
        supported_auth_modes=supported_modes,
    )


def connector_definition_from_manifest(manifest: ConnectorManifest) -> ConnectorDefinition:
    supported_modules = tuple(manifest.supported_modules)
    streams = tuple(
        _stream_definition_from_manifest(s, supported_modules=supported_modules)
        for s in manifest.streams
    )
    return ConnectorDefinition(
        connector_key=manifest.connector_key,
        display_name=manifest.display_name,
        summary=manifest.summary,
        auth_spec=_auth_spec_from_manifest(manifest.auth),
        streams=streams,
        operations=(),
        supported_modules=supported_modules,
        base_url_template=manifest.base_url,
        icon=manifest.icon,
        color=manifest.color,
        bg_color=manifest.bg_color,
        connection_config=dict(manifest.connection_config),
    )


# ── Public registry ──────────────────────────────────────────────────────────

_MANIFESTS: Dict[str, ConnectorManifest] = {}


def register_all_manifests() -> Dict[str, ConnectorManifest]:
    """Load all manifests from disk and cache them.

    Returns the cache. Safe to call repeatedly; the dict is refreshed on each
    call so hot-edits during development are picked up.
    """
    _MANIFESTS.clear()
    _MANIFESTS.update(discover_manifests())
    return dict(_MANIFESTS)


def get_manifest(connector_key: str) -> Optional[ConnectorManifest]:
    if not _MANIFESTS:
        register_all_manifests()
    return _MANIFESTS.get(connector_key)
