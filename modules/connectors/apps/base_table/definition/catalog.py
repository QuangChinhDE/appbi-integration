from __future__ import annotations

from modules.connectors.apps._definition_common import (
    BASE_CONNECTION_CONFIG,
    BASE_TOKEN_AUTH,
    GOOGLE_AUTH,
    GOOGLE_CONNECTION_CONFIG,
    AuthSpec,
    ConnectorDefinition,
    FieldDescriptor,
    OperationSpec,
    StreamDefinition,
    WriteConfig,
)


CONNECTOR_DEFINITION = ConnectorDefinition(
        connector_key='base_table',
        display_name='Base Table',
        summary='Read records from Base Table databases.',
        auth_spec=BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://table.{domain}/extapi/v1',
        supported_modules=('pipeline',),
        icon='layout-grid',
        color='#4f46e5',
        bg_color='#eef2ff',
        connection_config=BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='records',
                display_name='Records',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                config_fields=(
                    FieldDescriptor(name='table_id', field_type='string', required=True, description='Table ID'),
                ),
            ),
        ),
    )
