"""Load declarative manifest YAML files and turn them into ConnectorDefinitions.

Each app may provide a ``manifest.yaml`` next to its Python package, e.g.::

    modules/connectors/apps/workflow/manifest.yaml

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


_APPS_ROOT = Path(__file__).resolve().parent.parent.parent / 'apps'


def _manifest_path(connector_key: str) -> Path:
    return _APPS_ROOT / connector_key / 'manifest.yaml'


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
    for child in _APPS_ROOT.iterdir():
        if not child.is_dir():
            continue
        manifest = load_manifest(child.name)
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


def _schema_fields_from_jsonschema(schema: dict) -> tuple[FieldDescriptor, ...]:
    props = schema.get('properties') if isinstance(schema, dict) else None
    if not isinstance(props, dict):
        return ()
    out: list[FieldDescriptor] = []
    for name, prop in props.items():
        json_type = prop.get('type') if isinstance(prop, dict) else None
        if isinstance(json_type, list):
            non_null = [t for t in json_type if t != 'null'] or ['string']
            field_type = str(non_null[0])
        else:
            field_type = str(json_type or 'string')
        out.append(FieldDescriptor(
            name=str(name),
            field_type=field_type,
            required=False,
            description='',
            secret=False,
            storage='runtime',
            input_kind='text',
        ))
    return tuple(out)


def _stream_definition_from_manifest(stream: ManifestStream) -> StreamDefinition:
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

    return StreamDefinition(
        stream_key=stream.name,
        display_name=stream.display_name or stream.name.title(),
        capabilities=tuple(stream.capabilities) or ('read',),
        primary_key=stream.primary_key,
        parent_stream=stream.parent_stream.name if stream.parent_stream else None,
        read_operation=None,
        write_operation=None,
        schema_fields=_schema_fields_from_jsonschema(stream.schema_),
        config_fields=config_fields,
        write_config=None,
        supported_modules=('pipeline',),
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
    streams = tuple(_stream_definition_from_manifest(s) for s in manifest.streams)
    return ConnectorDefinition(
        connector_key=manifest.connector_key,
        display_name=manifest.display_name,
        summary=manifest.summary,
        auth_spec=_auth_spec_from_manifest(manifest.auth),
        streams=streams,
        operations=(),
        supported_modules=tuple(manifest.supported_modules),
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
