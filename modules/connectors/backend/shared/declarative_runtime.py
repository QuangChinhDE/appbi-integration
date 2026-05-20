"""Runtime that executes a declarative connector manifest.

Given a :class:`ConnectorManifest`, build a :class:`DeclarativeRestConnector`
that implements :class:`BaseConnector`. The runtime handles:

  * Template rendering of request body / params / headers / URL base.
  * Pagination (page_increment, cursor, none).
  * Substream expansion via ``parent_stream``.
  * Record extraction by dotted path.
  * Incremental sync (epoch-seconds / epoch-ms / ISO start time).

Request auth for Base APIs typically goes into the form-encoded body as
``access_token``. For Google-OAuth style connectors we instead inject an
``Authorization: Bearer ...`` header; the manifest declares whichever mode it
needs via the ``request.headers`` / ``request.body`` template strings.
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Iterable, Mapping, Optional

import httpx

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.backend.shared.contracts import ConnectorDefinition
from modules.connectors.backend.shared.manifest import (
    ConnectorManifest,
    ManifestPagination,
    ManifestRequest,
    ManifestStream,
)


# ── Template rendering ────────────────────────────────────────────────────────
#
# Supported template syntaxes inside ``{{ ... }}`` expressions:
#
#   auth.<key>              → from binding.auth (our native form)
#   config.<key>            → from binding.config
#   config['<key>']         → Airbyte form, looked up in merged auth+config
#   config["<key>"]         → same
#   parent.<key>            → current parent record for substreams
#   stream_partition.<key>  → Airbyte alias for parent
#   stream_slice.<key>      → Airbyte alias for parent
#   page.<key>              → pagination state (index, token)
#
# A couple of common Airbyte helpers are passed through unchanged because the
# Base APIs we target do not actually need them at runtime (e.g.
# ``now_utc().strftime(...)`` only appears in incremental syncs, which we skip
# on the first pass). They simply resolve to an empty string.

_TEMPLATE_RE = re.compile(r"\{\{\s*(?P<expr>[^{}]+?)\s*\}\}")
_BRACKET_LOOKUP_RE = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_]*)\[['\"]([^'\"]+)['\"]\]$")
_DOTTED_LOOKUP_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_.]*$")


def _lookup(path: str, context: Mapping[str, Any]) -> Any:
    """Resolve ``auth.domain`` / ``parent.id`` against nested context."""
    cursor: Any = context
    for part in path.split('.'):
        if isinstance(cursor, Mapping):
            cursor = cursor.get(part)
        else:
            return None
        if cursor is None:
            return None
    return cursor


def _resolve_expression(expr: str, context: Mapping[str, Any]) -> Any:
    """Resolve a single ``{{ ... }}`` expression against the context.

    Returns ``None`` for unknown expressions so the caller can decide between
    native-None (drop field) and empty-string (string interpolation).
    """
    expr = expr.strip()
    # Airbyte aliases → native namespace
    if expr.startswith('stream_partition.'):
        return _lookup('parent.' + expr[len('stream_partition.'):], context)
    if expr.startswith('stream_slice.'):
        return _lookup('parent.' + expr[len('stream_slice.'):], context)

    # Bracket lookup: config['access_token']
    match = _BRACKET_LOOKUP_RE.match(expr)
    if match:
        namespace, key = match.group(1), match.group(2)
        # Airbyte's `config` maps to our merged auth+config lookup.
        if namespace == 'config':
            value = _lookup(f'auth.{key}', context)
            if value is None:
                value = _lookup(f'config.{key}', context)
            return value
        return _lookup(f'{namespace}.{key}', context)

    # Dotted: auth.x / config.y / parent.z / page.index
    if _DOTTED_LOOKUP_RE.match(expr):
        return _lookup(expr, context)

    # Anything else (function calls, arithmetic, jinja filters) → treat as
    # unresolved; the template substitution will render an empty string.
    return None


def render_template(value: Any, context: Mapping[str, Any]) -> Any:
    """Render template strings inside ``value`` using the given context.

    If the whole value is a single ``{{ expr }}`` match we return the native
    Python value (keeping ints/bools intact). Otherwise we fall back to string
    interpolation; unresolved expressions become an empty string.
    """
    if isinstance(value, str):
        stripped = value.strip()
        full = _TEMPLATE_RE.fullmatch(stripped)
        if full:
            return _resolve_expression(full.group('expr'), context)

        def _sub(match: re.Match[str]) -> str:
            resolved = _resolve_expression(match.group('expr'), context)
            return '' if resolved is None else str(resolved)

        return _TEMPLATE_RE.sub(_sub, value)
    if isinstance(value, Mapping):
        return {k: render_template(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [render_template(v, context) for v in value]
    return value


def _compact(data: Mapping[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if v not in (None, '')}


# ── Record extraction ─────────────────────────────────────────────────────────

def _extract_records(payload: Any, selector: Any) -> list[dict[str, Any]]:
    """Pull a list of records from a JSON response using a dotted selector.

    ``selector`` can be empty (use the whole payload), a dotted string, or a
    list of fallback selectors. Base APIs occasionally wrap results inside a
    ``data``/``result`` envelope, so we transparently unwrap one level.
    """
    selectors: list[str]
    if selector in ('', None):
        selectors = ['']
    elif isinstance(selector, list):
        selectors = [str(s) for s in selector]
    else:
        selectors = [str(selector)]

    # Peel the data/result envelope automatically if the selector would miss it.
    candidates = [payload]
    if isinstance(payload, Mapping):
        for envelope in ('data', 'result'):
            nested = payload.get(envelope)
            if nested is not None and envelope not in selectors:
                candidates.append(nested)

    for candidate in candidates:
        for path in selectors:
            value: Any = candidate
            if path:
                for part in path.split('.'):
                    if isinstance(value, Mapping):
                        value = value.get(part)
                    else:
                        value = None
                        break
            if isinstance(value, list):
                return [dict(r) for r in value if isinstance(r, Mapping)]
            if isinstance(value, Mapping):
                # Some endpoints return a single object (e.g. get-one); wrap it.
                return [dict(value)]
    return []


def _extract_cursor_token(payload: Any, path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    value: Any = payload
    for part in path.split('.'):
        if isinstance(value, Mapping):
            value = value.get(part)
        else:
            return None
    if value in (None, '', 0):
        return None
    return str(value)


# ── JSON Schema → BigQuery schema_fields ──────────────────────────────────────

_JSON_TO_BQ = {
    'string': 'STRING',
    'integer': 'INT64',
    'number': 'FLOAT64',
    'boolean': 'BOOL',
    'object': 'STRING',  # serialized JSON string
    'array': 'STRING',
    'null': 'STRING',
}


def _json_type_to_bq(json_type: Any) -> str:
    """Map a JSON Schema ``type`` (string or list) to a BigQuery type."""
    if isinstance(json_type, list):
        non_null = [t for t in json_type if t != 'null']
        if not non_null:
            return 'STRING'
        # If multiple primitive types appear, widen to STRING for safety.
        if len(non_null) > 1:
            return 'STRING'
        return _JSON_TO_BQ.get(str(non_null[0]), 'STRING')
    return _JSON_TO_BQ.get(str(json_type), 'STRING')


def build_schema_fields(schema: Mapping[str, Any]) -> list[dict[str, str]]:
    """Convert a stream's top-level JSON Schema into BigQuery field descriptors.

    Nested objects/arrays are collapsed to ``STRING`` (serialized JSON at write
    time). This keeps the warehouse table flat and predictable.
    """
    props = schema.get('properties') if isinstance(schema, Mapping) else None
    if not isinstance(props, Mapping):
        return []
    fields: list[dict[str, str]] = []
    for name, prop in props.items():
        json_type = prop.get('type') if isinstance(prop, Mapping) else None
        fields.append({
            'name': str(name),
            'type': _json_type_to_bq(json_type),
            'mode': 'NULLABLE',
        })
    return fields


# ── Declarative REST connector ────────────────────────────────────────────────

class DeclarativeRestConnector(BaseConnector):
    """Generic REST connector driven entirely by a manifest."""

    def __init__(
        self,
        manifest: ConnectorManifest,
        definition: ConnectorDefinition,
        auth: Mapping[str, Any],
        config: Mapping[str, Any],
        *,
        token_provider: Optional[Callable[[bool], Any]] = None,
        timeout: float = 60.0,
    ) -> None:
        self._manifest = manifest
        self._definition = definition
        self._auth = dict(auth or {})
        self._config = dict(config or {})
        self._token_provider = token_provider
        self._timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    # ── BaseConnector surface ─────────────────────────────────────────────

    @property
    def definition(self) -> ConnectorDefinition:
        return self._definition

    async def test_connection(self) -> dict[str, Any]:
        try:
            stream = self._find_stream(self._manifest.check.stream)
            sample = await self._read_stream_records(stream, config={}, limit_pages=1)
            return {'ok': True, 'records_preview': len(sample)}
        except Exception as exc:
            return {'ok': False, 'error': str(exc)}

    async def read_stream(
        self,
        stream_key: str,
        *,
        config: Mapping[str, Any] | None = None,
        cursor: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        stream = self._find_stream(stream_key)
        return await self._read_stream_records(
            stream,
            config=dict(config or {}),
            cursor=dict(cursor or {}) if cursor else None,
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── Internal helpers ──────────────────────────────────────────────────

    def _find_stream(self, stream_key: str) -> ManifestStream:
        for stream in self._manifest.streams:
            if stream.name == stream_key:
                return stream
        raise ValueError(f"Stream '{stream_key}' not found in manifest '{self._manifest.connector_key}'")

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, follow_redirects=True)
        return self._client

    def _base_context(self, *, extras: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
        context: dict[str, Any] = {
            'auth': dict(self._auth),
            'config': dict(self._config),
        }
        if extras:
            context.update({k: dict(v) if isinstance(v, Mapping) else v for k, v in extras.items()})
        return context

    async def _resolve_base_url(self) -> str:
        context = self._base_context()
        base = render_template(self._manifest.base_url, context)
        return str(base).rstrip('/')

    async def _read_stream_records(
        self,
        stream: ManifestStream,
        *,
        config: Mapping[str, Any],
        limit_pages: Optional[int] = None,
        cursor: Optional[Mapping[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        # Merge per-read config on top of stored binding config for template resolution.
        merged_config = {**self._config, **dict(config or {})}

        if stream.parent_stream:
            parent = self._find_stream(stream.parent_stream.name)
            # Parent streams are read non-incrementally — the cursor is for the
            # child stream that the user explicitly picked. Re-fetching the
            # parent list each run is cheap compared to syncing every job ever.
            parent_records = await self._read_stream_records(parent, config=merged_config)
            records: list[dict[str, Any]] = []
            for parent_record in parent_records:
                parent_context = {
                    stream.parent_stream.partition_field: parent_record.get(stream.parent_stream.parent_key),
                    **parent_record,
                }
                child_records = await self._execute_stream(
                    stream,
                    config=merged_config,
                    parent=parent_context,
                    limit_pages=limit_pages,
                    cursor=cursor,
                )
                records.extend(child_records)
            return records

        return await self._execute_stream(
            stream,
            config=merged_config,
            parent=None,
            limit_pages=limit_pages,
            cursor=cursor,
        )

    async def _execute_stream(
        self,
        stream: ManifestStream,
        *,
        config: Mapping[str, Any],
        parent: Optional[Mapping[str, Any]],
        limit_pages: Optional[int],
        cursor: Optional[Mapping[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        context = self._base_context(extras={
            'config': config,
            'parent': parent or {},
        })

        records: list[dict[str, Any]] = []
        page = stream.pagination.start_from_page
        max_pages = stream.pagination.max_pages if limit_pages is None else min(limit_pages, stream.pagination.max_pages)
        cursor_token: Optional[str] = None

        for _ in range(max_pages):
            page_context = {**context, 'page': {'index': page, 'token': cursor_token or ''}}
            url, method, headers, body, params = self._render_request(stream.request, page_context)
            self._apply_pagination(stream.pagination, page=page, cursor_token=cursor_token, body=body, params=params)
            self._apply_incremental(stream, cursor=cursor, body=body, params=params)
            payload = await self._send_request(method, url, headers=headers, body=body, params=params, body_format=stream.request.body_format)

            batch = _extract_records(payload, stream.record_selector)
            if not batch:
                break
            records.extend(batch)

            if stream.pagination.type == 'none':
                break
            if stream.pagination.type == 'page_increment':
                if len(batch) < stream.pagination.page_size:
                    break
                page += 1
                continue
            if stream.pagination.type == 'cursor':
                next_token = _extract_cursor_token(payload, stream.pagination.cursor_path)
                if not next_token or next_token == cursor_token:
                    break
                cursor_token = next_token
                continue
            break
        return records

    def _apply_incremental(
        self,
        stream: ManifestStream,
        *,
        cursor: Optional[Mapping[str, Any]],
        body: dict[str, Any],
        params: dict[str, Any],
    ) -> None:
        """Inject the incremental start value into the request, if both the
        manifest declares an incremental cursor and the caller passed prior state.
        """
        incr = stream.incremental
        if incr is None or not cursor:
            return
        start_value = cursor.get(incr.cursor_field)
        if start_value in (None, ''):
            return
        target = body if incr.inject_into == 'body' else params
        target[incr.start_param] = start_value

    def _render_request(
        self,
        request: ManifestRequest,
        context: Mapping[str, Any],
    ) -> tuple[str, str, dict[str, str], dict[str, Any], dict[str, Any]]:
        path = str(render_template(request.path, context) or '').lstrip('/')
        base = render_template(self._manifest.base_url, context)
        url = f"{str(base).rstrip('/')}/{path}" if path else str(base)
        headers = _compact(render_template(dict(request.headers), context))
        body = _compact(render_template(dict(request.body), context))
        params = _compact(render_template(dict(request.params), context))
        return url, request.method, headers, body, params

    def _apply_pagination(
        self,
        pagination: ManifestPagination,
        *,
        page: int,
        cursor_token: Optional[str],
        body: dict[str, Any],
        params: dict[str, Any],
    ) -> None:
        if pagination.type == 'none':
            return
        target = body if pagination.inject_into == 'body' else params
        if pagination.limit_field and pagination.page_size:
            target.setdefault(pagination.limit_field, pagination.page_size)
        if pagination.page_field is None:
            return
        if pagination.type == 'page_increment':
            target[pagination.page_field] = page
        elif pagination.type == 'cursor' and cursor_token is not None:
            target[pagination.page_field] = cursor_token

    async def _send_request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: Mapping[str, Any],
        params: Mapping[str, Any],
        body_format: str,
    ) -> Any:
        client = await self._http()
        send_headers = dict(headers)

        # If a token provider is attached (Google OAuth), set bearer header.
        if self._token_provider is not None:
            token = await self._token_provider(False)
            send_headers.setdefault('Authorization', f'Bearer {token}')

        request_kwargs: dict[str, Any] = {'headers': send_headers, 'params': dict(params) or None}
        if method in {'POST', 'PUT', 'PATCH'} and body:
            if body_format == 'form':
                request_kwargs['data'] = dict(body)
            else:
                request_kwargs['json'] = dict(body)

        resp = await client.request(method, url, **request_kwargs)

        # One retry with forced-refresh token on 401.
        if resp.status_code == 401 and self._token_provider is not None:
            token = await self._token_provider(True)
            send_headers['Authorization'] = f'Bearer {token}'
            request_kwargs['headers'] = send_headers
            resp = await client.request(method, url, **request_kwargs)

        if resp.status_code >= 400:
            detail = resp.text
            try:
                payload = resp.json()
                if isinstance(payload, Mapping):
                    err = payload.get('error') or payload.get('message') or payload
                    detail = err if isinstance(err, str) else json.dumps(err, ensure_ascii=False)
            except Exception:
                pass
            raise RuntimeError(f"HTTP {resp.status_code} for {url}: {detail}")

        try:
            return resp.json()
        except Exception:
            return resp.text
