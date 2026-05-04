"""Pydantic schema for declarative connector manifests.

A manifest is a single YAML file per app that describes:
  - authentication shape
  - base URL (with template variables)
  - streams: endpoint + request + pagination + record extraction + schema
  - parent streams (substreams)

The runtime (:mod:`declarative_runtime`) reads a manifest and executes it,
removing the need for per-app `connector.py` branching.

Inspired by Airbyte's low-code CDK but intentionally trimmed:
  - Template variables: ``{{ auth.x }}``, ``{{ config.x }}``, ``{{ parent.x }}``
    rendered by a simple dotted-path substitutor (no Jinja, no arbitrary code).
  - Pagination strategies: ``page_increment``, ``cursor``, or ``none``.
  - Record extraction: a dotted JSON path (e.g. ``workflows`` or ``data.items``).
  - JSON Schema subset for stream schema → auto-generates BigQuery schema.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ManifestAuthField(BaseModel):
    model_config = ConfigDict(extra='forbid')

    name: str
    type: Literal['string', 'number', 'boolean'] = 'string'
    storage: Literal['auth', 'config'] = 'auth'
    required: bool = True
    secret: bool = False
    description: str = ''
    default: Optional[Any] = None


class ManifestAuth(BaseModel):
    model_config = ConfigDict(extra='forbid')

    type: Literal['token', 'token_password', 'google_oauth', 'service_account'] = 'token'
    fields: List[ManifestAuthField] = Field(default_factory=list)


class ManifestPagination(BaseModel):
    model_config = ConfigDict(extra='forbid')

    type: Literal['none', 'page_increment', 'cursor'] = 'none'
    page_size: int = 100
    # Where to inject pagination fields: 'body' | 'params'
    inject_into: Literal['body', 'params'] = 'body'
    # Field name for the page token / page number
    page_field: Optional[str] = None
    # Field name for the page size / limit (optional)
    limit_field: Optional[str] = None
    # For cursor pagination: dotted path inside the response that holds the next token
    cursor_path: Optional[str] = None
    # For page_increment: starting page (0 or 1)
    start_from_page: int = 0
    # Max pages to fetch as a safety valve
    max_pages: int = 500


class ManifestRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    method: Literal['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] = 'GET'
    path: str
    # Headers, body, params: values are template strings rendered against
    # {auth, config, parent, cursor, page}.
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Dict[str, Any] = Field(default_factory=dict)
    params: Dict[str, Any] = Field(default_factory=dict)
    # If body carries form-encoded payload (common for Base APIs) vs JSON.
    body_format: Literal['form', 'json'] = 'form'


class ManifestParentStream(BaseModel):
    model_config = ConfigDict(extra='forbid')

    # Name of the upstream stream to iterate first.
    name: str
    # Key in each parent record to pass down.
    parent_key: str = 'id'
    # Field name in the child's rendered context: {{ parent.<partition_field> }}
    partition_field: str = 'id'


class ManifestIncremental(BaseModel):
    model_config = ConfigDict(extra='forbid')

    cursor_field: str
    # Where to inject the start value (body or params) + the field name on the wire.
    start_param: str
    inject_into: Literal['body', 'params'] = 'body'
    # Epoch-seconds / epoch-ms / ISO string. Default epoch-seconds (Base APIs).
    format: Literal['epoch_seconds', 'epoch_ms', 'iso8601'] = 'epoch_seconds'


class ManifestStream(BaseModel):
    model_config = ConfigDict(extra='forbid')

    name: str
    display_name: str = ''
    primary_key: Optional[str] = None
    capabilities: List[Literal['read', 'write']] = Field(default_factory=lambda: ['read'])
    # Marks this stream as a pipeline destination (not currently used for read streams).
    write_target_kind: Optional[Literal['tabular', 'resource', 'blob']] = None
    write_modes: List[str] = Field(default_factory=list)

    request: ManifestRequest
    # Dotted path (single string) or list of fallback paths. The first non-empty
    # list encountered wins. Use '' to take the whole response.
    record_selector: Any = ''

    pagination: ManifestPagination = Field(default_factory=ManifestPagination)
    parent_stream: Optional[ManifestParentStream] = None
    incremental: Optional[ManifestIncremental] = None

    # Inline JSON Schema (draft-07 style, subset). Used to:
    #  - expose schema_fields to the Pipeline wizard
    #  - auto-build BigQuery tables (name + BQ type derived from JSON type)
    schema_: Dict[str, Any] = Field(default_factory=dict, alias='schema')

    # Extra config fields shown on the Pipeline wizard (e.g. a custom filter).
    # The parent_stream.partition_field is handled separately and does not need
    # to appear here.
    config_fields: List[ManifestAuthField] = Field(default_factory=list)


class ManifestCheck(BaseModel):
    model_config = ConfigDict(extra='forbid')

    stream: str


class ConnectorManifest(BaseModel):
    """Top-level manifest for one connector app."""
    model_config = ConfigDict(extra='forbid')

    connector_key: str
    display_name: str
    summary: str = ''
    icon: str = ''
    color: str = ''
    bg_color: str = ''
    supported_modules: List[str] = Field(default_factory=lambda: ['backup', 'pipeline', 'automation'])

    auth: ManifestAuth
    base_url: str
    check: ManifestCheck
    streams: List[ManifestStream]

    # Optional connection_config block used by the credential UI to show
    # labels/placeholders (same shape as the legacy catalog entries).
    connection_config: Dict[str, str] = Field(default_factory=dict)
