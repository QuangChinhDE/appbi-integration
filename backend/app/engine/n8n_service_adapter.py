"""The n8n engine service adapter (SRS 24.3).

Speaks the engine's internal HTTP contract and returns product DTOs. This is
the only Python module that knows the engine has a URL at all; everything above
it sees `WorkflowEngineAdapter`.

Two rules it exists to keep:

* an engine failure becomes a normalized product error, never a leaked
  exception or a raw upstream message;
* nothing that arrives here is trusted to be product-shaped without being read
  through the DTOs — a future engine version that adds a status value fails a
  contract test rather than propagating an unknown string into the database.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import (
    AppError, EngineOperationError, EngineUnavailableError, error_from_matrix,
)
from app.core.logging import log_event
from app.engine.base import WorkflowEngineAdapter
from app.engine.dto import (
    EngineCapabilities, EngineDiagnostic, EngineExecutionRef, EngineExecutionRequest,
    EngineExecutionStatus, EngineHealth, EngineLogLine, EngineNodeResult,
    EngineValidationResult,
)
from app.models.enums import ExecutionStatus, NodeRunStatus

logger = logging.getLogger(__name__)

#: Statuses the engine is allowed to report. Anything else is a contract
#: violation: mapping it to FAILED silently would hide an engine upgrade that
#: changed its vocabulary.
_ALLOWED_STATUSES = {s.value for s in ExecutionStatus}
_ALLOWED_NODE_STATUSES = {s.value for s in NodeRunStatus}


class N8nEngineServiceAdapter(WorkflowEngineAdapter):
    contract_version = "1"

    def __init__(self, base_url: str | None = None, token: str | None = None) -> None:
        self._base_url = (base_url or settings.engine_base_url).rstrip("/")
        self._token = token or settings.engine_internal_token
        self._client: httpx.AsyncClient | None = None

    # ── plumbing ───────────────────────────────────────────────────────────
    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=settings.engine_timeout_seconds,
                headers={
                    "X-Engine-Token": self._token,
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def _call(
        self, method: str, path: str, *, json_body: Any = None, timeout: float | None = None
    ) -> dict[str, Any]:
        try:
            response = await self._http().request(
                method, path, json=json_body, timeout=timeout
            )
        except httpx.TimeoutException as exc:
            raise EngineUnavailableError(
                technical_message=f"engine timeout on {method} {path}: {exc}"
            ) from exc
        except httpx.HTTPError as exc:
            raise EngineUnavailableError(
                technical_message=f"engine unreachable on {method} {path}: {exc}"
            ) from exc

        if response.status_code == 404:
            raise EngineOperationError(
                "Engine không còn thông tin về lần chạy này.",
                code="ENGINE_EXECUTION_UNKNOWN",
                technical_message=response.text[:500],
            )
        if response.status_code >= 500:
            raise EngineUnavailableError(technical_message=response.text[:500])
        if response.status_code >= 400:
            payload = _safe_json(response)
            # The engine already speaks the product's error vocabulary; if it
            # named a code we know, keep it so the UI keeps its remediation.
            code = str((payload.get("error") or {}).get("code") or "")
            if code:
                raise error_from_matrix(
                    code,
                    message=(payload.get("error") or {}).get("message"),
                    technical_message=(payload.get("error") or {}).get("technical_message"),
                )
            raise EngineOperationError(technical_message=response.text[:500])

        return _safe_json(response)

    # ── contract ───────────────────────────────────────────────────────────
    async def health(self) -> EngineHealth:
        """Answers, never raises: the health banner must render during an outage."""
        try:
            payload = await self._call("GET", "/internal/healthz", timeout=5.0)
        except AppError as exc:
            return EngineHealth(
                reachable=False, status="OFFLINE",
                message=exc.technical_message or exc.message,
            )
        return EngineHealth(
            reachable=True,
            status=str(payload.get("status") or "HEALTHY"),
            engine_version=payload.get("engine_version"),
            adapter_contract_version=payload.get("contract_version"),
            compiler_version=payload.get("compiler_version"),
            loaded_nodes=list(payload.get("loaded_nodes") or []),
            latency_ms=payload.get("latency_ms"),
            message=payload.get("message"),
        )

    async def capabilities(self) -> EngineCapabilities:
        payload = await self._call("GET", "/internal/capabilities", timeout=10.0)
        return EngineCapabilities(
            contract_version=str(payload.get("contract_version") or "1"),
            compiler_version=str(payload.get("compiler_version") or "1"),
            engine_version=str(payload.get("engine_version") or ""),
            supported_node_keys=list(payload.get("supported_node_keys") or []),
            features=dict(payload.get("features") or {}),
        )

    async def validate(self, request: EngineExecutionRequest) -> EngineValidationResult:
        payload = await self._call(
            "POST", "/internal/validate",
            json_body=_serialise_request(request, include_credentials=False),
            timeout=settings.engine_validate_timeout_seconds,
        )
        return EngineValidationResult(
            ok=bool(payload.get("ok")),
            diagnostics=[
                EngineDiagnostic(
                    code=str(d.get("code") or "WORKFLOW_INVALID"),
                    message=str(d.get("message") or ""),
                    node_id=d.get("node_id"),
                    field=d.get("field"),
                    severity=str(d.get("severity") or "ERROR"),
                )
                for d in payload.get("diagnostics") or []
            ],
            compiled_hash=payload.get("compiled_hash"),
            compiler_version=payload.get("compiler_version"),
        )

    async def execute(self, request: EngineExecutionRequest) -> EngineExecutionRef:
        payload = await self._call(
            "POST", "/internal/executions",
            json_body=_serialise_request(request, include_credentials=True),
            timeout=settings.engine_dispatch_timeout_seconds,
        )
        ref = str(payload.get("ref") or "")
        if not ref:
            raise EngineOperationError(
                technical_message="engine accepted the execution without returning a ref"
            )
        return EngineExecutionRef(ref=ref, accepted=bool(payload.get("accepted", True)))

    async def get_execution(self, ref: str) -> EngineExecutionStatus:
        payload = await self._call("GET", f"/internal/executions/{ref}")
        return _parse_status(payload)

    async def cancel(self, ref: str) -> EngineExecutionStatus:
        payload = await self._call("POST", f"/internal/executions/{ref}/cancel")
        return _parse_status(payload)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _serialise_request(
    request: EngineExecutionRequest, *, include_credentials: bool
) -> dict[str, Any]:
    """Wire form of an execution request.

    `include_credentials=False` for validation: a compile dry-run has no
    business receiving plaintext, and sending it "because the DTO has a field"
    is how a secret ends up in a log on the validation path.

    What it does send is the identity and the type, with an empty payload. The
    compiler has to know that each reference resolves and that its type maps to
    an authentication it supports; dropping the entries entirely -- which this
    did at first -- leaves every reference unresolvable, so validation reports
    `CREDENTIAL_REQUIRED` and no workflow that authenticates to anything can be
    published at all.
    """
    body = asdict(request)
    if include_credentials:
        body["credentials"] = [asdict(c) for c in request.credentials]
    else:
        body["credentials"] = [
            {
                "credential_id": item.credential_id,
                "credential_type": item.credential_type,
                "data": {},
            }
            for item in request.credentials
        ]
    return body


def _parse_status(payload: dict[str, Any]) -> EngineExecutionStatus:
    status = str(payload.get("status") or "")
    if status not in _ALLOWED_STATUSES:
        # Loud on purpose. An unknown status means the engine and the product
        # disagree about the state machine, and guessing would corrupt history.
        log_event(logger, logging.ERROR, "engine.unknown_status",
                  status=status, execution_id=payload.get("execution_id"))
        raise EngineOperationError(
            code="ENGINE_CONTRACT_VIOLATION",
            technical_message=f"engine reported unknown status {status!r}",
        )

    node_results: list[EngineNodeResult] = []
    for raw in payload.get("node_results") or []:
        node_status = str(raw.get("status") or "")
        if node_status not in _ALLOWED_NODE_STATUSES:
            log_event(logger, logging.ERROR, "engine.unknown_node_status",
                      status=node_status)
            raise EngineOperationError(
                code="ENGINE_CONTRACT_VIOLATION",
                technical_message=f"engine reported unknown node status {node_status!r}",
            )
        node_results.append(EngineNodeResult(
            node_id=str(raw.get("node_id") or ""),
            node_name=str(raw.get("node_name") or ""),
            status=node_status,
            execution_index=int(raw.get("execution_index") or 0),
            started_at=raw.get("started_at"),
            ended_at=raw.get("ended_at"),
            duration_ms=raw.get("duration_ms"),
            item_count=raw.get("item_count"),
            input_preview=raw.get("input_preview"),
            output_preview=raw.get("output_preview"),
            truncated=bool(raw.get("truncated")),
            error=raw.get("error"),
            branch_metadata=dict(raw.get("branch_metadata") or {}),
        ))

    return EngineExecutionStatus(
        ref=str(payload.get("ref") or ""),
        execution_id=str(payload.get("execution_id") or ""),
        status=status,
        started_at=payload.get("started_at"),
        ended_at=payload.get("ended_at"),
        duration_ms=payload.get("duration_ms"),
        error_code=payload.get("error_code"),
        error_category=payload.get("error_category"),
        error_message=payload.get("error_message"),
        failed_node_name=payload.get("failed_node_name"),
        node_results=node_results,
        logs=[
            EngineLogLine(
                at=str(line.get("at") or ""),
                level=str(line.get("level") or "INFO"),
                message=str(line.get("message") or ""),
                node_name=line.get("node_name"),
            )
            for line in payload.get("logs") or []
        ],
        output_summary=dict(payload.get("output_summary") or {}),
        technical=dict(payload.get("technical") or {}),
    )
