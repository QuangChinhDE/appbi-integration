from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from modules.apps.shared.types import GOOGLE_STYLE_APPS, SOURCE_STYLE_APPS
from packages.database.src.models import AppCredential


PIPELINE_APP_DESTINATION_IDS = {'gsheets'}
PIPELINE_PLANNED_DESTINATION_IDS = {'bigquery'}


class ConnectorBindingValidationService:
    @staticmethod
    def validate_source_app_id(app_id: str) -> None:
        if app_id not in SOURCE_STYLE_APPS:
            raise ValueError(f"App '{app_id}' is not registered as a source reader")

    @staticmethod
    def validate_destination_app_id(app_id: str) -> None:
        if app_id in PIPELINE_APP_DESTINATION_IDS or app_id in PIPELINE_PLANNED_DESTINATION_IDS:
            return
        raise ValueError(f"App '{app_id}' is not registered as a pipeline destination")

    @classmethod
    def validate_source_credential(cls, credential: AppCredential | None) -> None:
        if credential is None:
            raise ValueError('Source credential not found')
        cls.validate_source_app_id(credential.app_id)

    @classmethod
    def validate_destination_credential(cls, credential: AppCredential | None) -> None:
        if credential is None:
            raise ValueError('Destination credential not found')
        if credential.app_id in PIPELINE_APP_DESTINATION_IDS and credential.app_id in GOOGLE_STYLE_APPS:
            return
        raise ValueError(
            f"Credential '{credential.name}' is for {credential.app_id}, which is not yet available as a pipeline destination."
        )

    @staticmethod
    def validate_source_binding_payload(auth: Mapping[str, Any], config: Mapping[str, Any]) -> None:
        access_token = str((auth or {}).get('access_token') or '').strip()
        domain = str((config or {}).get('domain') or '').strip()
        if not access_token:
            raise ValueError('Source readers require an access token resolved from Apps credentials')
        if not domain:
            raise ValueError('Source readers require a normalized domain resolved from Apps credentials')

    @staticmethod
    def validate_destination_binding_payload(auth: Mapping[str, Any], config: Mapping[str, Any]) -> None:
        auth_mode = str((auth or {}).get('auth_mode') or '').strip().lower()
        if auth_mode not in {'google_oauth', 'service_account'}:
            raise ValueError('Pipeline destinations currently require a Google OAuth or service account binding')
        folder_id = str((auth or {}).get('folder_id') or (config or {}).get('folder_id') or '').strip()
        drive_id = str((auth or {}).get('drive_id') or (config or {}).get('drive_id') or '').strip()
        if not folder_id and not drive_id:
            raise ValueError('Pipeline destination bindings require a saved folder or shared drive target from Apps')