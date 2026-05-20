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
        connector_key='gdrive',
        display_name='Google Drive',
        summary='Folders and files in Google Drive for backup exports.',
        auth_spec=GOOGLE_AUTH,
        base_url_template='https://www.googleapis.com/drive/v3',
        supported_modules=('backup',),
        icon='folder',
        color='#1a73e8',
        bg_color='#e8f0fe',
        connection_config=GOOGLE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='drives',
                display_name='Shared Drives',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='drive_id',
                supported_modules=('backup',),
            ),
            StreamDefinition(
                stream_key='folders',
                display_name='Folders',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                primary_key='folder_id',
                config_fields=(
                    FieldDescriptor(name='parent_id', field_type='string', required=False, description='Parent folder ID'),
                    FieldDescriptor(name='drive_id', field_type='string', required=False, description='Shared Drive ID'),
                ),
                write_config=WriteConfig(
                    supported_modes=('append',),
                    default_mode='append',
                    supports_dynamic_schema=False,
                    target_kind='resource',
                ),
                supported_modules=('backup',),
            ),
            StreamDefinition(
                stream_key='files',
                display_name='Files',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                primary_key='file_id',
                config_fields=(
                    FieldDescriptor(name='parent_id', field_type='string', required=False, description='Parent folder ID'),
                    FieldDescriptor(name='drive_id', field_type='string', required=False, description='Shared Drive ID'),
                ),
                write_config=WriteConfig(
                    supported_modes=('append', 'replace'),
                    default_mode='append',
                    supports_dynamic_schema=False,
                    target_kind='blob',
                ),
                supported_modules=('backup',),
            ),
        ),
    )
