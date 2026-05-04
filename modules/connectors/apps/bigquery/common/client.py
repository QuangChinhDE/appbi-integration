"""
BigQuery REST client using BigQuery API v2 via httpx.
"""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Optional, Union

import httpx

from modules.connectors.apps.bigquery.common.constants import BASE_URL


BigQueryTokenSource = Union[str, Callable[[bool], Awaitable[str]]]


class BigQueryApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


async def _resolve_token(source: BigQueryTokenSource, force_refresh: bool = False) -> str:
    if callable(source):
        return await source(force_refresh)
    return source


async def _bq_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    token_source: BigQueryTokenSource,
    **kwargs: Any,
) -> httpx.Response:
    base_headers = dict(kwargs.pop("headers", {}) or {})
    attempts = 2 if callable(token_source) else 1
    response: Optional[httpx.Response] = None

    for attempt in range(attempts):
        token = await _resolve_token(token_source, force_refresh=attempt > 0)
        headers = {**base_headers, "Authorization": f"Bearer {token}"}
        response = await client.request(method, url, headers=headers, **kwargs)
        if response.status_code != 401:
            return response

    assert response is not None
    return response


def _raise_for_status(resp: httpx.Response, *, context: str) -> None:
    """Raise a BigQueryApiError with decoded error payload when possible."""
    if resp.status_code < 400:
        return
    payload: Any
    try:
        payload = resp.json()
    except Exception:
        payload = resp.text
    message = ''
    if isinstance(payload, dict):
        err = payload.get('error') or {}
        message = err.get('message') or ''
    if not message:
        message = f"BigQuery {context} failed with HTTP {resp.status_code}"
    raise BigQueryApiError(
        f"{context}: {message}",
        status_code=resp.status_code,
        payload=payload,
    )


class BigQueryClient:
    """High-level BigQuery operations using REST v2 API."""

    def __init__(self, token_source: BigQueryTokenSource, project_id: str, *, timeout: float = 60.0):
        self.token_source = token_source
        self.project_id = project_id
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "BigQueryClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    def _url(self, path: str) -> str:
        return f"{BASE_URL}/projects/{self.project_id}{path}"

    # ── Datasets ──────────────────────────────────────────────────────────

    async def list_datasets(self) -> list[dict[str, Any]]:
        """List datasets in the project."""
        client = await self._http()
        datasets: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, str] = {"maxResults": "200"}
            if page_token:
                params["pageToken"] = page_token
            resp = await _bq_request(
                client, "GET", self._url("/datasets"), self.token_source,
                params=params,
            )
            _raise_for_status(resp, context="list_datasets")
            data = resp.json()
            for ds in data.get("datasets", []):
                ref = ds.get("datasetReference", {})
                datasets.append({
                    "dataset_id": ref.get("datasetId", ""),
                    "project_id": ref.get("projectId", self.project_id),
                    "friendly_name": ds.get("friendlyName", ""),
                    "location": ds.get("location", ""),
                })
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return datasets

    # ── Tables ────────────────────────────────────────────────────────────

    async def list_tables(self, dataset_id: str) -> list[dict[str, Any]]:
        """List tables in a dataset."""
        client = await self._http()
        tables: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, str] = {"maxResults": "200"}
            if page_token:
                params["pageToken"] = page_token
            resp = await _bq_request(
                client, "GET",
                self._url(f"/datasets/{dataset_id}/tables"),
                self.token_source,
                params=params,
            )
            _raise_for_status(resp, context=f"list_tables {dataset_id}")
            data = resp.json()
            for t in data.get("tables", []):
                ref = t.get("tableReference", {})
                tables.append({
                    "table_id": ref.get("tableId", ""),
                    "dataset_id": ref.get("datasetId", dataset_id),
                    "type": t.get("type", "TABLE"),
                    "row_count": t.get("numRows"),
                    "size_bytes": t.get("numBytes"),
                    "creation_time": t.get("creationTime"),
                })
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return tables

    async def get_table_schema(self, dataset_id: str, table_id: str) -> dict[str, Any]:
        """Get table metadata and schema."""
        client = await self._http()
        resp = await _bq_request(
            client, "GET",
            self._url(f"/datasets/{dataset_id}/tables/{table_id}"),
            self.token_source,
        )
        _raise_for_status(resp, context=f"get_table_schema {dataset_id}.{table_id}")
        data = resp.json()
        schema = data.get("schema", {})
        return {
            "table_id": table_id,
            "dataset_id": dataset_id,
            "fields": schema.get("fields", []),
            "row_count": data.get("numRows"),
            "size_bytes": data.get("numBytes"),
            "type": data.get("type", "TABLE"),
        }

    async def table_exists(self, dataset_id: str, table_id: str) -> bool:
        """Return True if the table exists, False on 404, raise otherwise."""
        client = await self._http()
        resp = await _bq_request(
            client, "GET",
            self._url(f"/datasets/{dataset_id}/tables/{table_id}"),
            self.token_source,
        )
        if resp.status_code == 404:
            return False
        if resp.status_code >= 400:
            _raise_for_status(resp, context=f"table_exists {dataset_id}.{table_id}")
        return True

    async def delete_table(self, dataset_id: str, table_id: str) -> None:
        """Drop a table. No-op if it does not exist."""
        client = await self._http()
        resp = await _bq_request(
            client, "DELETE",
            self._url(f"/datasets/{dataset_id}/tables/{table_id}"),
            self.token_source,
        )
        if resp.status_code in (200, 204, 404):
            return
        _raise_for_status(resp, context=f"delete_table {dataset_id}.{table_id}")

    # ── Query / Read ──────────────────────────────────────────────────────

    async def query(
        self,
        sql: str,
        *,
        dataset_id: str | None = None,
        max_results: int = 1000,
        use_legacy_sql: bool = False,
        timeout_ms: int = 30000,
    ) -> list[dict[str, Any]]:
        """Run a query and return rows as dicts. Waits for completion."""
        client = await self._http()
        body: dict[str, Any] = {
            "query": sql,
            "useLegacySql": use_legacy_sql,
            "maxResults": max_results,
            "timeoutMs": timeout_ms,
        }
        if dataset_id:
            body["defaultDataset"] = {
                "projectId": self.project_id,
                "datasetId": dataset_id,
            }
        resp = await _bq_request(
            client, "POST", self._url("/queries"), self.token_source,
            headers={"Content-Type": "application/json"},
            json=body,
        )
        _raise_for_status(resp, context="jobs.query")
        data = resp.json()

        job_ref = data.get("jobReference") or {}
        job_id = job_ref.get("jobId")
        location = job_ref.get("location")

        # Poll until jobComplete=True — DML/DDL often returns before completion.
        while not data.get("jobComplete", False) and job_id:
            await asyncio.sleep(0.5)
            params: dict[str, str] = {"maxResults": str(max_results), "timeoutMs": str(timeout_ms)}
            if location:
                params["location"] = location
            resp = await _bq_request(
                client, "GET",
                self._url(f"/queries/{job_id}"),
                self.token_source,
                params=params,
            )
            _raise_for_status(resp, context=f"jobs.getQueryResults {job_id}")
            data = resp.json()

        fields = [f["name"] for f in data.get("schema", {}).get("fields", [])]
        rows: list[dict[str, Any]] = []
        for row in data.get("rows", []):
            values = [cell.get("v") for cell in row.get("f", [])]
            rows.append(dict(zip(fields, values)))
        return rows

    # ── Write ─────────────────────────────────────────────────────────────

    async def insert_rows(
        self,
        dataset_id: str,
        table_id: str,
        rows: list[dict[str, Any]],
        *,
        skip_invalid_rows: bool = False,
        ignore_unknown_values: bool = True,
    ) -> dict[str, Any]:
        """Insert rows using the streaming insertAll API."""
        if not rows:
            return {"inserted": 0, "errors": 0, "error_details": []}
        client = await self._http()
        insert_rows = [{"json": row} for row in rows]
        resp = await _bq_request(
            client, "POST",
            self._url(f"/datasets/{dataset_id}/tables/{table_id}/insertAll"),
            self.token_source,
            headers={"Content-Type": "application/json"},
            json={
                "rows": insert_rows,
                "skipInvalidRows": skip_invalid_rows,
                "ignoreUnknownValues": ignore_unknown_values,
            },
        )
        _raise_for_status(resp, context=f"insertAll {dataset_id}.{table_id}")
        data = resp.json()
        errors = data.get("insertErrors", [])
        return {
            "inserted": len(rows) - len(errors),
            "errors": len(errors),
            "error_details": errors[:5] if errors else [],
        }

    async def create_table(
        self,
        dataset_id: str,
        table_id: str,
        fields: list[dict[str, str]],
    ) -> dict[str, Any]:
        """Create a table with the given schema fields.
        Each field: {"name": "col", "type": "STRING", "mode": "NULLABLE"}
        """
        client = await self._http()
        resp = await _bq_request(
            client, "POST",
            self._url(f"/datasets/{dataset_id}/tables"),
            self.token_source,
            headers={"Content-Type": "application/json"},
            json={
                "tableReference": {
                    "projectId": self.project_id,
                    "datasetId": dataset_id,
                    "tableId": table_id,
                },
                "schema": {"fields": fields},
            },
        )
        _raise_for_status(resp, context=f"create_table {dataset_id}.{table_id}")
        return {"table_id": table_id, "dataset_id": dataset_id}
