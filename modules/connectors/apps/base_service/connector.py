"""
Service connector — template implementation for all Base-style connectors.

Wraps the existing ServiceManagementClient with the BaseConnector interface
so that Pipeline, Backup, and Automation can consume it uniformly.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.base_service.common.auth import ServiceCredentials
from modules.connectors.apps.base_service.common.client import ServiceManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class ServiceConnector(BaseConnector):
    """Connector implementation for Base Service."""

    def __init__(self, credentials: ServiceCredentials):
        self._credentials = credentials
        self._client: ServiceManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('base_service')
        assert defn is not None, "Service connector not found in registry"
        return defn

    async def _get_client(self) -> ServiceManagementClient:
        if self._client is None:
            self._client = ServiceManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_all_groups(selector='groups')
            return {'ok': True, 'groups': len(result) if isinstance(result, list) else 0}
        except Exception as exc:
            return {'ok': False, 'error': str(exc)}

    async def read_stream(
        self,
        stream_key: str,
        *,
        config: Mapping[str, Any] | None = None,
        cursor: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        client = await self._get_client()
        cfg = dict(config or {})

        if stream_key == 'services':
            result = await client.get_all_services(selector='services')
            return result if isinstance(result, list) else []

        if stream_key == 'compounds':
            result = await client.get_all_compounds(selector='compound_blocks')
            return result if isinstance(result, list) else []

        if stream_key == 'groups':
            result = await client.get_all_groups(selector='groups')
            return result if isinstance(result, list) else []

        if stream_key == 'stages':
            service_id = str(cfg.get('service_id') or '')
            if not service_id:
                raise ValueError("stages stream requires 'service_id' in config")
            result = await client.get_service_blocks(service_id, selector='stages')
            return result if isinstance(result, list) else []

        if stream_key == 'tickets':
            service_id = str(cfg.get('service_id') or '')
            if not service_id:
                raise ValueError("tickets stream requires 'service_id' in config")
            result = await client.get_all_tickets(service_id, selector='tickets')
            return result if isinstance(result, list) else []

        if stream_key == 'ticket_details':
            ticket_id = str(cfg.get('ticket_id') or '')
            if not ticket_id:
                raise ValueError("ticket_details stream requires 'ticket_id' in config")
            result = await client.get_ticket_details(ticket_id, selector='ticket')
            if isinstance(result, dict):
                return [result]
            return []

        if stream_key == 'activity_logs':
            filters = cfg.get('filters') or {}
            result = await client.get_ticket_activity_logs(filters=filters, selector='activity_logs')
            return result if isinstance(result, list) else []

        raise ValueError(f"Unknown stream '{stream_key}' for service connector")

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        cfg = dict(config or {})
        write_mode = str(cfg.get('write_mode') or 'append').lower()
        if write_mode != 'append':
            raise ValueError(f"Service connector only supports write_mode='append', got '{write_mode}'")

        client = await self._get_client()

        if stream_key == 'tickets':
            default_service_id = str(cfg.get('service_id') or '')
            default_username = str(cfg.get('username') or '')
            created = 0
            errors = 0
            for record in records:
                try:
                    await client.create_ticket(
                        username=str(record.get('username') or default_username),
                        service_id=str(record.get('service_id') or default_service_id),
                        block_id=str(record.get('block_id') or ''),
                        name=str(record.get('name') or ''),
                        assignees=record.get('assignees'),
                        followers=record.get('followers'),
                        managers=record.get('managers'),
                        root_content=record.get('root_content'),
                        custom_fields=record.get('custom_fields'),
                    )
                    created += 1
                except Exception:
                    errors += 1
            return {'written': created, 'errors': errors}

        stream = self.definition.get_stream(stream_key)
        if stream is None:
            raise ValueError(f"Stream '{stream_key}' not found")
        if not stream.can_write:
            raise NotImplementedError(f"Stream '{stream_key}' does not support writes")
        raise NotImplementedError(f"write_stream for '{stream_key}' not yet implemented")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
