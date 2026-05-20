from __future__ import annotations

from modules.connectors.apps._definition_common import (
    ConnectorDefinition,
    FieldDescriptor,
    MICROSOFT_CONNECTION_CONFIG,
    MICROSOFT_STORAGE_AUTH,
    StreamDefinition,
    WriteConfig,
)


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_key='onedrive',
    display_name='OneDrive',
    summary='Folders and files in Microsoft OneDrive for backup exports.',
    auth_spec=MICROSOFT_STORAGE_AUTH,
    base_url_template='https://graph.microsoft.com/v1.0',
    supported_modules=('backup',),
    icon='cloud',
    color='#2563eb',
    bg_color='#eff6ff',
    connection_config=MICROSOFT_CONNECTION_CONFIG,
    streams=(
        StreamDefinition(
            stream_key='drives',
            display_name='Drives',
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
                FieldDescriptor(name='parent_id', field_type='string', required=False, description='Parent folder item ID'),
                FieldDescriptor(name='drive_id', field_type='string', required=False, description='Optional Graph drive ID'),
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
                FieldDescriptor(name='parent_id', field_type='string', required=False, description='Parent folder item ID'),
                FieldDescriptor(name='drive_id', field_type='string', required=False, description='Optional Graph drive ID'),
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
    notes=(
        'Backup writes files through Microsoft Graph /drive/items endpoints.',
        'Use refresh_token/client_id/client_secret for scheduled backups when available.',
    ),
)

