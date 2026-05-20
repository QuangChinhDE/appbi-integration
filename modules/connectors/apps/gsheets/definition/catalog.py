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
        connector_key='gsheets',
        display_name='Google Sheets',
        summary='Read and write structured data in Google Sheets spreadsheets.',
        auth_spec=GOOGLE_AUTH,
        base_url_template='https://sheets.googleapis.com/v4',
        supported_modules=('pipeline',),
        icon='file-spreadsheet',
        color='#0f9d58',
        bg_color='#e6f4ea',
        connection_config=GOOGLE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='spreadsheets',
                display_name='Spreadsheets',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='spreadsheet_id',
            ),
            StreamDefinition(
                stream_key='sheets',
                display_name='Sheet Tabs',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                parent_stream='spreadsheets',
                primary_key='sheet_id',
                config_fields=(
                    FieldDescriptor(name='spreadsheet_id', field_type='string', required=True, description='Spreadsheet ID'),
                ),
                write_config=WriteConfig(
                    supported_modes=('append',),
                    default_mode='append',
                    supports_dynamic_schema=False,
                    target_kind='resource',
                ),
            ),
            StreamDefinition(
                stream_key='rows',
                display_name='Sheet Rows',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                parent_stream='sheets',
                config_fields=(
                    FieldDescriptor(name='spreadsheet_id', field_type='string', required=True, description='Spreadsheet ID'),
                    FieldDescriptor(name='range', field_type='string', required=False, description='Sheet range, e.g. Sheet1!A1'),
                ),
                write_config=WriteConfig(
                    supported_modes=('append', 'replace'),
                    default_mode='append',
                    target_kind='tabular',
                ),
            ),
        ),
        notes=(
            'Pipeline reuses Apps credentials and shared validation.',
            'Runtime sync writes into a stable spreadsheet/tab layout per flow.',
        ),
    )
