from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from modules.connectors.backend.shared.automation_catalog import AutomationCatalogService
from packages.auth.src.module_registry import get_module_definition


class AutomationModuleService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_overview(self) -> dict[str, object]:
        module_definition = get_module_definition('automation')
        catalog = await AutomationCatalogService(self.db).build_automation_catalog()

        return {
            'module': module_definition.to_frontend_payload() if module_definition else {
                'key': 'automation',
                'label': 'Automation',
                'route': '/automation',
                'description': 'Reusable workflow automation and future orchestration surfaces.',
                'icon': 'Zap',
                'nav_order': 40,
                'levels': ['none', 'view', 'edit', 'full'],
            },
            'connector_count': catalog['connector_count'],
            'saved_binding_count': catalog['saved_binding_count'],
            'operation_count': catalog['operation_count'],
            'trigger_count': catalog['trigger_count'],
            'connectors': catalog['connectors'],
        }

    async def get_connector(self, connector_key: str) -> dict[str, object] | None:
        catalog = await AutomationCatalogService(self.db).build_automation_catalog()
        normalized_key = str(connector_key or '').strip().lower()
        for connector in catalog['connectors']:
            if str(connector.get('key') or '').strip().lower() == normalized_key:
                return connector
        return None
