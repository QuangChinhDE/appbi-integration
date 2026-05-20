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
        connector_key='base_crm',
        display_name='Base CRM',
        summary='Leads, deals, accounts, contacts and pipelines from Base CRM.',
        icon='briefcase',
        color='#dc2626',
        bg_color='#fef2f2',
        connection_config={
            'step_title': 'CRM Connection',
            'step_description': 'Provide domain, access token, and password for CRM API access.',
            'domain_label': 'Base Domain',
            'domain_placeholder': 'company.base.com.vn',
            'domain_help': 'Enter your CRM domain.',
            'token_label': 'Access Token',
            'token_placeholder': 'Paste your CRM access token here…',
            'token_help': 'Get this from CRM → Settings → API Keys.',
        },
        auth_spec=AuthSpec(
            auth_type='token_password',
            fields=(
                FieldDescriptor(
                    name='domain',
                    field_type='string',
                    required=True,
                    description='Base domain (e.g. company.base.vn)',
                    storage='config',
                ),
                FieldDescriptor(
                    name='access_token',
                    field_type='string',
                    required=True,
                    description='API access token',
                    secret=True,
                    storage='auth',
                    input_kind='password',
                ),
                FieldDescriptor(
                    name='password',
                    field_type='string',
                    required=True,
                    description='API password',
                    secret=True,
                    storage='auth',
                    input_kind='password',
                ),
            ),
            test_connection_operation='test_connection',
        ),
        base_url_template='https://apis.{domain}',
        supported_modules=('pipeline',),
        streams=(
            StreamDefinition(stream_key='pipelines', display_name='Pipelines', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='pipeline_stages', display_name='Pipeline Stages', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='pipelines', config_fields=(FieldDescriptor(name='pipeline_id', field_type='string', required=True, description='Pipeline ID'),)),
            StreamDefinition(stream_key='deals', display_name='Deals', capabilities=('read',), sync_modes=('full_refresh', 'incremental'), primary_key='id', config_fields=(FieldDescriptor(name='pipeline_id', field_type='string', required=False, description='Pipeline ID'),)),
            StreamDefinition(stream_key='deal_activities', display_name='Deal Activities', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='deals', config_fields=(FieldDescriptor(name='deal_id', field_type='string', required=True, description='Deal ID'),)),
            StreamDefinition(stream_key='accounts', display_name='Accounts', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', config_fields=(FieldDescriptor(name='service_id', field_type='string', required=False, description='Account service ID'),)),
            StreamDefinition(stream_key='account_services', display_name='Account Services', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='accounts', config_fields=(FieldDescriptor(name='account_id', field_type='string', required=True, description='Account ID'),)),
            StreamDefinition(stream_key='contacts', display_name='Contacts', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', config_fields=(FieldDescriptor(name='service_id', field_type='string', required=False, description='Contact service ID'),)),
            StreamDefinition(stream_key='contact_services', display_name='Contact Services', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='contacts', config_fields=(FieldDescriptor(name='contact_id', field_type='string', required=True, description='Contact ID'),)),
            StreamDefinition(stream_key='leads', display_name='Leads', capabilities=('read',), sync_modes=('full_refresh', 'incremental'), primary_key='id', config_fields=(FieldDescriptor(name='service_id', field_type='string', required=False, description='Lead service ID'),)),
            StreamDefinition(stream_key='lead_feeds', display_name='Lead Feeds', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='leads', config_fields=(FieldDescriptor(name='lead_id', field_type='string', required=True, description='Lead ID'),)),
        ),
    )
