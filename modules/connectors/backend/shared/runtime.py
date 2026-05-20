from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional
from uuid import UUID

from modules.connectors.apps.base_connector import BaseConnector
from modules.connectors.apps.bigquery.common.auth import BigQueryCredentials
from modules.connectors.apps.bigquery.connector import BigQueryConnector
from modules.connectors.apps.base_crm.common.auth import CrmCredentials
from modules.connectors.apps.base_crm.connector import CrmConnector
from modules.connectors.apps.gdrive.common.auth import GoogleDriveCredentials
from modules.connectors.apps.gdrive.connector import GoogleDriveConnector
from modules.connectors.apps.base_goal.common.auth import GoalCredentials
from modules.connectors.apps.base_goal.connector import GoalConnector
from modules.connectors.apps.gsheets.connector import GoogleSheetsConnector
from modules.connectors.apps.base_hrm.common.auth import HrmCredentials
from modules.connectors.apps.base_hrm.connector import HrmConnector
from modules.connectors.apps.base_income.common.auth import IncomeCredentials
from modules.connectors.apps.base_income.connector import IncomeConnector
from modules.connectors.apps.base_meeting.common.auth import MeetingCredentials
from modules.connectors.apps.base_meeting.connector import MeetingConnector
from modules.connectors.apps.base_payroll.common.auth import PayrollCredentials
from modules.connectors.apps.base_payroll.connector import PayrollConnector
from modules.connectors.apps.base_request.common.auth import RequestCredentials
from modules.connectors.apps.base_request.connector import RequestConnector
from modules.connectors.apps.base_service.common.auth import ServiceCredentials
from modules.connectors.apps.base_service.connector import ServiceConnector
from modules.connectors.apps.base_table.common.auth import TableCredentials
from modules.connectors.apps.base_table.connector import TableConnector
from modules.connectors.apps.base_timeoff.common.auth import TimeoffCredentials
from modules.connectors.apps.base_timeoff.connector import TimeoffConnector
from modules.connectors.apps.base_wework.common.auth import WeworkCredentials
from modules.connectors.apps.base_wework.connector import WeworkConnector
from modules.connectors.apps.base_workflow.common.auth import WorkflowCredentials
from modules.connectors.apps.base_workflow.connector import WorkflowConnector
from modules.connectors.apps._packages import canonical_connector_key
from modules.connectors.backend.shared.catalog import get_connector
from modules.connectors.backend.shared.declarative_runtime import DeclarativeRestConnector
from modules.connectors.backend.shared.manifest_loader import get_manifest
from modules.credentials.backend.services.google_auth_service import (
    AppConfigService,
    GoogleAuthService,
    decrypt_value,
    normalize_service_account_info,
    resolve_destination_google_auth_mode,
)
from packages.database.src.models import AppCredential


BASE_CONNECTOR_BUILDERS: dict[str, tuple[type[BaseConnector], type[Any], tuple[str, ...]]] = {
    'base_request': (RequestConnector, RequestCredentials, ('domain', 'access_token')),
    'base_workflow': (WorkflowConnector, WorkflowCredentials, ('domain', 'access_token')),
    'base_wework': (WeworkConnector, WeworkCredentials, ('domain', 'access_token')),
    'base_service': (ServiceConnector, ServiceCredentials, ('domain', 'access_token')),
    'base_crm': (CrmConnector, CrmCredentials, ('domain', 'access_token', 'password')),
    'base_hrm': (HrmConnector, HrmCredentials, ('domain', 'access_token')),
    'base_table': (TableConnector, TableCredentials, ('domain', 'access_token')),
    'base_goal': (GoalConnector, GoalCredentials, ('domain', 'access_token')),
    'base_income': (IncomeConnector, IncomeCredentials, ('domain', 'access_token')),
    'base_meeting': (MeetingConnector, MeetingCredentials, ('domain', 'access_token')),
    'base_payroll': (PayrollConnector, PayrollCredentials, ('domain', 'access_token')),
    'base_timeoff': (TimeoffConnector, TimeoffCredentials, ('domain', 'access_token')),
}


@dataclass(frozen=True)
class ConnectorRuntimeBinding:
    credential: AppCredential
    auth: dict[str, Any]
    config: dict[str, Any]


class ConnectorRuntimeService:
    def __init__(self, db):
        self.db = db

    async def get_binding_for_credential_id(
        self,
        credential_id: UUID,
        *,
        overrides_auth: Mapping[str, Any] | None = None,
        overrides_config: Mapping[str, Any] | None = None,
    ) -> ConnectorRuntimeBinding:
        credential = await self.db.get(AppCredential, credential_id)
        if credential is None:
            raise ValueError('Credential not found')
        return await self.get_binding(
            credential,
            overrides_auth=overrides_auth,
            overrides_config=overrides_config,
        )

    async def get_binding(
        self,
        credential: AppCredential,
        *,
        overrides_auth: Mapping[str, Any] | None = None,
        overrides_config: Mapping[str, Any] | None = None,
    ) -> ConnectorRuntimeBinding:
        app_id = canonical_connector_key(credential.app_id)
        connector = get_connector(app_id)
        if connector is None:
            raise ValueError(f"Connector '{credential.app_id}' is not registered")

        auth = dict(credential.auth or {})
        config = dict(credential.config or {})
        auth.update(dict(overrides_auth or {}))
        config.update(dict(overrides_config or {}))

        for field in connector.auth_spec.fields:
            target = auth if field.storage == 'auth' else config
            if field.secret:
                encrypted_key = f'{field.name}_encrypted'
                encrypted = target.get(encrypted_key)
                raw_value = target.get(field.name)
                if raw_value in (None, '') and encrypted:
                    target[field.name] = decrypt_value(encrypted)

        if app_id in {'gdrive', 'gsheets', 'bigquery'}:
            auth['auth_mode'] = resolve_destination_google_auth_mode(
                {**auth, **{k: v for k, v in config.items() if k not in auth}}
            )

        return ConnectorRuntimeBinding(
            credential=credential,
            auth=auth,
            config=config,
        )

    async def build_connector_from_credential_id(
        self,
        credential_id: UUID,
        *,
        overrides_auth: Mapping[str, Any] | None = None,
        overrides_config: Mapping[str, Any] | None = None,
    ) -> BaseConnector:
        binding = await self.get_binding_for_credential_id(
            credential_id,
            overrides_auth=overrides_auth,
            overrides_config=overrides_config,
        )
        return await self.build_connector(binding)

    async def build_connector(self, binding: ConnectorRuntimeBinding) -> BaseConnector:
        app_id = canonical_connector_key(binding.credential.app_id)

        # Declarative-manifest connectors take priority over any hand-coded
        # runtime: once an app ships a manifest.yaml, the YAML is the source
        # of truth for endpoints, pagination, and schema.
        manifest = get_manifest(app_id)
        if manifest is not None:
            definition = get_connector(app_id)
            if definition is None:
                raise ValueError(f"Manifest for '{app_id}' has no catalog entry")
            token_provider = None
            if manifest.auth.type in ('google_oauth', 'service_account'):
                token_provider = self._build_google_token_provider(binding.auth)
            return DeclarativeRestConnector(
                manifest=manifest,
                definition=definition,
                auth=binding.auth,
                config=binding.config,
                token_provider=token_provider,
            )

        if app_id in BASE_CONNECTOR_BUILDERS:
            connector_cls, credentials_cls, field_names = BASE_CONNECTOR_BUILDERS[app_id]
            payload = {
                field_name: binding.auth.get(field_name, binding.config.get(field_name))
                for field_name in field_names
            }
            return connector_cls(credentials_cls(**payload))

        if app_id == 'gdrive':
            token_source = self._build_google_token_provider(binding.auth)
            credentials = await self._build_google_drive_credentials(binding)
            return GoogleDriveConnector(token_source, credentials)

        if app_id == 'gsheets':
            token_source = self._build_google_token_provider(binding.auth)
            return GoogleSheetsConnector(token_source)

        if app_id == 'bigquery':
            await self._require_bigquery_scope(binding)
            token_source = self._build_google_token_provider(binding.auth)
            credentials = await self._build_bigquery_credentials(binding)
            return BigQueryConnector(token_source, credentials)

        raise ValueError(f"Connector runtime for '{app_id}' is not implemented")

    def _build_google_token_provider(self, auth: Mapping[str, Any]) -> Callable[[bool], Any]:
        google_auth_service = GoogleAuthService(self.db)
        auth_payload = dict(auth or {})

        async def provider(force_refresh: bool = False) -> str:
            token, _ = await google_auth_service.get_destination_access_token_details(
                auth_payload,
                force_refresh=force_refresh,
            )
            return token

        return provider

    async def _resolve_service_account_info(self, auth: Mapping[str, Any]) -> Optional[dict[str, Any]]:
        if auth.get('service_account_json'):
            value = auth.get('service_account_json')
            return normalize_service_account_info(value)

        encrypted = auth.get('service_account_json_encrypted')
        if encrypted:
            decrypted = decrypt_value(str(encrypted))
            return normalize_service_account_info(decrypted)

        platform_cfg = await AppConfigService(self.db).get_platform_service_account_config()
        return platform_cfg.get('service_account_json')

    async def _build_google_drive_credentials(
        self,
        binding: ConnectorRuntimeBinding,
    ) -> GoogleDriveCredentials:
        auth = dict(binding.auth or {})
        config = dict(binding.config or {})
        return GoogleDriveCredentials(
            auth_mode=auth.get('auth_mode') or binding.credential.auth_mode,
            connection_id=auth.get('connection_id'),
            service_account_info=await self._resolve_service_account_info(auth),
            folder_id=config.get('folder_id') or auth.get('folder_id'),
            drive_id=config.get('drive_id') or auth.get('drive_id'),
        )

    async def _build_bigquery_credentials(
        self,
        binding: ConnectorRuntimeBinding,
    ) -> BigQueryCredentials:
        auth = dict(binding.auth or {})
        config = dict(binding.config or {})
        return BigQueryCredentials(
            auth_mode=auth.get('auth_mode') or binding.credential.auth_mode,
            project_id=str(config.get('project_id') or ''),
            dataset_id=config.get('dataset_id'),
            connection_id=auth.get('connection_id'),
            service_account_info=await self._resolve_service_account_info(auth),
        )

    async def _require_bigquery_scope(self, binding: ConnectorRuntimeBinding) -> None:
        """Fail fast if the selected Google OAuth connection was granted before
        the BigQuery scope was added. The token itself is still valid, but
        BigQuery will respond with 403 "insufficient authentication scopes".
        """
        auth = dict(binding.auth or {})
        mode = auth.get('auth_mode') or binding.credential.auth_mode
        if mode != 'google_oauth':
            return
        connection_id = auth.get('connection_id') or auth.get('google_oauth_connection_id')
        if not connection_id:
            return
        from packages.database.src.models import GoogleConnection
        from sqlalchemy import select
        result = await self.db.execute(
            select(GoogleConnection).where(GoogleConnection.id == connection_id)
        )
        conn = result.scalar_one_or_none()
        if conn is None:
            return
        granted = (conn.scopes or '').lower()
        if 'bigquery' in granted:
            return
        raise ValueError(
            f"Google account '{conn.email}' was connected before BigQuery access "
            "was enabled on this platform. Please reconnect the Google account "
            "(Credentials → Google connections → Disconnect then Connect again) "
            "and grant the BigQuery permission on the consent screen."
        )
