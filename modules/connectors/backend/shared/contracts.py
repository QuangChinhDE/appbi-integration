from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol


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