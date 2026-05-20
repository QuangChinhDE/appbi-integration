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
        connector_key='base_meeting',
        display_name='Base Meeting',
        summary='Groups, meetings and repeated meetings from Base Meeting.',
        icon='calendar-clock',
        color='#9333ea',
        bg_color='#faf5ff',
        connection_config={
            'step_title': 'Meeting Connection',
            'step_description': 'Provide domain and access token for Base Meeting.',
            'domain_label': 'Base Domain',
            'domain_placeholder': 'company.base.com.vn',
            'domain_help': 'Enter your Meeting domain.',
            'token_label': 'Access Token',
            'token_placeholder': 'Paste your Meeting access token (NOT v2)…',
            'token_help': 'Meeting uses access_token, not access_token_v2.',
        },
        auth_spec=AuthSpec(
            auth_type='token',
            fields=(
                FieldDescriptor(name='domain', field_type='string', required=True, description='Base domain (e.g. company.base.vn)'),
                FieldDescriptor(name='access_token', field_type='string', required=True, description='API access token (NOT v2)'),
            ),
            test_connection_operation='test_connection',
        ),
        api_prefix='/extapi/v1',
        base_url_template='https://meeting.{domain}/extapi/v1',
        supported_modules=('pipeline',),
        streams=(
            StreamDefinition(stream_key='groups', display_name='Groups', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='meetings', display_name='Meetings', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', config_fields=(FieldDescriptor(name='group_id', field_type='string', required=False, description='Meeting group ID'),)),
            StreamDefinition(stream_key='repeated_meetings', display_name='Repeated Meetings', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
        ),
    )
