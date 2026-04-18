from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from packages.database.src.models import AppCredential


class ConnectorBindingValidationService:

    @staticmethod
    def validate_source_app_id(app_id: str) -> None:
        from .catalog import get_connector
        connector = get_connector(app_id)
        if connector is None or not connector.get_readable_streams():
            raise ValueError(f"App '{app_id}' is not registered as a source reader")

    @staticmethod
    def validate_destination_app_id(app_id: str) -> None:
        from .catalog import get_connector
        connector = get_connector(app_id)
        if connector is None:
            raise ValueError(f"App '{app_id}' is not registered as a pipeline destination")
        writable = connector.get_writable_streams()
        if not writable and connector.status != 'planned':
            raise ValueError(f"App '{app_id}' is not registered as a pipeline destination")

    @staticmethod
    def validate_connector_stream(connector_key: str, stream_key: str, capability: str = 'read') -> None:
        from .catalog import get_connector
        connector = get_connector(connector_key)
        if connector is None:
            raise ValueError(f"Connector '{connector_key}' not found")
        stream = connector.get_stream(stream_key)
        if stream is None:
            raise ValueError(f"Stream '{stream_key}' not found in connector '{connector_key}'")
        if capability not in stream.capabilities:
            raise ValueError(f"Stream '{stream_key}' in connector '{connector_key}' does not support '{capability}'")

    @classmethod
    def validate_source_credential(cls, credential: AppCredential | None) -> None:
        if credential is None:
            raise ValueError('Source credential not found')
        cls.validate_source_app_id(credential.app_id)

    @classmethod
    def validate_destination_credential(cls, credential: AppCredential | None) -> None:
        if credential is None:
            raise ValueError('Destination credential not found')
        from .catalog import get_connector
        connector = get_connector(credential.app_id)
        if connector is None:
            raise ValueError(
                f"Credential '{credential.name}' is for {credential.app_id}, which is not a registered connector."
            )
        writable = connector.get_writable_streams()
        if not writable and connector.status != 'planned':
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