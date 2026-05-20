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
        connector_key='base_goal',
        display_name='Base Goal',
        summary='Cycles, goals, key results and targets from Base Goal.',
        auth_spec=BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://goal.{domain}/extapi/v1',
        supported_modules=('pipeline',),
        icon='target',
        color='#ca8a04',
        bg_color='#fefce8',
        connection_config=BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='cycles', display_name='Cycles', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='goals', display_name='Goals', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='cycles', config_fields=(FieldDescriptor(name='goal_id', field_type='string', required=True, description='Goal ID'),)),
            StreamDefinition(stream_key='goal_details', display_name='Goal Details', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='goals', config_fields=(FieldDescriptor(name='goal_id', field_type='string', required=True, description='Goal ID'),)),
            StreamDefinition(stream_key='key_results', display_name='Key Results', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='goals', config_fields=(FieldDescriptor(name='kr_id', field_type='string', required=True, description='Key result ID'),)),
            StreamDefinition(stream_key='key_result_details', display_name='Key Result Details', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='key_results', config_fields=(FieldDescriptor(name='kr_id', field_type='string', required=True, description='Key result ID'),)),
            StreamDefinition(stream_key='targets', display_name='Targets', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='key_results', config_fields=(FieldDescriptor(name='target_id', field_type='string', required=True, description='Target ID'),)),
            StreamDefinition(stream_key='target_checkins', display_name='Target Checkins', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='targets', config_fields=(FieldDescriptor(name='path', field_type='string', required=True, description='Cycle path'),)),
        ),
    )
