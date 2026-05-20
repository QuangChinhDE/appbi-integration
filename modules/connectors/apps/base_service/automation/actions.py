from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_service.common import ServiceManagementClient
from modules.connectors.apps.base_service.common.schemas import (
    AssignTicketInput,
    CreateTicketInput,
    ExecuteTicketInput,
    MoveTicketBackInput,
    MoveTicketToBlockInput,
    ServiceBlocksInput,
    ServiceTicketsInput,
    TicketActivityLogFilters,
    TicketDetailsInput,
    TicketTransitionInput,
    UpdateTicketCustomFieldsInput,
    UpdateTicketInput,
)


class ServiceAutomationActions:
    """Action layer adapted from the n8n Service node operations."""

    def __init__(self, client: ServiceManagementClient):
        self.client = client

    async def get_all_services(self) -> Any:
        return await self.client.get_all_services(selector="services")

    async def get_all_compounds(self) -> Any:
        return await self.client.get_all_compounds(selector="compound_blocks")

    async def get_all_groups(self) -> Any:
        return await self.client.get_all_groups(selector="groups")

    async def get_service_blocks(self, service_id: str) -> Any:
        request = ServiceBlocksInput(service_id=service_id)
        return await self.client.get_service_blocks(request.service_id, selector="stages")

    async def get_all_tickets(self, service_id: str) -> Any:
        request = ServiceTicketsInput(service_id=service_id)
        return await self.client.get_all_tickets(request.service_id, selector="tickets")

    async def get_ticket_details(self, ticket_id: str) -> Any:
        request = TicketDetailsInput(ticket_id=ticket_id)
        return await self.client.get_ticket_details(request.ticket_id, selector="ticket")

    async def get_ticket_activity_logs(
        self,
        filters: Mapping[str, Any] | None = None,
    ) -> Any:
        normalized_filters = None
        if filters is not None:
            normalized_filters = TicketActivityLogFilters.model_validate(filters).cleaned_dump()
        return await self.client.get_ticket_activity_logs(
            normalized_filters,
            selector="activity_logs",
        )

    async def get_possible_transitions(self, ticket_id: str, username: str) -> Any:
        request = TicketTransitionInput(ticket_id=ticket_id, username=username)
        return await self.client.get_possible_transitions(
            request.ticket_id,
            request.username,
            selector="ticket_data.possible_actions",
        )

    async def create_ticket(
        self,
        *,
        username: str,
        service_id: str,
        block_id: str,
        name: str,
        assignees: str | None = None,
        followers: str | None = None,
        managers: str | None = None,
        root_content: str | None = None,
        custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = CreateTicketInput(
            username=username,
            service_id=service_id,
            block_id=block_id,
            name=name,
            assignees=assignees,
            followers=followers,
            managers=managers,
            root_content=root_content,
            custom_fields=custom_fields or {},
        )
        return await self.client.create_ticket(**request.cleaned_dump())

    async def update_ticket(
        self,
        *,
        service_id: str,
        ticket_id: str,
        username: str,
        name: str,
        update_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = UpdateTicketInput.model_validate(
            {
                "service_id": service_id,
                "ticket_id": ticket_id,
                "username": username,
                "name": name,
                **(dict(update_fields) if update_fields else {}),
            }
        )
        return await self.client.update_ticket(**request.to_client_payload())

    async def update_ticket_custom_fields(
        self,
        *,
        service_id: str,
        ticket_id: str,
        username: str,
        custom_field_ids: str,
        custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = UpdateTicketCustomFieldsInput(
            service_id=service_id,
            ticket_id=ticket_id,
            username=username,
            custom_field_ids=custom_field_ids,
            custom_fields=custom_fields or {},
        )
        return await self.client.update_ticket_custom_fields(**request.cleaned_dump())

    async def assign_ticket(
        self,
        *,
        ticket_id: str,
        username: str,
        assignees: str,
    ) -> dict[str, Any]:
        request = AssignTicketInput(
            ticket_id=ticket_id,
            username=username,
            assignees=assignees,
        )
        return await self.client.assign_ticket(**request.cleaned_dump())

    async def execute_ticket(
        self,
        *,
        ticket_id: str,
        username: str,
        additional_fields: Mapping[str, Any] | None = None,
        ticket_custom_fields: Mapping[str, Any] | None = None,
        block_custom_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = ExecuteTicketInput.model_validate(
            {
                "ticket_id": ticket_id,
                "username": username,
                **(dict(additional_fields) if additional_fields else {}),
                "ticket_custom_fields": ticket_custom_fields or {},
                "block_custom_fields": block_custom_fields or {},
            }
        )
        return await self.client.execute_ticket(**request.to_client_payload())

    async def move_ticket_to_block(
        self,
        *,
        ticket_id: str,
        username: str,
        next_block_id: str,
        additional_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = MoveTicketToBlockInput.model_validate(
            {
                "ticket_id": ticket_id,
                "username": username,
                "next_block_id": next_block_id,
                **(dict(additional_fields) if additional_fields else {}),
            }
        )
        return await self.client.move_ticket_to_block(**request.to_client_payload())

    async def move_ticket_back(
        self,
        *,
        ticket_id: str,
        username: str,
        additional_fields: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = MoveTicketBackInput.model_validate(
            {
                "ticket_id": ticket_id,
                "username": username,
                **(dict(additional_fields) if additional_fields else {}),
            }
        )
        return await self.client.move_ticket_back(**request.to_client_payload())