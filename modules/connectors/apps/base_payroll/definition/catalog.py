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
        connector_key='base_payroll',
        display_name='Base Payroll',
        summary='Payroll cycles, payrolls and records from Base Payroll.',
        auth_spec=BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://payroll.{domain}/extapi/v1',
        supported_modules=('pipeline',),
        icon='wallet',
        color='#0d9488',
        bg_color='#f0fdfa',
        connection_config=BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='cycles', display_name='Cycles', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='payrolls', display_name='Payrolls', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='cycles', config_fields=(FieldDescriptor(name='cycle_id', field_type='string', required=True, description='Payroll cycle ID'),)),
            StreamDefinition(stream_key='records', display_name='Records', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', config_fields=(FieldDescriptor(name='cycle_id', field_type='string', required=False, description='Payroll cycle ID'), FieldDescriptor(name='payroll_id', field_type='string', required=False, description='Payroll ID'))),
        ),
    )
