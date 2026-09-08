"""Engine adapter factory.

One adapter instance per process: it owns an HTTP connection pool, and handing
out fresh instances per request would open a new pool per request.
"""

from __future__ import annotations

from app.core.config import settings
from app.engine.base import WorkflowEngineAdapter
from app.models.enums import EngineType

_adapter: WorkflowEngineAdapter | None = None


def get_adapter() -> WorkflowEngineAdapter:
    global _adapter
    if _adapter is None:
        # A table rather than a chain of ifs: adding an engine should be one
        # line plus a package, not an edit to control flow.
        configured = settings.engine_type.upper()
        if configured == EngineType.N8N_CORE.value:
            from app.engine.n8n_service_adapter import N8nEngineServiceAdapter

            _adapter = N8nEngineServiceAdapter()
        else:
            raise RuntimeError(
                f"ENGINE_TYPE={settings.engine_type!r} is not a known engine. "
                f"Known: {[e.value for e in EngineType]}"
            )
    return _adapter


def set_adapter(adapter: WorkflowEngineAdapter | None) -> None:
    """Test seam. Production code never calls this."""
    global _adapter
    _adapter = adapter


async def close_adapter() -> None:
    global _adapter
    if _adapter is not None:
        await _adapter.close()
        _adapter = None
