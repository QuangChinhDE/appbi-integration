from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Protocol


# ── Stream-level architecture ─────────────────────────────────────────────────
# A connector represents an external app (e.g. Service, Google Sheets).
# Each connector exposes one or more *streams* (e.g. tickets, stages).
# Each stream declares its own capabilities (read / write) independently.
# Consumer modules (Backup, Pipeline, Automation) pick specific streams.


class WriteMode(str, Enum):
    """How a destination stream ingests records."""
    APPEND = 'append'       # Add new rows; keep existing data intact.
    REPLACE = 'replace'     # Clear target, then write all records (full-refresh).
    UPSERT = 'upsert'       # Insert new rows, update existing by primary_key.


@dataclass(frozen=True)
class WriteConfig:
    """Write-mode metadata attached to a destination stream.

    Only destination streams (GSheets rows, BigQuery rows, GDrive files, …)
    carry a WriteConfig.  Source streams with write-back (e.g. Service
    create_ticket) do NOT set this — they are not pipeline destinations.
    """
    supported_modes: tuple[str, ...] = ('append',)
    default_mode: str = 'append'
    supports_dynamic_schema: bool = True   # fields discovered at runtime
    target_kind: str = 'tabular'           # tabular, resource, blob

    def to_payload(self) -> dict[str, Any]:
        return {
            'supported_modes': list(self.supported_modes),
            'default_mode': self.default_mode,
            'supports_dynamic_schema': self.supports_dynamic_schema,
            'target_kind': self.target_kind,
        }


@dataclass(frozen=True)
class FieldDescriptor:
    """Describes a single field in a stream schema or operation input."""
    name: str
    field_type: str = 'string'
    required: bool = False
    description: str = ''
    secret: bool = False
    storage: str = 'config'     # auth, config, runtime
    input_kind: str = 'text'    # text, password, textarea, select, json


@dataclass(frozen=True)
class OperationSpec:
    """One API operation a connector can perform."""
    operation_key: str
    summary: str
    api_endpoint: str
    http_method: str = 'POST'
    required_fields: tuple[str, ...] = ()
    optional_fields: tuple[str, ...] = ()
    response_selector: str | None = None
    pagination: str | None = None  # 'page', 'cursor', or None
    capability: str = 'read'       # 'read' or 'write'

    def to_payload(self) -> dict[str, Any]:
        return {
            'operation_key': self.operation_key,
            'summary': self.summary,
            'api_endpoint': self.api_endpoint,
            'http_method': self.http_method,
            'required_fields': list(self.required_fields),
            'optional_fields': list(self.optional_fields),
            'response_selector': self.response_selector,
            'pagination': self.pagination,
            'capability': self.capability,
        }


@dataclass(frozen=True)
class StreamDefinition:
    """One logical data stream within a connector (e.g. 'tickets', 'services').

    `supported_modules` declares which consumer modules may use this stream:

      - 'pipeline' — stream returns flat structured records suitable for
        source→destination ETL to BigQuery / Sheets / SQL. Default for any
        stream whose payload is row-shaped with no heavy nested content.
      - 'backup' — stream carries unstructured or mixed content (posts,
        comments, attachments, rich details) that is meant to be archived
        to Drive/OneDrive, not shipped into a warehouse.
      - 'automation' — rarely used at stream level (automation is mostly
        driven by OperationSpec write ops). Reserved for future triggers.

    Pure-structured lists should NOT include 'backup'. Backup is explicitly
    the archive-to-Drive path for content that doesn't belong in a warehouse.
    """
    stream_key: str
    display_name: str
    capabilities: tuple[str, ...]       # ('read',), ('write',), or ('read', 'write')
    sync_modes: tuple[str, ...] = ('full_refresh',)
    cursor_field: str | None = None     # for incremental sync
    primary_key: str | None = None
    parent_stream: str | None = None    # e.g. tickets -> services
    read_operation: str | None = None   # maps to OperationSpec.operation_key
    write_operation: str | None = None
    schema_fields: tuple[FieldDescriptor, ...] = ()
    config_fields: tuple[FieldDescriptor, ...] = ()
    write_config: WriteConfig | None = None  # only set for destination streams
    supported_modules: tuple[str, ...] = ('pipeline',)

    @property
    def can_read(self) -> bool:
        return 'read' in self.capabilities

    @property
    def can_write(self) -> bool:
        return 'write' in self.capabilities

    def supports_module(self, module_key: str) -> bool:
        return module_key in self.supported_modules

    def to_payload(self) -> dict[str, Any]:
        return {
            'stream_key': self.stream_key,
            'display_name': self.display_name,
            'capabilities': list(self.capabilities),
            'sync_modes': list(self.sync_modes),
            'cursor_field': self.cursor_field,
            'primary_key': self.primary_key,
            'parent_stream': self.parent_stream,
            'read_operation': self.read_operation,
            'write_operation': self.write_operation,
            'schema_fields': [
                {
                    'name': f.name,
                    'type': f.field_type,
                    'required': f.required,
                    'description': f.description,
                    'secret': f.secret,
                    'storage': f.storage,
                    'input_kind': f.input_kind,
                }
                for f in self.schema_fields
            ],
            'config_fields': [
                {
                    'name': f.name,
                    'type': f.field_type,
                    'required': f.required,
                    'description': f.description,
                    'secret': f.secret,
                    'storage': f.storage,
                    'input_kind': f.input_kind,
                }
                for f in self.config_fields
            ],
            'write_config': self.write_config.to_payload() if self.write_config else None,
            'supported_modules': list(self.supported_modules),
        }


@dataclass(frozen=True)
class AuthSpec:
    """Authentication specification for a connector."""
    auth_type: str                      # 'token', 'google_oauth', 'service_account', 'token_password'
    fields: tuple[FieldDescriptor, ...]
    test_connection_operation: str | None = None
    supported_auth_modes: tuple[str, ...] = ()  # e.g. ('google_oauth', 'service_account')

    def to_payload(self) -> dict[str, Any]:
        return {
            'auth_type': self.auth_type,
            'fields': [
                {
                    'name': f.name,
                    'type': f.field_type,
                    'required': f.required,
                    'description': f.description,
                    'secret': f.secret,
                    'storage': f.storage,
                    'input_kind': f.input_kind,
                }
                for f in self.fields
            ],
            'test_connection_operation': self.test_connection_operation,
            'supported_auth_modes': list(self.supported_auth_modes),
        }


@dataclass(frozen=True)
class ConnectorDefinition:
    """A connector representing an external app with streams and operations."""
    connector_key: str
    display_name: str
    summary: str
    auth_spec: AuthSpec
    streams: tuple[StreamDefinition, ...]
    operations: tuple[OperationSpec, ...] = ()
    status: str = 'ready'              # 'ready', 'beta', 'planned'
    api_prefix: str = ''
    base_url_template: str = ''        # e.g. 'https://service.{domain}/extapi/v1'
    supported_modules: tuple[str, ...] = ('backup', 'pipeline', 'automation')
    notes: tuple[str, ...] = ()
    # ── UI metadata (served to frontend via catalog API) ──────────────────
    icon: str = ''                     # Lucide icon name, e.g. 'headphones', 'briefcase'
    color: str = ''                    # Primary hex color, e.g. '#059669'
    bg_color: str = ''                 # Light background hex, e.g. '#f0fdf4'
    connection_config: Mapping[str, str] = field(default_factory=dict)
    # Keys: step_title, step_description, domain_label, domain_placeholder,
    # domain_help, token_label, token_placeholder, token_help

    def get_stream(self, stream_key: str) -> StreamDefinition | None:
        for stream in self.streams:
            if stream.stream_key == stream_key:
                return stream
        return None

    def get_operation(self, operation_key: str) -> OperationSpec | None:
        for op in self.operations:
            if op.operation_key == operation_key:
                return op
        return None

    def get_readable_streams(self) -> tuple[StreamDefinition, ...]:
        return tuple(s for s in self.streams if s.can_read)

    def get_writable_streams(self) -> tuple[StreamDefinition, ...]:
        return tuple(s for s in self.streams if s.can_write)

    def get_destination_streams(self) -> tuple[StreamDefinition, ...]:
        """Streams with write_config — true pipeline destinations (not write-back)."""
        return tuple(s for s in self.streams if s.write_config is not None)

    def get_backup_streams(self) -> tuple[StreamDefinition, ...]:
        """Readable streams approved for backup (unstructured or mixed content)."""
        return tuple(
            s for s in self.streams
            if s.can_read and s.supports_module('backup')
        )

    def get_pipeline_source_streams(self) -> tuple[StreamDefinition, ...]:
        """Readable streams exposed to the Pipeline wizard.

        Policy: every readable stream is pickable — the pipeline wizard lets
        the user supply the required `config_fields` (e.g. workflow_id) so
        parent-scoped endpoints (stages, posts, comments, ticket_details, …)
        are valid sources as long as the user provides the parent id. This
        matches the Airbyte-style "any endpoint is a stream" model.
        """
        return tuple(s for s in self.streams if s.can_read)

    def get_pipeline_destination_streams(self) -> tuple[StreamDefinition, ...]:
        """Streams that are valid pipeline destinations.

        Pipeline accepts both tabular (spreadsheets/tables) and resource
        (tickets/jobs/projects) destinations. Blob destinations are excluded
        — they are for backup, not row-level pipeline transfer.
        """
        return tuple(
            s
            for s in self.streams
            if s.write_config is not None and s.write_config.target_kind in ('tabular', 'resource')
        )

    def supports_module(self, module_key: str) -> bool:
        return module_key in self.supported_modules

    @property
    def is_destination(self) -> bool:
        """True if this connector has at least one destination stream."""
        return any(s.write_config for s in self.streams)

    def to_payload(self, *, credential_count: int = 0) -> dict[str, Any]:
        return {
            'connector_key': self.connector_key,
            'display_name': self.display_name,
            'summary': self.summary,
            'status': self.status,
            'credential_count': credential_count,
            'auth_spec': self.auth_spec.to_payload(),
            'streams': [s.to_payload() for s in self.streams],
            'supported_modules': list(self.supported_modules),
            'notes': list(self.notes),
            'icon': self.icon,
            'color': self.color,
            'bg_color': self.bg_color,
            'connection_config': dict(self.connection_config),
        }

    # ── Backward-compatible adapters ──────────────────────────────────────
    # These generate the legacy SourceReaderDefinition / DestinationWriterDefinition
    # payloads so existing Pipeline and Backup UIs keep working during transition.

    def as_source_reader_payload(
        self,
        *,
        credential_count: int = 0,
        module_key: str = 'pipeline',
    ) -> dict[str, Any]:
        if module_key == 'pipeline':
            # Pipeline exposes every readable stream. See get_pipeline_source_streams.
            readable = self.get_pipeline_source_streams()
        else:
            readable = tuple(
                s for s in self.get_readable_streams()
                if s.supports_module(module_key)
            )
        all_sync_modes: set[str] = set()
        for s in readable:
            all_sync_modes.update(s.sync_modes)

        return {
            'key': f'{self.connector_key}_reader',
            'app_id': self.connector_key,
            'app_name': self.display_name,
            'summary': self.summary,
            'binding_source': 'apps',
            'binding_fields': [f.name for f in self.auth_spec.fields],
            'sync_modes': sorted(all_sync_modes),
            'credential_count': credential_count,
            'status': self.status,
            'selection_label': f'Select a saved {self.display_name} credential from Apps.',
            'notes': list(self.notes),
            'discovery': {
                'mode': 'catalog_preview',
                'status': self.status,
                'summary': f'Shared discovery can enumerate streams from the saved {self.display_name} binding.',
                'selection_label': f'Select a saved {self.display_name} credential from Apps, then load discovery from the shared connector layer.',
            },
            'streams': [s.to_payload() for s in readable],
        }

    def as_destination_writer_payload(
        self,
        *,
        credential_count: int = 0,
        module_key: str = 'pipeline',
    ) -> dict[str, Any]:
        writable = tuple(
            s for s in self.get_pipeline_destination_streams()
            if s.supports_module(module_key)
        )
        return {
            'key': f'{self.connector_key}_writer',
            'app_id': self.connector_key,
            'app_name': self.display_name,
            'summary': self.summary,
            'binding_source': 'apps' if self.status == 'ready' else 'planned',
            'auth_modes': list(self.auth_spec.supported_auth_modes) or [self.auth_spec.auth_type],
            'credential_count': credential_count,
            'status': self.status,
            'selection_label': f'Select a saved {self.display_name} destination profile from Apps.',
            'notes': list(self.notes),
            'streams': [s.to_payload() for s in writable],
        }


# ── Legacy types (kept for backward compatibility during transition) ──────────


@dataclass(frozen=True)
class DiscoveryContract:
    mode: str
    status: str
    summary: str
    selection_label: str

    def to_payload(self) -> dict[str, Any]:
        return {
            'mode': self.mode,
            'status': self.status,
            'summary': self.summary,
            'selection_label': self.selection_label,
        }


@dataclass(frozen=True)
class SourceReaderDefinition:
    reader_key: str
    app_id: str
    app_name: str
    summary: str
    binding_source: str
    binding_fields: tuple[str, ...]
    sync_modes: tuple[str, ...]
    discovery: DiscoveryContract
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_payload(self, *, credential_count: int = 0) -> dict[str, Any]:
        return {
            'key': self.reader_key,
            'app_id': self.app_id,
            'app_name': self.app_name,
            'summary': self.summary,
            'binding_source': self.binding_source,
            'binding_fields': list(self.binding_fields),
            'sync_modes': list(self.sync_modes),
            'credential_count': credential_count,
            'status': self.discovery.status,
            'selection_label': self.discovery.selection_label,
            'notes': list(self.notes),
            'discovery': self.discovery.to_payload(),
        }


@dataclass(frozen=True)
class DestinationWriterDefinition:
    writer_key: str
    app_id: str
    app_name: str
    summary: str
    binding_source: str
    auth_modes: tuple[str, ...]
    status: str
    selection_label: str
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_payload(self, *, credential_count: int = 0) -> dict[str, Any]:
        return {
            'key': self.writer_key,
            'app_id': self.app_id,
            'app_name': self.app_name,
            'summary': self.summary,
            'binding_source': self.binding_source,
            'auth_modes': list(self.auth_modes),
            'credential_count': credential_count,
            'status': self.status,
            'selection_label': self.selection_label,
            'notes': list(self.notes),
        }


class SourceReaderContract(Protocol):
    definition: SourceReaderDefinition

    def validate_binding(self, auth: Mapping[str, Any], config: Mapping[str, Any]) -> None:
        ...


class DestinationWriterContract(Protocol):
    definition: DestinationWriterDefinition

    def validate_target(self, auth: Mapping[str, Any], config: Mapping[str, Any]) -> None:
        ...
