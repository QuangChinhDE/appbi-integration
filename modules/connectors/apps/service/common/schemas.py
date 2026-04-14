from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _normalize_csv(value: Any) -> str | None:
    if value is None:
        return None

    if isinstance(value, str):
        parts = [part.strip() for part in value.split(",") if part.strip()]
        return ",".join(parts) or None

    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        parts = [str(item).strip() for item in value if str(item).strip()]
        return ",".join(parts) or None

    text = str(value).strip()
    return text or None


def _normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        items = [part.strip() for part in value.split(",") if part.strip()]
    elif isinstance(value, Iterable) and not isinstance(value, (str, bytes, bytearray, Mapping)):
        items = [str(item).strip() for item in value if str(item).strip()]
    else:
        raise TypeError("Expected a comma-separated string or iterable of strings")

    seen: set[str] = set()
    normalized: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    return normalized


def _normalize_prefixed_fields(value: Any, prefix: str) -> dict[str, Any]:
    if value is None:
        return {}

    if isinstance(value, Mapping):
        items = value.items()
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        extracted: list[tuple[str, Any]] = []
        for entry in value:
            if not isinstance(entry, Mapping):
                raise TypeError("Custom fields must be mappings or name/value entries")
            raw_name = str(entry.get("name", "")).strip()
            if not raw_name:
                continue
            extracted.append((raw_name, entry.get("value")))
        items = extracted
    else:
        raise TypeError("Custom fields must be a mapping or a list of name/value entries")

    normalized: dict[str, Any] = {}
    for raw_name, raw_value in items:
        field_name = str(raw_name).strip()
        if not field_name or raw_value is None or raw_value == "":
            continue
        if not field_name.startswith(prefix):
            field_name = f"{prefix}{field_name}"
        normalized[field_name] = raw_value
    return normalized


class ServiceConnectorInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    def cleaned_dump(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class ServiceBlocksInput(ServiceConnectorInput):
    service_id: str = Field(..., description="Service identifier")


class ServiceTicketsInput(ServiceConnectorInput):
    service_id: str = Field(..., description="Service identifier")


class TicketDetailsInput(ServiceConnectorInput):
    ticket_id: str = Field(..., description="Ticket root identifier")


class TicketTransitionInput(ServiceConnectorInput):
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str = Field(..., description="Username performing the action")


class TicketActivityLogFilters(ServiceConnectorInput):
    absolute_time: int | None = Field(
        default=None,
        ge=0,
        le=1,
        description="Use 1 for absolute timestamps and 0 for relative timestamps",
    )
    item_per_page: int | None = Field(
        default=None,
        ge=1,
        description="Maximum number of activity log records per page",
    )
    last_update_from: int | None = Field(
        default=None,
        ge=0,
        description="Inclusive start Unix timestamp",
    )
    last_update_to: int | None = Field(
        default=None,
        ge=0,
        description="Inclusive end Unix timestamp",
    )

    @model_validator(mode="after")
    def validate_range(self) -> "TicketActivityLogFilters":
        if (
            self.last_update_from is not None
            and self.last_update_to is not None
            and self.last_update_from > self.last_update_to
        ):
            raise ValueError("last_update_from must be less than or equal to last_update_to")
        return self


class CreateTicketInput(ServiceConnectorInput):
    username: str = Field(..., description="Username creating the ticket")
    service_id: str = Field(..., description="Target service identifier")
    block_id: str = Field(..., description="Target block identifier")
    name: str = Field(..., description="Ticket title")
    assignees: str | None = Field(
        default=None,
        description="Comma-separated usernames or list of assignees",
    )
    followers: str | None = Field(
        default=None,
        description="Comma-separated usernames or list of followers",
    )
    managers: str | None = Field(
        default=None,
        description="Comma-separated usernames or list of managers",
    )
    root_content: str | None = Field(default=None, description="Ticket description")
    custom_fields: dict[str, Any] = Field(
        default_factory=dict,
        description="Service custom field values keyed without or with the service_ prefix",
    )

    @field_validator("assignees", "followers", "managers", mode="before")
    @classmethod
    def normalize_csv_fields(cls, value: Any) -> str | None:
        return _normalize_csv(value)

    @field_validator("custom_fields", mode="before")
    @classmethod
    def normalize_custom_fields(cls, value: Any) -> dict[str, Any]:
        return _normalize_prefixed_fields(value, "service_")


class UpdateTicketInput(ServiceConnectorInput):
    service_id: str = Field(..., description="Target service identifier")
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str = Field(..., description="Username updating the ticket")
    name: str = Field(..., description="Updated ticket title")
    assignees: str | None = Field(default=None, description="Updated assignees")
    current_ticket_block_id: str | None = Field(
        default=None,
        description="Current block identifier when the API cannot infer it",
    )
    followers: str | None = Field(default=None, description="Updated followers")
    root_content: str | None = Field(default=None, description="Updated ticket description")

    @field_validator("assignees", "followers", mode="before")
    @classmethod
    def normalize_update_csv_fields(cls, value: Any) -> str | None:
        return _normalize_csv(value)

    def to_client_payload(self) -> dict[str, Any]:
        payload = self.cleaned_dump()
        optional_fields = {
            key: payload[key]
            for key in ("assignees", "current_ticket_block_id", "followers", "root_content")
            if key in payload
        }
        return {
            "service_id": self.service_id,
            "ticket_id": self.ticket_id,
            "username": self.username,
            "name": self.name,
            "update_fields": optional_fields or None,
        }


class UpdateTicketCustomFieldsInput(ServiceConnectorInput):
    service_id: str = Field(..., description="Target service identifier")
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str = Field(..., description="Username updating ticket custom fields")
    custom_field_ids: str = Field(
        ...,
        description="Comma-separated field identifiers required by the Service API",
    )
    custom_fields: dict[str, Any] = Field(
        default_factory=dict,
        description="Service custom field values keyed without or with the service_ prefix",
    )

    @field_validator("custom_field_ids", mode="before")
    @classmethod
    def normalize_custom_field_ids(cls, value: Any) -> str | None:
        return _normalize_csv(value)

    @field_validator("custom_fields", mode="before")
    @classmethod
    def normalize_ticket_custom_fields(cls, value: Any) -> dict[str, Any]:
        return _normalize_prefixed_fields(value, "service_")


class AssignTicketInput(ServiceConnectorInput):
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str = Field(..., description="Username assigning the ticket")
    assignees: str = Field(..., description="Assigned usernames")

    @field_validator("assignees", mode="before")
    @classmethod
    def normalize_assignees(cls, value: Any) -> str | None:
        return _normalize_csv(value)


ExecuteIntent = Literal["approve", "ask", "mark_done", "mark_failed", "reject"]


class ExecuteTicketInput(ServiceConnectorInput):
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str = Field(..., description="Username executing the ticket")
    current_ticket_block_id: str | None = Field(
        default=None,
        description="Current block identifier when the API cannot infer it",
    )
    custom_field_ids: str | None = Field(
        default=None,
        description="Comma-separated field identifiers required for execution",
    )
    intent: ExecuteIntent | None = Field(
        default=None,
        description="Special execution intent such as approve, reject, or mark_done",
    )
    name: str | None = Field(default=None, description="Updated ticket title")
    note: str | None = Field(default=None, description="Execution note")
    ticket_custom_fields: dict[str, Any] = Field(
        default_factory=dict,
        description="Ticket custom field values keyed without or with the service_ prefix",
    )
    block_custom_fields: dict[str, Any] = Field(
        default_factory=dict,
        description="Current block custom field values keyed without or with the custom_ prefix",
    )

    @field_validator("custom_field_ids", mode="before")
    @classmethod
    def normalize_execute_custom_field_ids(cls, value: Any) -> str | None:
        return _normalize_csv(value)

    @field_validator("ticket_custom_fields", mode="before")
    @classmethod
    def normalize_execute_ticket_custom_fields(cls, value: Any) -> dict[str, Any]:
        return _normalize_prefixed_fields(value, "service_")

    @field_validator("block_custom_fields", mode="before")
    @classmethod
    def normalize_execute_block_custom_fields(cls, value: Any) -> dict[str, Any]:
        return _normalize_prefixed_fields(value, "custom_")

    def to_client_payload(self) -> dict[str, Any]:
        additional_fields = {
            key: value
            for key, value in {
                "current_ticket_block_id": self.current_ticket_block_id,
                "custom_field_ids": self.custom_field_ids,
                "intent": self.intent,
                "name": self.name,
                "note": self.note,
            }.items()
            if value is not None
        }
        return {
            "ticket_id": self.ticket_id,
            "username": self.username,
            "additional_fields": additional_fields or None,
            "ticket_custom_fields": self.ticket_custom_fields or None,
            "block_custom_fields": self.block_custom_fields or None,
        }


class MoveTicketToBlockInput(ServiceConnectorInput):
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str = Field(..., description="Username moving the ticket")
    next_block_id: str = Field(..., description="Destination block identifier")
    assignees: str | None = Field(default=None, description="Assignees for the destination block")
    current_ticket_block_id: str | None = Field(
        default=None,
        description="Current block identifier when the API cannot infer it",
    )
    managers: str | None = Field(default=None, description="Managers required by approval blocks")

    @field_validator("assignees", "managers", mode="before")
    @classmethod
    def normalize_move_csv_fields(cls, value: Any) -> str | None:
        return _normalize_csv(value)

    def to_client_payload(self) -> dict[str, Any]:
        additional_fields = {
            key: value
            for key, value in {
                "assignees": self.assignees,
                "current_ticket_block_id": self.current_ticket_block_id,
                "managers": self.managers,
            }.items()
            if value is not None
        }
        return {
            "ticket_id": self.ticket_id,
            "username": self.username,
            "next_block_id": self.next_block_id,
            "additional_fields": additional_fields or None,
        }


class MoveTicketBackInput(ServiceConnectorInput):
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str = Field(..., description="Username moving the ticket")
    current_ticket_block_id: str | None = Field(
        default=None,
        description="Current block identifier when the API cannot infer it",
    )

    def to_client_payload(self) -> dict[str, Any]:
        additional_fields = (
            {"current_ticket_block_id": self.current_ticket_block_id}
            if self.current_ticket_block_id is not None
            else None
        )
        return {
            "ticket_id": self.ticket_id,
            "username": self.username,
            "additional_fields": additional_fields,
        }


class ExtractServiceInventoryInput(ServiceConnectorInput):
    service_id: str = Field(..., description="Service identifier")


class ExtractTicketInput(ServiceConnectorInput):
    ticket_id: str = Field(..., description="Ticket root identifier")
    username: str | None = Field(
        default=None,
        description="Username required when include_possible_actions is enabled",
    )
    include_possible_actions: bool = Field(
        default=False,
        description="Fetch possible transition actions for the ticket",
    )
    activity_log_filters: TicketActivityLogFilters | None = Field(
        default=None,
        description="Optional filters for activity log extraction",
    )

    @model_validator(mode="after")
    def validate_action_lookup(self) -> "ExtractTicketInput":
        if self.include_possible_actions and not self.username:
            raise ValueError("username is required when include_possible_actions is true")
        return self


class ExtractSnapshotInput(ServiceConnectorInput):
    service_ids: list[str] = Field(..., description="Services to include in the snapshot")
    include_ticket_details: bool = Field(
        default=False,
        description="Fetch per-ticket details for each ticket in each selected service",
    )

    @field_validator("service_ids", mode="before")
    @classmethod
    def normalize_service_ids(cls, value: Any) -> list[str]:
        return _normalize_string_list(value)

    @model_validator(mode="after")
    def validate_snapshot_targets(self) -> "ExtractSnapshotInput":
        if not self.service_ids:
            raise ValueError("service_ids must contain at least one service")
        return self


SERVICE_AUTOMATION_INPUT_SCHEMAS = {
    "get_service_blocks": ServiceBlocksInput,
    "get_all_tickets": ServiceTicketsInput,
    "get_ticket_details": TicketDetailsInput,
    "get_ticket_activity_logs": TicketActivityLogFilters,
    "get_possible_transitions": TicketTransitionInput,
    "create_ticket": CreateTicketInput,
    "update_ticket": UpdateTicketInput,
    "update_ticket_custom_fields": UpdateTicketCustomFieldsInput,
    "assign_ticket": AssignTicketInput,
    "execute_ticket": ExecuteTicketInput,
    "move_ticket_to_block": MoveTicketToBlockInput,
    "move_ticket_back": MoveTicketBackInput,
}

SERVICE_BACKUP_INPUT_SCHEMAS = {
    "extract_service_inventory": ExtractServiceInventoryInput,
    "extract_ticket": ExtractTicketInput,
    "extract_snapshot": ExtractSnapshotInput,
}


__all__ = [
    "AssignTicketInput",
    "CreateTicketInput",
    "ExecuteTicketInput",
    "ExecuteIntent",
    "ExtractServiceInventoryInput",
    "ExtractSnapshotInput",
    "ExtractTicketInput",
    "MoveTicketBackInput",
    "MoveTicketToBlockInput",
    "SERVICE_AUTOMATION_INPUT_SCHEMAS",
    "SERVICE_BACKUP_INPUT_SCHEMAS",
    "ServiceBlocksInput",
    "ServiceConnectorInput",
    "ServiceTicketsInput",
    "TicketActivityLogFilters",
    "TicketDetailsInput",
    "TicketTransitionInput",
    "UpdateTicketCustomFieldsInput",
    "UpdateTicketInput",
]