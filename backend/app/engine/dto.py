"""Data transfer objects on the engine boundary (SRS 24).

Everything crossing into or out of the engine has a shape defined here. No
`IRun`, no `INodeExecutionData`, no n8n error class ever appears in product
code — if it did, "upgrade the engine" would stop being a change to one package
and become a change spread across the product (guardrail 2).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class EngineHealth:
    reachable: bool
    status: str  # HEALTHY / DEGRADED / OFFLINE
    engine_version: str | None = None
    adapter_contract_version: str | None = None
    compiler_version: str | None = None
    message: str | None = None
    #: Loaded, allowlisted node types the engine will actually execute. Used by
    #: the compatibility screen to show drift between registry and runtime.
    loaded_nodes: list[str] = field(default_factory=list)
    latency_ms: int | None = None


@dataclass(slots=True)
class EngineCapabilities:
    contract_version: str
    compiler_version: str
    engine_version: str
    supported_node_keys: list[str]
    features: dict[str, bool] = field(default_factory=dict)


@dataclass(slots=True)
class EngineDiagnostic:
    """A compile/validate finding, already in product vocabulary."""

    code: str
    message: str
    node_id: str | None = None
    field: str | None = None
    severity: str = "ERROR"


@dataclass(slots=True)
class EngineValidationResult:
    ok: bool
    diagnostics: list[EngineDiagnostic] = field(default_factory=list)
    compiled_hash: str | None = None
    compiler_version: str | None = None


@dataclass(slots=True)
class RuntimeCredential:
    """A credential resolved for exactly one execution (SRS 12.5).

    Constructed at dispatch, handed to the engine, and not persisted anywhere on
    the engine side. `data` holds plaintext — which is why this object is never
    logged, never returned to a caller, and never stored on an execution row.
    """

    credential_id: str
    credential_type: str
    data: dict[str, Any]


@dataclass(slots=True)
class EngineExecutionRequest:
    #: The product execution id. The engine echoes it back so results can be
    #: attributed without the product holding an engine-side identity.
    execution_id: str
    workspace_ref: str
    graph: dict[str, Any]
    #: Registry snapshot: node_key -> {engine_binding, capability}. Sent with
    #: the request so a registry change cannot retroactively alter how a
    #: published version compiles.
    registry: dict[str, Any]
    start_payload: dict[str, Any] | list[Any]
    credentials: list[RuntimeCredential] = field(default_factory=list)
    trace_id: str = ""
    idempotency_key: str | None = None
    timeout_seconds: int = 1200
    #: HTTP egress policy the engine must enforce for this run (SRS 32.2).
    egress_policy: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EngineExecutionRef:
    """Opaque handle. Backend-only; never serialised to a browser."""

    ref: str
    accepted: bool = True


@dataclass(slots=True)
class EngineNodeResult:
    node_id: str
    node_name: str
    status: str  # SUCCEEDED / FAILED / RUNNING / SKIPPED
    execution_index: int = 0
    started_at: str | None = None
    ended_at: str | None = None
    duration_ms: int | None = None
    item_count: int | None = None
    input_preview: dict[str, Any] | None = None
    output_preview: dict[str, Any] | None = None
    truncated: bool = False
    error: dict[str, Any] | None = None
    branch_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EngineLogLine:
    at: str
    level: str
    message: str
    node_name: str | None = None


@dataclass(slots=True)
class EngineExecutionStatus:
    """Normalized run state. `status` is already a product status string.

    The mapping from n8n's own lifecycle happens inside the engine service, so
    there is exactly one place where a new upstream status value has to be
    handled — and a contract test that fails when one appears.
    """

    ref: str
    execution_id: str
    status: str
    started_at: str | None = None
    ended_at: str | None = None
    duration_ms: int | None = None
    error_code: str | None = None
    error_category: str | None = None
    error_message: str | None = None
    failed_node_name: str | None = None
    node_results: list[EngineNodeResult] = field(default_factory=list)
    logs: list[EngineLogLine] = field(default_factory=list)
    output_summary: dict[str, Any] = field(default_factory=dict)
    #: Admin-only diagnostics: compiler version, engine version, timings.
    technical: dict[str, Any] = field(default_factory=dict)
