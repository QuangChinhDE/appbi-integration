from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from packages.database.src.models import AppCredential

from modules.connectors.apps._packages import canonical_connector_key

from .catalog import get_connector
from .contracts import ConnectorDefinition, StreamDefinition


class ConnectorBindingValidationService:

    @staticmethod
    def get_connector_or_raise(connector_key: str) -> ConnectorDefinition:
        connector = get_connector(str(connector_key or '').strip().lower())
        if connector is None:
            raise ValueError(f"Connector '{connector_key}' not found")
        return connector

    @classmethod
    def validate_connector_module(cls, connector_key: str, module_key: str) -> ConnectorDefinition:
        connector = cls.get_connector_or_raise(connector_key)
        if not connector.supports_module(module_key):
            raise ValueError(f"Connector '{connector_key}' does not support the {module_key} module")
        return connector

    @classmethod
    def validate_source_app_id(cls, app_id: str, *, module_key: str = 'pipeline') -> ConnectorDefinition:
        connector = cls.validate_connector_module(app_id, module_key)
        if not connector.get_readable_streams():
            raise ValueError(f"Connector '{app_id}' is not registered as a readable source")
        return connector

    @classmethod
    def validate_destination_app_id(
        cls,
        app_id: str,
        *,
        module_key: str = 'pipeline',
        pipeline_destination_only: bool = True,
    ) -> ConnectorDefinition:
        """Ensure a connector can play the destination role for the given module.

        Pipeline destinations accept both tabular (spreadsheet/table row writes)
        and resource (create-ticket/job/project) kinds. Backup additionally
        accepts blob (file uploads).
        """
        connector = cls.validate_connector_module(app_id, module_key)
        destination_streams = (
            connector.get_pipeline_destination_streams()
            if pipeline_destination_only
            else connector.get_destination_streams()
        )
        if not destination_streams:
            raise ValueError(f"Connector '{app_id}' is not registered as a destination for {module_key}")
        return connector

    @classmethod
    def validate_connector_stream(
        cls,
        connector_key: str,
        stream_key: str,
        capability: str = 'read',
        *,
        module_key: str | None = None,
        pipeline_destination_only: bool = False,
    ) -> StreamDefinition:
        connector = (
            cls.validate_connector_module(connector_key, module_key)
            if module_key else cls.get_connector_or_raise(connector_key)
        )
        stream = connector.get_stream(stream_key)
        if stream is None:
            raise ValueError(f"Stream '{stream_key}' not found in connector '{connector_key}'")
        if capability not in stream.capabilities:
            raise ValueError(f"Stream '{stream_key}' in connector '{connector_key}' does not support '{capability}'")
        # Pipeline exposes every readable stream of a pipeline-capable connector,
        # matching get_pipeline_source_streams / as_source_reader_payload. The
        # supported_modules flag remains enforced for destinations and for
        # non-pipeline modules (backup, automation).
        skip_module_stream_check = (
            module_key == 'pipeline' and capability == 'read'
        )
        if module_key and not skip_module_stream_check and not stream.supports_module(module_key):
            raise ValueError(
                f"Stream '{stream_key}' in connector '{connector_key}' is not approved for the {module_key} module"
            )
        if capability == 'write' and pipeline_destination_only:
            if stream.write_config is None or stream.write_config.target_kind not in ('tabular', 'resource'):
                raise ValueError(
                    f"Stream '{stream_key}' in connector '{connector_key}' is not a supported pipeline destination"
                )
        return stream

    @staticmethod
    def validate_stream_config(stream: StreamDefinition, config: Mapping[str, Any] | None) -> None:
        payload = dict(config or {})
        missing_fields = []
        for field in stream.config_fields:
            value = payload.get(field.name)
            if field.required and value in (None, ''):
                missing_fields.append(field.name)
        if missing_fields:
            raise ValueError(
                f"Stream '{stream.stream_key}' is missing required config fields: {', '.join(sorted(missing_fields))}"
            )

    @classmethod
    def validate_source_stream(
        cls,
        connector_key: str,
        stream_key: str,
        config: Mapping[str, Any] | None,
        *,
        module_key: str = 'pipeline',
    ) -> StreamDefinition:
        stream = cls.validate_connector_stream(
            connector_key,
            stream_key,
            capability='read',
            module_key=module_key,
        )
        cls.validate_stream_config(stream, config)
        return stream

    @classmethod
    def validate_destination_stream(
        cls,
        connector_key: str,
        stream_key: str,
        config: Mapping[str, Any] | None,
        *,
        module_key: str = 'pipeline',
        pipeline_destination_only: bool = True,
    ) -> StreamDefinition:
        stream = cls.validate_connector_stream(
            connector_key,
            stream_key,
            capability='write',
            module_key=module_key,
            pipeline_destination_only=pipeline_destination_only,
        )
        cls.validate_stream_config(stream, config)
        return stream

    @classmethod
    def validate_source_credential(
        cls,
        credential: AppCredential | None,
        *,
        module_key: str = 'pipeline',
    ) -> ConnectorDefinition:
        if credential is None:
            raise ValueError('Source credential not found')
        return cls.validate_source_app_id(credential.app_id, module_key=module_key)

    @classmethod
    def validate_destination_credential(
        cls,
        credential: AppCredential | None,
        *,
        module_key: str = 'pipeline',
        pipeline_destination_only: bool = True,
    ) -> ConnectorDefinition:
        if credential is None:
            raise ValueError('Destination credential not found')
        return cls.validate_destination_app_id(
            credential.app_id,
            module_key=module_key,
            pipeline_destination_only=pipeline_destination_only,
        )

    @classmethod
    def validate_credential_connector_match(
        cls,
        credential: AppCredential | None,
        connector_key: str,
    ) -> ConnectorDefinition:
        if credential is None:
            raise ValueError('Credential not found')
        connector = cls.get_connector_or_raise(connector_key)
        if canonical_connector_key(credential.app_id) != connector.connector_key:
            raise ValueError(
                f"Credential '{credential.name}' is for '{credential.app_id}', not '{connector.connector_key}'"
            )

        auth_mode = str(credential.auth_mode or '').strip().lower()
        supported_auth_modes = set(connector.auth_spec.supported_auth_modes or ())
        if supported_auth_modes:
            if auth_mode not in supported_auth_modes:
                raise ValueError(
                    f"Credential '{credential.name}' uses auth mode '{credential.auth_mode}', which is not supported by '{connector.connector_key}'"
                )
        elif connector.auth_spec.auth_type == 'token_password':
            if auth_mode != 'token_password':
                raise ValueError(f"Connector '{connector.connector_key}' requires auth mode 'token_password'")
        elif connector.auth_spec.auth_type == 'token':
            if auth_mode != 'access_token':
                raise ValueError(f"Connector '{connector.connector_key}' requires auth mode 'access_token'")
        return connector

    @classmethod
    def validate_source_binding_payload(cls, connector_key: str, config: Mapping[str, Any] | None) -> None:
        connector = cls.get_connector_or_raise(connector_key)
        for field in connector.auth_spec.fields:
            if field.storage != 'config' or not field.required:
                continue
            if (config or {}).get(field.name) in (None, ''):
                raise ValueError(f"Connector '{connector_key}' requires config field '{field.name}'")

    @classmethod
    def validate_destination_binding_payload(
        cls,
        connector_key: str,
        stream_key: str,
        config: Mapping[str, Any] | None,
    ) -> None:
        cls.validate_destination_stream(
            connector_key,
            stream_key,
            config,
            module_key='pipeline',
            pipeline_destination_only=True,
        )
