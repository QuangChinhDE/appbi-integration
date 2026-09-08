"""WorkflowEngineAdapter — the single boundary that understands the engine.

Domain services depend on this Protocol and nothing else. That is what makes
"upgrade n8n" a change to one package plus a contract-test run, rather than a
change spread across the product (SRS 24.1).

Deliberately *not* named IntegrationEngineAdapter and deliberately not reusing
the pipeline product's adapter: the two engines answer different questions, and
sharing a boundary because both are called "engine" is how a workflow ends up
described as a connection between a source and a destination (SRS 38.2).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.engine.dto import (
    EngineCapabilities, EngineExecutionRef, EngineExecutionRequest,
    EngineExecutionStatus, EngineHealth, EngineValidationResult,
)


@runtime_checkable
class WorkflowEngineAdapter(Protocol):
    contract_version: str

    async def health(self) -> EngineHealth:
        """Never raises. An unreachable engine is a health answer, not an error:
        the product must stay readable while the engine is down (SRS 9.6)."""
        ...

    async def capabilities(self) -> EngineCapabilities: ...

    async def validate(
        self, request: EngineExecutionRequest
    ) -> EngineValidationResult:
        """Compile dry-run. Called before publish (SRS 27.2), never on save."""
        ...

    async def execute(self, request: EngineExecutionRequest) -> EngineExecutionRef:
        """Start a run. Idempotent on `request.idempotency_key`: a retried
        dispatch must not produce a second engine execution (SRS 27.3)."""
        ...

    async def get_execution(self, ref: str) -> EngineExecutionStatus: ...

    async def cancel(self, ref: str) -> EngineExecutionStatus:
        """Idempotent. Cancelling a run that already finished returns its
        terminal state rather than failing (SRS 16.7)."""
        ...

    async def close(self) -> None: ...
