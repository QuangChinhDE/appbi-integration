from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from modules.connectors.backend.shared.catalog import ConnectorCatalogService
from packages.auth.src.module_registry import get_module_definition


class PipelineModuleService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_overview(self) -> dict[str, object]:
        module_definition = get_module_definition('pipeline')
        catalog = await ConnectorCatalogService(self.db).build_pipeline_catalog()
        sources = catalog['sources']
        destinations = catalog['destinations']

        return {
            'module': module_definition.to_frontend_payload() if module_definition else {
                'key': 'pipeline',
                'label': 'Pipeline',
                'route': '/pipeline',
                'description': 'Source-to-destination sync shell',
                'icon': 'Workflow',
                'nav_order': 30,
                'levels': ['none', 'view', 'edit', 'full'],
            },
            'source_count': len(sources),
            'destination_count': len(destinations),
            'source_credential_count': catalog['source_credential_count'],
            'destination_credential_count': catalog['destination_credential_count'],
            'ready_destination_count': catalog['ready_destination_count'],
            'planned_destination_count': catalog['planned_destination_count'],
            'sources': sources,
            'destinations': destinations,
        }

    async def get_capability(self, kind: str, capability_key: str) -> dict[str, object] | None:
        catalog = await ConnectorCatalogService(self.db).build_pipeline_catalog()
        normalized_kind = str(kind or '').strip().lower()
        normalized_key = str(capability_key or '').strip().lower()
        items = catalog['sources'] if normalized_kind == 'source' else catalog['destinations']

        for item in items:
            if str(item.get('key') or '').strip().lower() == normalized_key:
                return item

        return None
