"""Convert an Airbyte ``DeclarativeSource`` YAML into our ConnectorManifest.

The goal is: let users drop an Airbyte low-code manifest at
``modules/connectors/apps/<key>/manifest.yaml`` and have the Pipeline module
pick up every stream declared there, one-to-one, without manual bridging.

We support the subset that Base and Google-style APIs actually need:

  * SimpleRetriever + HttpRequester
  * DpathExtractor (``record_selector.extractor.field_path``)
  * DefaultPaginator with ``PageIncrement`` or ``CursorPagination``
  * SubstreamPartitionRouter (single-parent)
  * InlineSchemaLoader with ``$ref: '#/schemas/<name>'``
  * Request injection: ``body_data``, ``request_parameter``, ``header``

Unsupported pieces (e.g. ``DatetimeBasedCursor``, OAuth authenticators) are
ignored on the first pass — the Pipeline module still sees the stream and
reads it in full-refresh mode. This keeps the system forgiving: the user
pastes an Airbyte manifest, and streams that rely on advanced features simply
run without that feature rather than failing to load.

An optional top-level ``appbi:`` block supplies the small amount of extra
metadata our registry needs (connector_key, display_name, colors, and an
optional ``base_url`` template that overrides ``definitions.base_requester.url_base``
so the per-tenant domain can be substituted from the stored credential).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Mapping, Optional

from modules.connectors.backend.shared.manifest import (
    ConnectorManifest,
    ManifestAuth,
    ManifestAuthField,
    ManifestCheck,
    ManifestPagination,
    ManifestParentStream,
    ManifestRequest,
    ManifestStream,
)

logger = logging.getLogger(__name__)


# ── $ref resolution ──────────────────────────────────────────────────────────

def _resolve_ref(doc: Mapping[str, Any], ref: str) -> Any:
    """Resolve a single ``#/foo/bar`` pointer against the root document."""
    if not ref.startswith('#/'):
        return None
    cursor: Any = doc
    for part in ref[2:].split('/'):
        if isinstance(cursor, Mapping):
            cursor = cursor.get(part)
        else:
            return None
    return cursor


def _expand_refs(node: Any, doc: Mapping[str, Any], depth: int = 0) -> Any:
    """Recursively replace ``{ $ref: '#/...' }`` with the resolved target.

    We merge any sibling keys on top of the referenced value (mirroring what
    Airbyte's low-code runtime does for the ``$ref`` shortcut on requesters).
    """
    if depth > 50:
        return node
    if isinstance(node, Mapping):
        ref = node.get('$ref')
        if isinstance(ref, str):
            target = _resolve_ref(doc, ref)
            target = _expand_refs(target, doc, depth + 1)
            if isinstance(target, Mapping):
                merged: dict[str, Any] = dict(target)
                for key, value in node.items():
                    if key == '$ref':
                        continue
                    merged[key] = _expand_refs(value, doc, depth + 1)
                return merged
            return target
        return {k: _expand_refs(v, doc, depth + 1) for k, v in node.items() if k != '$ref'}
    if isinstance(node, list):
        return [_expand_refs(v, doc, depth + 1) for v in node]
    return node


# ── Airbyte → internal mapping helpers ───────────────────────────────────────

_INJECT_MAP = {
    'body_data': 'body',
    'body_json': 'body',
    'request_parameter': 'params',
    'header': 'headers',
}


def _inject_target(airbyte_target: Optional[str]) -> str:
    return _INJECT_MAP.get(str(airbyte_target or ''), 'body')


def _extract_field_path(extractor: Any) -> Any:
    """Return the record selector path in our format.

    Airbyte's ``field_path`` is a list of path segments; we join with dots.
    Some Airbyte manifests use a single string or an empty list (whole body).
    """
    if not isinstance(extractor, Mapping):
        return ''
    path = extractor.get('field_path')
    if isinstance(path, list):
        if not path:
            return ''
        return '.'.join(str(p) for p in path)
    if isinstance(path, str):
        return path
    return ''


def _build_pagination(paginator: Any) -> ManifestPagination:
    if not isinstance(paginator, Mapping):
        return ManifestPagination(type='none')

    strategy = paginator.get('pagination_strategy') or {}
    page_size_option = paginator.get('page_size_option') or {}
    page_token_option = paginator.get('page_token_option') or {}

    inject_into = _inject_target(page_token_option.get('inject_into') or page_size_option.get('inject_into'))
    page_field = page_token_option.get('field_name')
    limit_field = page_size_option.get('field_name')

    strategy_type = strategy.get('type')
    if strategy_type == 'PageIncrement':
        return ManifestPagination(
            type='page_increment',
            page_size=int(strategy.get('page_size') or 100),
            inject_into=inject_into,
            page_field=page_field,
            limit_field=limit_field,
            start_from_page=int(strategy.get('start_from_page') or 0),
        )
    if strategy_type == 'OffsetIncrement':
        return ManifestPagination(
            type='page_increment',
            page_size=int(strategy.get('page_size') or 100),
            inject_into=inject_into,
            page_field=page_field,
            limit_field=limit_field,
            start_from_page=0,
        )
    if strategy_type == 'CursorPagination':
        # Airbyte expresses the cursor via a jinja ``cursor_value`` expression;
        # we extract a dotted JSON path from it when possible.
        cursor_value = str(strategy.get('cursor_value') or '').strip()
        cursor_path: Optional[str] = None
        if cursor_value.startswith('{{') and cursor_value.endswith('}}'):
            inner = cursor_value[2:-2].strip()
            # Typical form: response.next_page_token or response['next_page_token']
            if inner.startswith('response.'):
                cursor_path = inner[len('response.'):]
            elif inner.startswith("response['") and inner.endswith("']"):
                cursor_path = inner[len("response['"):-2]
        return ManifestPagination(
            type='cursor',
            page_size=int(strategy.get('page_size') or 100),
            inject_into=inject_into,
            page_field=page_field,
            limit_field=limit_field,
            cursor_path=cursor_path,
        )
    return ManifestPagination(type='none')


def _build_parent_stream(partition_router: Any) -> Optional[ManifestParentStream]:
    if not isinstance(partition_router, Mapping):
        return None
    if partition_router.get('type') not in ('SubstreamPartitionRouter', None):
        return None
    configs = partition_router.get('parent_stream_configs') or []
    if not configs:
        return None
    first = configs[0]
    if not isinstance(first, Mapping):
        return None
    stream = first.get('stream') or {}
    parent_name = (
        stream.get('name') if isinstance(stream, Mapping) else None
    ) or first.get('parent_stream_name')
    if not parent_name:
        return None
    return ManifestParentStream(
        name=str(parent_name),
        parent_key=str(first.get('parent_key') or 'id'),
        partition_field=str(first.get('partition_field') or 'id'),
    )


def _build_request(requester: Mapping[str, Any], base_url: str) -> ManifestRequest:
    """Translate an Airbyte ``HttpRequester`` to our ManifestRequest."""
    method = str(requester.get('http_method') or 'POST').upper()
    path = str(requester.get('path') or '').lstrip('/')
    headers = requester.get('request_headers') or {}
    body_data = requester.get('request_body_data')
    body_json = requester.get('request_body_json')
    params = requester.get('request_parameters') or {}

    body: Dict[str, Any]
    body_format: str
    if isinstance(body_json, Mapping):
        body = dict(body_json)
        body_format = 'json'
    elif isinstance(body_data, Mapping):
        body = dict(body_data)
        body_format = 'form'
    elif isinstance(body_data, str):
        # Airbyte allows a raw Jinja body template; we don't support it
        # (rare in practice). Fall back to an empty form body.
        body = {}
        body_format = 'form'
    else:
        body = {}
        body_format = 'form'

    return ManifestRequest(
        method=method if method in {'GET', 'POST', 'PUT', 'PATCH', 'DELETE'} else 'POST',
        path=path,
        headers={str(k): str(v) for k, v in (headers or {}).items()},
        body=body,
        params=dict(params),
        body_format=body_format,
    )


def _build_stream(raw: Mapping[str, Any], base_url: str) -> Optional[ManifestStream]:
    retriever = raw.get('retriever') or {}
    if not isinstance(retriever, Mapping):
        return None

    requester = retriever.get('requester') or {}
    if not isinstance(requester, Mapping):
        return None

    record_selector = retriever.get('record_selector') or {}
    extractor = record_selector.get('extractor') if isinstance(record_selector, Mapping) else None
    selector = _extract_field_path(extractor)

    paginator = retriever.get('paginator')
    pagination = _build_pagination(paginator)

    partition_router = retriever.get('partition_router')
    parent = _build_parent_stream(partition_router)

    request = _build_request(requester, base_url=base_url)

    schema_loader = raw.get('schema_loader') or {}
    schema: Dict[str, Any] = {}
    if isinstance(schema_loader, Mapping):
        inline = schema_loader.get('schema')
        if isinstance(inline, Mapping):
            schema = dict(inline)

    primary_key = raw.get('primary_key')
    if isinstance(primary_key, list):
        primary_key_value = str(primary_key[0]) if primary_key else None
    elif isinstance(primary_key, str):
        primary_key_value = primary_key
    else:
        primary_key_value = None

    return ManifestStream(
        name=str(raw.get('name') or ''),
        display_name=str(raw.get('name') or '').replace('_', ' ').title(),
        primary_key=primary_key_value,
        capabilities=['read'],
        request=request,
        record_selector=selector,
        pagination=pagination,
        parent_stream=parent,
        schema=schema,
    )


# ── Entry point ──────────────────────────────────────────────────────────────

def is_airbyte_manifest(doc: Mapping[str, Any]) -> bool:
    return str(doc.get('type') or '').lower() == 'declarativesource'


def convert_airbyte_manifest(doc: Mapping[str, Any]) -> ConnectorManifest:
    """Convert a raw Airbyte DeclarativeSource mapping into a ConnectorManifest.

    The function is strict enough to surface obvious errors (missing streams,
    empty check) but lenient about optional pieces (incremental sync, advanced
    authenticators) which we simply ignore.
    """
    appbi = doc.get('appbi') or {}
    if not isinstance(appbi, Mapping):
        appbi = {}

    expanded = _expand_refs(doc, doc)

    # url_base: either from definitions.base_requester.url_base or overridden by appbi.base_url.
    definitions = expanded.get('definitions') or {}
    base_requester = definitions.get('base_requester') if isinstance(definitions, Mapping) else None
    url_base = ''
    if isinstance(base_requester, Mapping):
        url_base = str(base_requester.get('url_base') or '')
    base_url = str(appbi.get('base_url') or url_base).rstrip('/')

    streams_section = expanded.get('streams') or []
    if not isinstance(streams_section, list):
        streams_section = []

    # Each stream under top-level `streams` is the fully-expanded form (after
    # $ref resolution). Build ManifestStream for every one, in declared order.
    streams: List[ManifestStream] = []
    for raw in streams_section:
        if not isinstance(raw, Mapping):
            continue
        stream = _build_stream(raw, base_url=base_url)
        if stream is not None and stream.name:
            streams.append(stream)

    if not streams:
        raise ValueError("Airbyte manifest has no usable streams after conversion")

    # Check: use declared stream or first stream.
    check_section = expanded.get('check') or {}
    check_stream: Optional[str] = None
    if isinstance(check_section, Mapping):
        names = check_section.get('stream_names') or []
        if isinstance(names, list) and names:
            check_stream = str(names[0])
    if not check_stream:
        check_stream = streams[0].name

    # Auth: take from appbi.auth if provided; otherwise derive from spec.
    auth = _build_auth(appbi.get('auth'), expanded.get('spec'))

    connector_key = str(appbi.get('connector_key') or '')
    if not connector_key:
        raise ValueError("Manifest is missing appbi.connector_key")

    return ConnectorManifest(
        connector_key=connector_key,
        display_name=str(appbi.get('display_name') or connector_key.title()),
        summary=str(appbi.get('summary') or ''),
        icon=str(appbi.get('icon') or ''),
        color=str(appbi.get('color') or ''),
        bg_color=str(appbi.get('bg_color') or ''),
        supported_modules=list(appbi.get('supported_modules') or ['backup', 'pipeline', 'automation']),
        auth=auth,
        base_url=base_url or str(appbi.get('base_url') or ''),
        check=ManifestCheck(stream=check_stream),
        streams=streams,
        connection_config=dict(appbi.get('connection_config') or {}),
    )


def _build_auth(appbi_auth: Any, spec: Any) -> ManifestAuth:
    """Build a ManifestAuth.

    Priority:
      1. Use ``appbi.auth`` if the caller explicitly defined fields (this is
         the recommended path for Base-style APIs where the access_token lives
         in the stored credential, not in the pipeline wizard).
      2. Otherwise synthesize a ManifestAuth from the Airbyte ``spec`` block
         so at least the required field names are known.
    """
    if isinstance(appbi_auth, Mapping):
        fields_raw = appbi_auth.get('fields') or []
        fields: list[ManifestAuthField] = []
        for raw in fields_raw:
            if not isinstance(raw, Mapping):
                continue
            fields.append(ManifestAuthField(
                name=str(raw.get('name') or ''),
                type=str(raw.get('type') or 'string'),  # type: ignore[arg-type]
                storage=str(raw.get('storage') or 'auth'),  # type: ignore[arg-type]
                required=bool(raw.get('required', True)),
                secret=bool(raw.get('secret', False)),
                description=str(raw.get('description') or ''),
                default=raw.get('default'),
            ))
        return ManifestAuth(
            type=str(appbi_auth.get('type') or 'token'),  # type: ignore[arg-type]
            fields=fields,
        )

    if isinstance(spec, Mapping):
        connection_spec = spec.get('connection_specification') or {}
        if isinstance(connection_spec, Mapping):
            required = set(connection_spec.get('required') or [])
            props = connection_spec.get('properties') or {}
            fields = []
            for name, prop in props.items():
                if not isinstance(prop, Mapping):
                    continue
                secret = bool(prop.get('airbyte_secret'))
                fields.append(ManifestAuthField(
                    name=str(name),
                    type='string',
                    storage='auth' if secret else 'config',
                    required=name in required,
                    secret=secret,
                    description=str(prop.get('title') or ''),
                ))
            return ManifestAuth(type='token', fields=fields)

    return ManifestAuth(type='token', fields=[])
