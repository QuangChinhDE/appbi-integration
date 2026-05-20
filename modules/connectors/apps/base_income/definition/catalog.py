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
        connector_key='base_income',
        display_name='Base Income',
        summary='Incomes and inflows from Base Income.',
        auth_spec=BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://income.{domain}/extapi/v1',
        supported_modules=('pipeline',),
        icon='dollar-sign',
        color='#16a34a',
        bg_color='#f0fdf4',
        connection_config=BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='incomes', display_name='Incomes', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', config_fields=(FieldDescriptor(name='username', field_type='string', required=False, description='Username filter'),)),
            StreamDefinition(stream_key='inflows', display_name='Inflows', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', config_fields=(FieldDescriptor(name='username', field_type='string', required=False, description='Username filter'),)),
        ),
    )
