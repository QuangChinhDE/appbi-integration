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
        connector_key='base_timeoff',
        display_name='Base Timeoff',
        summary='Time-off requests and groups from Base Timeoff.',
        auth_spec=BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://timeoff.{domain}/extapi/v1',
        supported_modules=('pipeline',),
        icon='clock',
        color='#f59e0b',
        bg_color='#fffbeb',
        connection_config=BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='timeoffs', display_name='Timeoffs', capabilities=('read',), sync_modes=('full_refresh', 'incremental'), primary_key='id'),
            StreamDefinition(stream_key='groups', display_name='Groups', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
        ),
    )
