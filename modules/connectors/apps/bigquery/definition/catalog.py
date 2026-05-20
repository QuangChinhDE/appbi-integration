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
        connector_key='bigquery',
        display_name='BigQuery',
        summary='Warehouse destination for structured sync jobs with append/replace strategies.',
        icon='database',
        color='#4285f4',
        bg_color='#e8f0fe',
        connection_config=GOOGLE_CONNECTION_CONFIG,
        auth_spec=AuthSpec(
            auth_type='google_oauth',
            fields=(
                FieldDescriptor(
                    name='auth_mode',
                    field_type='string',
                    required=True,
                    description='google_oauth or service_account',
                    storage='auth',
                    input_kind='select',
                ),
                FieldDescriptor(
                    name='project_id',
                    field_type='string',
                    required=True,
                    description='GCP project ID',
                    storage='config',
                ),
                FieldDescriptor(
                    name='dataset_id',
                    field_type='string',
                    required=False,
                    description='Default BigQuery dataset ID',
                    storage='config',
                ),
            ),
            supported_auth_modes=('google_oauth', 'service_account'),
        ),
        base_url_template='https://bigquery.googleapis.com/bigquery/v2',
        supported_modules=('pipeline',),
        status='ready',
        streams=(
            StreamDefinition(
                stream_key='datasets',
                display_name='Datasets',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='dataset_id',
            ),
            StreamDefinition(
                stream_key='tables',
                display_name='Tables',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                primary_key='table_id',
                parent_stream='datasets',
                config_fields=(
                    FieldDescriptor(name='dataset_id', field_type='string', required=False, description='Dataset ID'),
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
                display_name='Table Rows',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                parent_stream='tables',
                config_fields=(
                    FieldDescriptor(name='dataset_id', field_type='string', required=False, description='Dataset ID override'),
                    FieldDescriptor(name='table_id', field_type='string', required=True, description='Target table ID'),
                    FieldDescriptor(name='merge_key', field_type='string', required=False, description='Primary key used for upsert'),
                ),
                write_config=WriteConfig(
                    supported_modes=('append', 'replace', 'upsert'),
                    default_mode='append',
                    target_kind='tabular',
                ),
            ),
        ),
        notes=(
            'Pipeline uses Apps credentials and the shared runtime factory for token resolution.',
            'Dataset can be defined once on the credential and overridden per pipeline destination.',
        ),
    )
