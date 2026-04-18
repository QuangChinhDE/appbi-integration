"""
CRM connector — wraps CrmManagementClient with the BaseConnector interface.
"""
from __future__ import annotations

from typing import Any, Mapping

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.crm.common.auth import CrmCredentials
from modules.connectors.apps.crm.common.client import CrmManagementClient
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.contracts import ConnectorDefinition


class CrmConnector(BaseConnector):
    """Connector implementation for Base CRM."""

    def __init__(self, credentials: CrmCredentials):
        self._credentials = credentials
        self._client: CrmManagementClient | None = None

    @property
    def definition(self) -> ConnectorDefinition:
        defn = get_connector('crm')
        assert defn is not None, "CRM connector not found in registry"
        return defn

    async def _get_client(self) -> CrmManagementClient:
        if self._client is None:
            self._client = CrmManagementClient(self._credentials)
        return self._client

    async def test_connection(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            result = await client.get_all_pipelines()
            return {'ok': True, 'pipelines': len(result) if isinstance(result, list) else 0}
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

        if stream_key == 'pipelines':
            return await client.get_all_pipelines()

        if stream_key == 'pipeline_stages':
            pipeline_id = str(cfg.get('pipeline_id') or '')
            if not pipeline_id:
                raise ValueError("pipeline_stages stream requires 'pipeline_id' in config")
            return await client.get_pipeline_stages(pipeline_id)

        if stream_key == 'deals':
            pipeline_id = str(cfg.get('pipeline_id') or '')
            if not pipeline_id:
                raise ValueError("deals stream requires 'pipeline_id' in config")
            return await client.get_pipeline_deals(pipeline_id)

        if stream_key == 'deal_activities':
            deal_id = str(cfg.get('deal_id') or '')
            if not deal_id:
                raise ValueError("deal_activities stream requires 'deal_id' in config")
            return await client.get_deal_activities(deal_id)

        if stream_key == 'accounts':
            service_id = str(cfg.get('service_id') or '')
            if not service_id:
                raise ValueError("accounts stream requires 'service_id' in config")
            return await client.get_accounts(service_id)

        if stream_key == 'account_services':
            return await client.get_account_services()

        if stream_key == 'contacts':
            service_id = str(cfg.get('service_id') or '')
            if not service_id:
                raise ValueError("contacts stream requires 'service_id' in config")
            return await client.get_contacts(service_id)

        if stream_key == 'contact_services':
            return await client.get_contact_services()

        if stream_key == 'leads':
            service_id = str(cfg.get('service_id') or '')
            if not service_id:
                raise ValueError("leads stream requires 'service_id' in config")
            return await client.get_leads(service_id)

        if stream_key == 'lead_feeds':
            lead_id = str(cfg.get('lead_id') or '')
            if not lead_id:
                raise ValueError("lead_feeds stream requires 'lead_id' in config")
            return await client.get_lead_feeds(lead_id)

        raise ValueError(f"Unknown stream '{stream_key}' for crm connector")

    async def write_stream(
        self,
        stream_key: str,
        records: list[dict[str, Any]],
        *,
        config: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
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
