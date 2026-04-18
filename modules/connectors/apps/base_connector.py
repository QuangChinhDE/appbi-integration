"""
Base connector class for all connector apps.

Every connector app (Service, Request, Workflow, WeWork, Google Sheets, etc.)
should subclass BaseConnector and implement the abstract methods. This provides
a uniform interface that consumer modules (Backup, Pipeline, Automation) can
rely on without knowing app-specific API details.
"""
from __future__ import annotations

import abc
from typing import Any, Mapping

from modules.connectors.backend.shared.contracts import ConnectorDefinition, StreamDefinition


class BaseConnector(abc.ABC):
    """Abstract base class for all connectors."""

    @property
    @abc.abstractmethod
    def definition(self) -> ConnectorDefinition:
        """Return the static ConnectorDefinition for this connector."""
        ...

    @abc.abstractmethod
    async def test_connection(self) -> dict[str, Any]:
        """Verify credentials are valid. Return a dict with at least {'ok': bool}."""
        ...

    async def discover_streams(self) -> list[dict[str, Any]]:
        """Return the list of available streams with their metadata.

        Default implementation returns all streams from the definition.
        Override to add runtime-discovered information (e.g. dynamic schemas).
        """
        return [stream.to_payload() for stream in self.definition.streams]

    @abc.abstractmethod
    async def read_stream(
        self,
        stream_key: str,
        *,
        config: Mapping[str, Any] | None = None,
        cursor: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Read records from a stream.

        Args:
            stream_key: Which stream to read (e.g. 'tickets', 'services').
            config: Stream-specific parameters (e.g. service_id for tickets).
            cursor: For incremental sync, the last cursor state.

        Returns:
            A list of record dicts.
        """
        ...

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Write records to a stream.

        Args:
            stream_key: Which stream to write to.
            records: The records to write.
            config: Stream-specific write configuration.

        Returns:
            A summary dict (e.g. {'written': 5, 'errors': 0}).

        Raises:
            NotImplementedError: If the stream does not support writes.
        """
        stream = self.definition.get_stream(stream_key)
        if stream is None:
            raise ValueError(f"Stream '{stream_key}' not found in connector '{self.definition.connector_key}'")
        if not stream.can_write:
            raise NotImplementedError(f"Stream '{stream_key}' does not support writes")
        raise NotImplementedError(f"write_stream not implemented for '{self.definition.connector_key}'")

    def get_stream(self, stream_key: str) -> StreamDefinition | None:
        """Look up a stream definition by key."""
        return self.definition.get_stream(stream_key)

    async def close(self) -> None:
        """Release any resources (HTTP clients, etc.). Override if needed."""
        pass

    async def __aenter__(self) -> BaseConnector:
        return self

    async def __aexit__(self, exc_type: type | None, exc: BaseException | None, tb: Any) -> None:
        await self.close()
