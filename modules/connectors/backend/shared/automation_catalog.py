from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.connectors.apps.service.common.manifest import SERVICE_CONNECTOR_MANIFEST
from packages.auth.src.resource_permissions import apply_resource_scope
from packages.database.src.models import AppCredential, ResourceType, User

from .validation import ConnectorBindingValidationService


AUTOMATION_MANIFESTS: tuple[dict[str, object], ...] = (
    SERVICE_CONNECTOR_MANIFEST,
)


def _operation_payload(operation_key: str, spec: dict[str, object]) -> dict[str, object]:
    return {
        'key': operation_key,
        'summary': str(spec.get('summary') or '').strip(),
        'input_schema': spec.get('input_schema'),
        'required_fields': list(spec.get('required_fields') or []),
        'optional_fields': list(spec.get('optional_fields') or []),
        'api_calls': list(spec.get('api_calls') or []),
        'notes': list(spec.get('notes') or []),
    }


class AutomationCatalogService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_connectors(self, current_user: User | None = None) -> list[dict[str, object]]:
        counts = await self._load_credential_counts(current_user)
        payloads: list[dict[str, object]] = []

        for manifest in AUTOMATION_MANIFESTS:
            app_id = str(manifest.get('key') or '').strip()
            supports = dict(manifest.get('supports') or {})
            if not app_id or not supports.get('automation'):
                continue

            ConnectorBindingValidationService.validate_source_app_id(app_id)

            automation = dict(manifest.get('automation') or {})
            operations_raw = dict(automation.get('operations') or {})
            operations = [
                _operation_payload(operation_key, dict(spec or {}))
                for operation_key, spec in operations_raw.items()
                if isinstance(spec, dict)
            ]
            resources = [
                {
                    'key': str(resource_key),
                    'actions': [str(action) for action in actions],
                }
                for resource_key, actions in dict(automation.get('resources') or {}).items()
            ]
            triggers = [str(trigger) for trigger in list(automation.get('triggers') or [])]

            payloads.append(
                {
                    'key': f'{app_id}_automation',
                    'app_id': app_id,
                    'app_name': str(manifest.get('display_name') or app_id).strip(),
                    'summary': 'Reusable action and trigger metadata resolved from the shared connector manifest and bound through saved Apps credentials.',
                    'binding_source': 'apps',
                    'status': 'ready',
                    'credential_count': counts.get(app_id, 0),
                    'resources': resources,
                    'triggers': triggers,
                    'trigger_count': len(triggers),
                    'operation_count': len(operations),
                    'operations': operations,
                    'selection_label': 'Select a saved Apps credential for this connector before configuring automation actions or triggers.',
                    'notes': [
                        'Automation shell is mounted independently from Backup and Pipeline through the shared module registry.',
                        'Workflow builder, runtime execution, and scheduling remain planned for a later iteration.',
                    ],
                }
            )

        return payloads

    async def build_automation_catalog(self, current_user: User | None = None) -> dict[str, object]:
        connectors = await self.list_connectors(current_user)
        return {
            'connectors': connectors,
            'saved_binding_count': sum(int(item.get('credential_count') or 0) for item in connectors),
            'connector_count': len(connectors),
            'operation_count': sum(int(item.get('operation_count') or 0) for item in connectors),
            'trigger_count': sum(int(item.get('trigger_count') or 0) for item in connectors),
        }

    async def _load_credential_counts(self, current_user: User | None = None) -> dict[str, int]:
        stmt = select(AppCredential.app_id, func.count(AppCredential.id)).group_by(AppCredential.app_id)
        if current_user is not None:
            stmt = apply_resource_scope(
                stmt, AppCredential, ResourceType.APP_CREDENTIAL, current_user, module='apps',
            )
        result = await self.db.execute(stmt)
        return {str(app_id): int(count or 0) for app_id, count in result.all()}