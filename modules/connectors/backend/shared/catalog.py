from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.apps.shared.types import SUPPORTED_APPS
from packages.database.src.models import AppCredential

from .contracts import DestinationWriterDefinition, DiscoveryContract, SourceReaderDefinition
from .validation import ConnectorBindingValidationService


SOURCE_READERS: tuple[SourceReaderDefinition, ...] = (
    SourceReaderDefinition(
        reader_key='request_reader',
        app_id='request',
        app_name=SUPPORTED_APPS['request'],
        summary='Discover groups and requests from Base Request through reusable Apps credentials.',
        binding_source='apps',
        binding_fields=('domain', 'access_token'),
        sync_modes=('full_refresh',),
        discovery=DiscoveryContract(
            mode='catalog_preview',
            status='ready',
            summary='Shared discovery can enumerate groups and request samples from the saved source binding.',
            selection_label='Select a saved Request credential from Apps, then load discovery from the shared connector layer.',
        ),
    ),
    SourceReaderDefinition(
        reader_key='service_reader',
        app_id='service',
        app_name=SUPPORTED_APPS['service'],
        summary='Discover services and ticket collections from Base Service through reusable Apps credentials.',
        binding_source='apps',
        binding_fields=('domain', 'access_token'),
        sync_modes=('full_refresh',),
        discovery=DiscoveryContract(
            mode='catalog_preview',
            status='ready',
            summary='Shared discovery can enumerate services and ticket samples from the saved source binding.',
            selection_label='Select a saved Service credential from Apps, then load discovery from the shared connector layer.',
        ),
    ),
    SourceReaderDefinition(
        reader_key='workflow_reader',
        app_id='workflow',
        app_name=SUPPORTED_APPS['workflow'],
        summary='Discover workflows and jobs from Base Workflow through reusable Apps credentials.',
        binding_source='apps',
        binding_fields=('domain', 'access_token'),
        sync_modes=('full_refresh',),
        discovery=DiscoveryContract(
            mode='catalog_preview',
            status='ready',
            summary='Shared discovery can enumerate workflows and job samples from the saved source binding.',
            selection_label='Select a saved Workflow credential from Apps, then load discovery from the shared connector layer.',
        ),
    ),
    SourceReaderDefinition(
        reader_key='wework_reader',
        app_id='wework',
        app_name=SUPPORTED_APPS['wework'],
        summary='Discover departments, projects, and tasks from Base WeWork through reusable Apps credentials.',
        binding_source='apps',
        binding_fields=('domain', 'access_token'),
        sync_modes=('full_refresh',),
        discovery=DiscoveryContract(
            mode='catalog_preview',
            status='ready',
            summary='Shared discovery can enumerate departments, projects, and task samples from the saved source binding.',
            selection_label='Select a saved WeWork credential from Apps, then load discovery from the shared connector layer.',
        ),
    ),
)


DESTINATION_WRITERS: tuple[DestinationWriterDefinition, ...] = (
    DestinationWriterDefinition(
        writer_key='gsheets_writer',
        app_id='gsheets',
        app_name='Google Sheets',
        summary='Write structured streams into Google Sheets tabs using saved Apps destination profiles.',
        binding_source='apps',
        auth_modes=('google_oauth', 'service_account'),
        status='ready',
        selection_label='Select a saved Google Sheets destination profile from Apps.',
        notes=(
            'Pipeline shell reuses Apps credentials and shared validation today.',
            'Runtime sync execution is still planned for a later iteration.',
        ),
    ),
    DestinationWriterDefinition(
        writer_key='bigquery_writer',
        app_id='bigquery',
        app_name='BigQuery',
        summary='Planned warehouse destination for structured sync jobs and append/replace strategies.',
        binding_source='planned',
        auth_modes=('service_account',),
        status='planned',
        selection_label='BigQuery destination profiles are not available in Apps yet.',
        notes=(
            'The module shell reserves BigQuery as the next destination after Google Sheets.',
            'Apps credential support, validation, and writer runtime will land in a later phase.',
        ),
    ),
)


class ConnectorCatalogService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_source_readers(self) -> list[dict[str, object]]:
        counts = await self._load_credential_counts()
        payloads: list[dict[str, object]] = []
        for definition in SOURCE_READERS:
            ConnectorBindingValidationService.validate_source_app_id(definition.app_id)
            payloads.append(definition.to_payload(credential_count=counts.get(definition.app_id, 0)))
        return payloads

    async def list_destination_writers(self) -> list[dict[str, object]]:
        counts = await self._load_credential_counts()
        payloads: list[dict[str, object]] = []
        for definition in DESTINATION_WRITERS:
            ConnectorBindingValidationService.validate_destination_app_id(definition.app_id)
            payloads.append(definition.to_payload(credential_count=counts.get(definition.app_id, 0)))
        return payloads

    async def build_pipeline_catalog(self) -> dict[str, object]:
        sources = await self.list_source_readers()
        destinations = await self.list_destination_writers()
        return {
            'sources': sources,
            'destinations': destinations,
            'source_credential_count': sum(int(item.get('credential_count') or 0) for item in sources),
            'destination_credential_count': sum(int(item.get('credential_count') or 0) for item in destinations),
            'ready_destination_count': sum(1 for item in destinations if item.get('status') == 'ready'),
            'planned_destination_count': sum(1 for item in destinations if item.get('status') == 'planned'),
        }

    async def _load_credential_counts(self) -> dict[str, int]:
        result = await self.db.execute(
            select(AppCredential.app_id, func.count(AppCredential.id))
            .group_by(AppCredential.app_id)
        )
        return {str(app_id): int(count or 0) for app_id, count in result.all()}