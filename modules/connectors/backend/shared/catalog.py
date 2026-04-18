from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.database.src.models import AppCredential

from .contracts import (
    AuthSpec,
    ConnectorDefinition,
    FieldDescriptor,
    OperationSpec,
    StreamDefinition,
)


# ── Shared auth specs ─────────────────────────────────────────────────────────

_BASE_TOKEN_AUTH = AuthSpec(
    auth_type='token',
    fields=(
        FieldDescriptor(name='domain', field_type='string', required=True, description='Base domain (e.g. company.base.vn)'),
        FieldDescriptor(name='access_token', field_type='string', required=True, description='API access token (access_token_v2)'),
    ),
    test_connection_operation='test_connection',
)

_GOOGLE_AUTH = AuthSpec(
    auth_type='google_oauth',
    fields=(
        FieldDescriptor(name='auth_mode', field_type='string', required=True, description='google_oauth or service_account'),
    ),
    supported_auth_modes=('google_oauth', 'service_account'),
)


# ── Shared connection config (UI form labels / help text) ─────────────────────

_BASE_CONNECTION_CONFIG = {
    'step_title': 'Base Connection',
    'step_description': 'Provide the domain and Base Account access token.',
    'domain_label': 'Base Domain',
    'domain_placeholder': 'company.base.com.vn',
    'domain_help': 'Enter your Base domain (e.g. company.base.com.vn). The backend will normalize it.',
    'token_label': 'Access Token V2',
    'token_placeholder': 'Paste your Base Account access_token_v2 here…',
    'token_help': 'Get this from Settings → API Keys. Use the Base Account access_token_v2.',
}

_GOOGLE_CONNECTION_CONFIG = {
    'step_title': 'Google Connection',
    'step_description': 'Connect via Google OAuth or a Service Account.',
    'auth_mode_label': 'Authentication Mode',
    'auth_mode_help': 'Choose google_oauth for interactive login or service_account for server-to-server.',
}


# ── Connector Registry ────────────────────────────────────────────────────────
# Each entry is a ConnectorDefinition with stream-level granularity.
# Connectors are NOT classified as "source" or "destination" at app level.
# Instead, each *stream* within a connector declares its own capabilities.

CONNECTOR_REGISTRY: tuple[ConnectorDefinition, ...] = (

    # ── Base Service ──────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='service',
        display_name='Base Service',
        summary='Services, tickets, and activity logs from Base Service.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://service.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline', 'automation'),
        icon='headphones',
        color='#059669',
        bg_color='#f0fdf4',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='services',
                display_name='Services',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                read_operation='get_all_services',
            ),
            StreamDefinition(
                stream_key='compounds',
                display_name='Compounds',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                read_operation='get_all_compounds',
            ),
            StreamDefinition(
                stream_key='groups',
                display_name='Groups',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                read_operation='get_all_groups',
            ),
            StreamDefinition(
                stream_key='stages',
                display_name='Stages',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='services',
                read_operation='get_service_blocks',
            ),
            StreamDefinition(
                stream_key='tickets',
                display_name='Tickets',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                primary_key='id',
                parent_stream='services',
                read_operation='get_all_tickets',
                write_operation='create_ticket',
            ),
            StreamDefinition(
                stream_key='ticket_details',
                display_name='Ticket Details',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='tickets',
                read_operation='get_ticket_details',
            ),
            StreamDefinition(
                stream_key='activity_logs',
                display_name='Activity Logs',
                capabilities=('read',),
                sync_modes=('full_refresh', 'incremental'),
                cursor_field='last_update',
                read_operation='get_ticket_activity_logs',
            ),
        ),
        operations=(
            OperationSpec(operation_key='get_all_services', summary='List all services', api_endpoint='/service/get.all', response_selector='services'),
            OperationSpec(operation_key='get_all_compounds', summary='List all compounds', api_endpoint='/compound/get.all', response_selector='compound_blocks'),
            OperationSpec(operation_key='get_all_groups', summary='List all groups', api_endpoint='/group/get.all', response_selector='groups'),
            OperationSpec(operation_key='get_service_blocks', summary='List stages for a service', api_endpoint='/service/get.stages', required_fields=('service_id',), response_selector='stages'),
            OperationSpec(operation_key='get_all_tickets', summary='List tickets for a service', api_endpoint='/ticket/get.all', required_fields=('service_id',), response_selector='tickets'),
            OperationSpec(operation_key='get_ticket_details', summary='Get ticket details', api_endpoint='/ticket/get.detail', required_fields=('id',), response_selector='ticket'),
            OperationSpec(operation_key='get_ticket_activity_logs', summary='Get ticket activity logs', api_endpoint='/ticket/get.activity.logs', pagination='page'),
            OperationSpec(operation_key='get_possible_transitions', summary='Get possible ticket transitions', api_endpoint='/ticket/get.possible.actions', required_fields=('ticket_id', 'username')),
            OperationSpec(operation_key='create_ticket', summary='Create a ticket', api_endpoint='/ticket/create', required_fields=('username', 'service_id', 'block_id', 'name'), capability='write'),
            OperationSpec(operation_key='update_ticket', summary='Update a ticket', api_endpoint='/ticket/edit', required_fields=('service_id', 'ticket_id', 'username', 'name'), capability='write'),
            OperationSpec(operation_key='update_ticket_custom_fields', summary='Update ticket custom fields', api_endpoint='/ticket/edit.custom.fields', required_fields=('service_id', 'ticket_id', 'username', 'custom_field_ids'), capability='write'),
            OperationSpec(operation_key='assign_ticket', summary='Assign a ticket', api_endpoint='/ticket/assign', required_fields=('ticket_id', 'username', 'assignees'), capability='write'),
            OperationSpec(operation_key='execute_ticket', summary='Execute a ticket step', api_endpoint='/ticket/execute', required_fields=('ticket_id', 'username'), capability='write'),
            OperationSpec(operation_key='move_ticket_to_block', summary='Move ticket to a block', api_endpoint='/ticket/move.to.block', required_fields=('ticket_id', 'username', 'next_block_id'), capability='write'),
            OperationSpec(operation_key='move_ticket_back', summary='Move ticket back', api_endpoint='/ticket/move.back', required_fields=('ticket_id', 'username'), capability='write'),
        ),
    ),

    # ── Base Request ──────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='request',
        display_name='Base Request',
        summary='Groups, requests, posts and comments from Base Request.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://request.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='inbox',
        color='#ea580c',
        bg_color='#fff7ed',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='groups',
                display_name='Groups',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                read_operation='get_all_groups',
            ),
            StreamDefinition(
                stream_key='requests',
                display_name='Requests',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                primary_key='id',
                parent_stream='groups',
                read_operation='get_requests',
                write_operation='create_request',
            ),
            StreamDefinition(
                stream_key='request_details',
                display_name='Request Details',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='requests',
                read_operation='get_request',
            ),
            StreamDefinition(
                stream_key='request_custom_tables',
                display_name='Custom Tables',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='requests',
                read_operation='get_request_with_custom_table',
            ),
            StreamDefinition(
                stream_key='posts',
                display_name='Posts',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                parent_stream='requests',
                read_operation='get_posts',
            ),
            StreamDefinition(
                stream_key='comments',
                display_name='Comments',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                parent_stream='posts',
                read_operation='get_comments',
            ),
        ),
        operations=(
            OperationSpec(operation_key='get_all_groups', summary='List all groups', api_endpoint='/group/list', pagination='page'),
            OperationSpec(operation_key='get_group', summary='Get a group', api_endpoint='/group/get', required_fields=('id',)),
            OperationSpec(operation_key='get_requests', summary='List requests in a group', api_endpoint='/request/list', required_fields=('group',), pagination='page'),
            OperationSpec(operation_key='get_request', summary='Get a request', api_endpoint='/request/get', required_fields=('id',)),
            OperationSpec(operation_key='get_request_with_custom_table', summary='Get request with custom table', api_endpoint='/request/custom.table', required_fields=('id',)),
            OperationSpec(operation_key='get_posts', summary='Get posts of a request', api_endpoint='/request/post/load', required_fields=('id',)),
            OperationSpec(operation_key='get_comments', summary='Get comments of a post', api_endpoint='/request/comment/load', required_fields=('hid',)),
            OperationSpec(operation_key='create_request', summary='Create a request', api_endpoint='/request/create', required_fields=('username', 'group_id', 'name'), capability='write'),
            OperationSpec(operation_key='add_follower', summary='Add follower to a request', api_endpoint='/request/add.follower', required_fields=('id', 'username', 'followers'), capability='write'),
        ),
    ),

    # ── Base Workflow ─────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='workflow',
        display_name='Base Workflow',
        summary='Workflows, stages, jobs, posts and comments from Base Workflow.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://workflow.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='folder-kanban',
        color='#7c3aed',
        bg_color='#f5f3ff',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='workflows',
                display_name='Workflows',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                read_operation='get_all_workflows',
            ),
            StreamDefinition(
                stream_key='stages',
                display_name='Stages',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='workflows',
                read_operation='get_workflow_stages',
            ),
            StreamDefinition(
                stream_key='jobs',
                display_name='Jobs',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                primary_key='id',
                parent_stream='workflows',
                read_operation='get_workflow_jobs',
                write_operation='create_job',
            ),
            StreamDefinition(
                stream_key='job_details',
                display_name='Job Details',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='jobs',
                read_operation='get_job',
            ),
            StreamDefinition(
                stream_key='job_custom_tables',
                display_name='Job Custom Tables',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                parent_stream='jobs',
                read_operation='get_job_custom_table',
            ),
            StreamDefinition(
                stream_key='posts',
                display_name='Posts',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                parent_stream='jobs',
                read_operation='get_job_posts',
            ),
            StreamDefinition(
                stream_key='comments',
                display_name='Comments',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                parent_stream='posts',
                read_operation='get_job_comments',
            ),
        ),
        operations=(
            OperationSpec(operation_key='get_all_workflows', summary='List all workflows', api_endpoint='/workflows/get', pagination='page'),
            OperationSpec(operation_key='get_workflow', summary='Get a workflow', api_endpoint='/workflow/get', required_fields=('id',)),
            OperationSpec(operation_key='get_workflow_stages', summary='List stages in a workflow', api_endpoint='/workflow/stages', required_fields=('id',)),
            OperationSpec(operation_key='get_workflow_jobs', summary='List jobs in a workflow', api_endpoint='/workflow/jobs', required_fields=('id',), pagination='cursor'),
            OperationSpec(operation_key='get_all_jobs', summary='List all jobs with filters', api_endpoint='/jobs/get', pagination='cursor'),
            OperationSpec(operation_key='get_job', summary='Get a job', api_endpoint='/job/get', required_fields=('id',)),
            OperationSpec(operation_key='get_job_custom_table', summary='Get job custom table', api_endpoint='/job/custom.table', required_fields=('id',)),
            OperationSpec(operation_key='get_job_posts', summary='Get posts of a job', api_endpoint='/job/post/load', required_fields=('id',)),
            OperationSpec(operation_key='get_job_comments', summary='Get comments of a post', api_endpoint='/job/comment/load', required_fields=('hid',)),
            OperationSpec(operation_key='create_job', summary='Create a job', api_endpoint='/job/create', required_fields=('creator_username', 'workflow_id', 'name'), capability='write'),
            OperationSpec(operation_key='edit_job', summary='Edit a job', api_endpoint='/job/edit', required_fields=('id',), capability='write'),
            OperationSpec(operation_key='move_next', summary='Move job to next stage', api_endpoint='/job/next', required_fields=('id', 'mover_username'), capability='write'),
            OperationSpec(operation_key='move_back', summary='Move job back', api_endpoint='/job/back', required_fields=('id', 'mover_username', 'stage_id'), capability='write'),
            OperationSpec(operation_key='mark_failed', summary='Mark job as failed', api_endpoint='/job/fail', required_fields=('id', 'username', 'failed_reason_id'), capability='write'),
        ),
    ),

    # ── Base WeWork ───────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='wework',
        display_name='Base WeWork',
        summary='Departments, projects, tasks and subtasks from Base WeWork.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v3',
        base_url_template='https://wework.{domain}/extapi/v3',
        supported_modules=('backup', 'pipeline'),
        icon='building-2',
        color='#2563eb',
        bg_color='#eff6ff',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='departments',
                display_name='Departments',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                primary_key='id',
                read_operation='get_all_departments',
                write_operation='create_department',
            ),
            StreamDefinition(
                stream_key='projects',
                display_name='Projects',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='departments',
                read_operation='get_all_projects',
                write_operation='create_project',
            ),
            StreamDefinition(
                stream_key='tasks',
                display_name='Tasks',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                primary_key='id',
                parent_stream='projects',
                read_operation='get_project_tasks',
                write_operation='create_task',
            ),
            StreamDefinition(
                stream_key='subtasks',
                display_name='Subtasks',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='tasks',
                read_operation='get_task',
                write_operation='create_subtask',
            ),
            StreamDefinition(
                stream_key='tasklists',
                display_name='Tasklists',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='id',
                parent_stream='projects',
                read_operation='get_tasklist',
            ),
        ),
        operations=(
            OperationSpec(operation_key='get_all_departments', summary='List all departments', api_endpoint='/dept/list'),
            OperationSpec(operation_key='get_department', summary='Get a department', api_endpoint='/dept/get', required_fields=('id',)),
            OperationSpec(operation_key='get_all_projects', summary='List all projects', api_endpoint='/project/list'),
            OperationSpec(operation_key='get_project_full', summary='Get full project details', api_endpoint='/project/get.full', required_fields=('id',)),
            OperationSpec(operation_key='get_task', summary='Get a task', api_endpoint='/task/get', required_fields=('id',)),
            OperationSpec(operation_key='get_project_tasks', summary='List tasks by project', api_endpoint='/task/project', required_fields=('id', 'username'), pagination='page'),
            OperationSpec(operation_key='get_tasklist', summary='Get a tasklist', api_endpoint='/tasklist/get', required_fields=('id',)),
            OperationSpec(operation_key='create_department', summary='Create a department', api_endpoint='/dept/create', required_fields=('username', 'name'), capability='write'),
            OperationSpec(operation_key='edit_department', summary='Edit a department', api_endpoint='/dept/edit', required_fields=('username', 'id', 'name'), capability='write'),
            OperationSpec(operation_key='remove_department', summary='Remove a department', api_endpoint='/dept/remove', required_fields=('username', 'id'), capability='write'),
            OperationSpec(operation_key='create_project', summary='Create a project', api_endpoint='/project/create', required_fields=('username', 'metatype', 'name', 'external'), capability='write'),
            OperationSpec(operation_key='edit_project', summary='Edit a project', api_endpoint='/project/edit', required_fields=('username', 'id', 'name'), capability='write'),
            OperationSpec(operation_key='create_task', summary='Create a task', api_endpoint='/task/create', required_fields=('username', 'id', 'name'), capability='write'),
            OperationSpec(operation_key='create_subtask', summary='Create a subtask', api_endpoint='/subtask/create', required_fields=('username', 'parent_id', 'name'), capability='write'),
            OperationSpec(operation_key='edit_task', summary='Edit a task', api_endpoint='/task/edit', required_fields=('username', 'id'), capability='write'),
            OperationSpec(operation_key='edit_task_extra', summary='Edit task extra fields', api_endpoint='/task/edit.extra', required_fields=('username', 'id'), capability='write'),
            OperationSpec(operation_key='mark_task_done', summary='Mark task as done', api_endpoint='/task/status/mark.done', required_fields=('username', 'id'), capability='write'),
            OperationSpec(operation_key='delete_task', summary='Delete a task', api_endpoint='/task/remove', required_fields=('username', 'id'), capability='write'),
            OperationSpec(operation_key='add_task_followers', summary='Add task followers', api_endpoint='/task/add.followers', required_fields=('username', 'id', 'followers'), capability='write'),
        ),
    ),

    # ── Google Sheets ─────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='gsheets',
        display_name='Google Sheets',
        summary='Read and write structured data in Google Sheets spreadsheets.',
        auth_spec=_GOOGLE_AUTH,
        base_url_template='https://sheets.googleapis.com/v4',
        supported_modules=('pipeline',),
        icon='file-spreadsheet',
        color='#0f9d58',
        bg_color='#e6f4ea',
        connection_config=_GOOGLE_CONNECTION_CONFIG,
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
            ),
            StreamDefinition(
                stream_key='rows',
                display_name='Sheet Rows',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                parent_stream='sheets',
            ),
        ),
        notes=(
            'Pipeline reuses Apps credentials and shared validation.',
            'Runtime sync writes into a stable spreadsheet/tab layout per flow.',
        ),
    ),

    # ── Google Drive ──────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='gdrive',
        display_name='Google Drive',
        summary='Folders and files in Google Drive for backup and pipeline destinations.',
        auth_spec=_GOOGLE_AUTH,
        base_url_template='https://www.googleapis.com/drive/v3',
        supported_modules=('backup', 'pipeline'),
        icon='folder',
        color='#1a73e8',
        bg_color='#e8f0fe',
        connection_config=_GOOGLE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(
                stream_key='drives',
                display_name='Shared Drives',
                capabilities=('read',),
                sync_modes=('full_refresh',),
                primary_key='drive_id',
            ),
            StreamDefinition(
                stream_key='folders',
                display_name='Folders',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh',),
                primary_key='folder_id',
            ),
            StreamDefinition(
                stream_key='files',
                display_name='Files',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                primary_key='file_id',
            ),
        ),
    ),

    # ── BigQuery ──────────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='bigquery',
        display_name='BigQuery',
        summary='Warehouse destination for structured sync jobs with append/replace strategies.',
        icon='database',
        color='#4285f4',
        bg_color='#e8f0fe',
        connection_config=_GOOGLE_CONNECTION_CONFIG,
        auth_spec=AuthSpec(
            auth_type='google_oauth',
            fields=(
                FieldDescriptor(name='auth_mode', field_type='string', required=True, description='google_oauth or service_account'),
                FieldDescriptor(name='project_id', field_type='string', required=True, description='GCP project ID'),
                FieldDescriptor(name='dataset_id', field_type='string', required=True, description='BigQuery dataset ID'),
            ),
            supported_auth_modes=('google_oauth', 'service_account'),
        ),
        base_url_template='https://bigquery.googleapis.com/bigquery/v2',
        supported_modules=('pipeline',),
        status='planned',
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
            ),
            StreamDefinition(
                stream_key='rows',
                display_name='Table Rows',
                capabilities=('read', 'write'),
                sync_modes=('full_refresh', 'incremental'),
                parent_stream='tables',
            ),
        ),
        notes=(
            'BigQuery destination profiles are not available in Apps yet.',
            'Apps credential support, validation, and writer runtime will land in a later phase.',
        ),
    ),

    # ── Base CRM ──────────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='crm',
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
                FieldDescriptor(name='domain', field_type='string', required=True, description='Base domain (e.g. company.base.vn)'),
                FieldDescriptor(name='access_token', field_type='string', required=True, description='API access token'),
                FieldDescriptor(name='password', field_type='string', required=True, description='API password'),
            ),
            test_connection_operation='test_connection',
        ),
        base_url_template='https://apis.{domain}',
        supported_modules=('backup', 'pipeline'),
        streams=(
            StreamDefinition(stream_key='pipelines', display_name='Pipelines', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='pipeline_stages', display_name='Pipeline Stages', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='pipelines'),
            StreamDefinition(stream_key='deals', display_name='Deals', capabilities=('read',), sync_modes=('full_refresh', 'incremental'), primary_key='id'),
            StreamDefinition(stream_key='deal_activities', display_name='Deal Activities', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='deals'),
            StreamDefinition(stream_key='accounts', display_name='Accounts', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='account_services', display_name='Account Services', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='accounts'),
            StreamDefinition(stream_key='contacts', display_name='Contacts', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='contact_services', display_name='Contact Services', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='contacts'),
            StreamDefinition(stream_key='leads', display_name='Leads', capabilities=('read',), sync_modes=('full_refresh', 'incremental'), primary_key='id'),
            StreamDefinition(stream_key='lead_feeds', display_name='Lead Feeds', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='leads'),
        ),
    ),

    # ── Base HRM ──────────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='hrm',
        display_name='Base HRM',
        summary='Employees, departments, positions, merits, payroll and checkin data from Base HRM.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://hrm.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='users',
        color='#0891b2',
        bg_color='#ecfeff',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='employees', display_name='Employees', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='employee_details', display_name='Employee Details', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='employees'),
            StreamDefinition(stream_key='departments', display_name='Departments', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='positions', display_name='Positions', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='levels', display_name='Levels', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='groups', display_name='Groups', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='teams', display_name='Teams', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='employee_types', display_name='Employee Types', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='merits', display_name='Merits', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='merit_details', display_name='Merit Details', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='merits'),
            StreamDefinition(stream_key='merit_employees', display_name='Merit Employees', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='merits'),
            StreamDefinition(stream_key='merit_categories', display_name='Merit Categories', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='merit_types', display_name='Merit Types', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='payroll_cycles', display_name='Payroll Cycles', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='payroll_detail', display_name='Payroll Detail', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='payroll_cycles'),
            StreamDefinition(stream_key='payroll_summary', display_name='Payroll Summary', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='payroll_cycles'),
            StreamDefinition(stream_key='payroll_categories', display_name='Payroll Categories', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='payroll_formulas', display_name='Payroll Formulas', capabilities=('read',), sync_modes=('full_refresh',)),
            StreamDefinition(stream_key='checkin_logs', display_name='Checkin Logs', capabilities=('read',), sync_modes=('full_refresh', 'incremental')),
            StreamDefinition(stream_key='checkin_offers', display_name='Checkin Offers', capabilities=('read',), sync_modes=('full_refresh',)),
            StreamDefinition(stream_key='checkin_schedules', display_name='Checkin Schedules', capabilities=('read',), sync_modes=('full_refresh',)),
            StreamDefinition(stream_key='checkin_shifts', display_name='Checkin Shifts', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='checkin_holiday_schedules', display_name='Holiday Schedules', capabilities=('read',), sync_modes=('full_refresh',)),
            StreamDefinition(stream_key='checkin_summary', display_name='Checkin Summary', capabilities=('read',), sync_modes=('full_refresh',)),
        ),
    ),

    # ── Base Table ────────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='table',
        display_name='Base Table',
        summary='Read and write records in Base Table databases.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://table.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='layout-grid',
        color='#4f46e5',
        bg_color='#eef2ff',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='records', display_name='Records', capabilities=('read', 'write'), sync_modes=('full_refresh',), primary_key='id'),
        ),
    ),

    # ── Base Goal ─────────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='goal',
        display_name='Base Goal',
        summary='Cycles, goals, key results and targets from Base Goal.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://goal.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='target',
        color='#ca8a04',
        bg_color='#fefce8',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='cycles', display_name='Cycles', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='goals', display_name='Goals', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='cycles'),
            StreamDefinition(stream_key='goal_details', display_name='Goal Details', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='goals'),
            StreamDefinition(stream_key='key_results', display_name='Key Results', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='goals'),
            StreamDefinition(stream_key='key_result_details', display_name='Key Result Details', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='key_results'),
            StreamDefinition(stream_key='targets', display_name='Targets', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='key_results'),
            StreamDefinition(stream_key='target_checkins', display_name='Target Checkins', capabilities=('read',), sync_modes=('full_refresh',), parent_stream='targets'),
        ),
    ),

    # ── Base Income ───────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='income',
        display_name='Base Income',
        summary='Incomes and inflows from Base Income.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://income.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='dollar-sign',
        color='#16a34a',
        bg_color='#f0fdf4',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='incomes', display_name='Incomes', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='inflows', display_name='Inflows', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
        ),
    ),

    # ── Base Meeting ──────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='meeting',
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
        supported_modules=('backup', 'pipeline'),
        streams=(
            StreamDefinition(stream_key='groups', display_name='Groups', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='meetings', display_name='Meetings', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='repeated_meetings', display_name='Repeated Meetings', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
        ),
    ),

    # ── Base Payroll ──────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='payroll',
        display_name='Base Payroll',
        summary='Payroll cycles, payrolls and records from Base Payroll.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://payroll.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='wallet',
        color='#0d9488',
        bg_color='#f0fdfa',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='cycles', display_name='Cycles', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
            StreamDefinition(stream_key='payrolls', display_name='Payrolls', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id', parent_stream='cycles'),
            StreamDefinition(stream_key='records', display_name='Records', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
        ),
    ),

    # ── Base Timeoff ──────────────────────────────────────────────────────
    ConnectorDefinition(
        connector_key='timeoff',
        display_name='Base Timeoff',
        summary='Time-off requests and groups from Base Timeoff.',
        auth_spec=_BASE_TOKEN_AUTH,
        api_prefix='/extapi/v1',
        base_url_template='https://timeoff.{domain}/extapi/v1',
        supported_modules=('backup', 'pipeline'),
        icon='clock',
        color='#f59e0b',
        bg_color='#fffbeb',
        connection_config=_BASE_CONNECTION_CONFIG,
        streams=(
            StreamDefinition(stream_key='timeoffs', display_name='Timeoffs', capabilities=('read',), sync_modes=('full_refresh', 'incremental'), primary_key='id'),
            StreamDefinition(stream_key='groups', display_name='Groups', capabilities=('read',), sync_modes=('full_refresh',), primary_key='id'),
        ),
    ),
)


# ── Lookup helpers ────────────────────────────────────────────────────────────

def get_connector(connector_key: str) -> ConnectorDefinition | None:
    for connector in CONNECTOR_REGISTRY:
        if connector.connector_key == connector_key:
            return connector
    return None


def get_all_connector_keys() -> set[str]:
    return {c.connector_key for c in CONNECTOR_REGISTRY}


def get_readable_connector_keys() -> set[str]:
    return {c.connector_key for c in CONNECTOR_REGISTRY if c.get_readable_streams()}


def get_writable_connector_keys() -> set[str]:
    return {c.connector_key for c in CONNECTOR_REGISTRY if c.get_writable_streams()}


# ── Catalog service ───────────────────────────────────────────────────────────

class ConnectorCatalogService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── New stream-level API ──────────────────────────────────────────────

    async def list_connectors(self) -> list[dict[str, object]]:
        counts = await self._load_credential_counts()
        return [c.to_payload(credential_count=counts.get(c.connector_key, 0)) for c in CONNECTOR_REGISTRY]

    async def list_connectors_by_capability(self, capability: str) -> list[dict[str, object]]:
        counts = await self._load_credential_counts()
        result: list[dict[str, object]] = []
        for c in CONNECTOR_REGISTRY:
            matching_streams = [s for s in c.streams if capability in s.capabilities]
            if matching_streams:
                result.append(c.to_payload(credential_count=counts.get(c.connector_key, 0)))
        return result

    async def get_connector_detail(self, connector_key: str) -> dict[str, object] | None:
        connector = get_connector(connector_key)
        if connector is None:
            return None
        counts = await self._load_credential_counts()
        return connector.to_payload(credential_count=counts.get(connector.connector_key, 0))

    async def get_stream_detail(self, connector_key: str, stream_key: str) -> dict[str, object] | None:
        connector = get_connector(connector_key)
        if connector is None:
            return None
        stream = connector.get_stream(stream_key)
        if stream is None:
            return None
        return stream.to_payload()

    # ── Backward-compatible API (used by Pipeline overview and Backup) ────

    async def list_source_readers(self) -> list[dict[str, object]]:
        counts = await self._load_credential_counts()
        return [
            c.as_source_reader_payload(credential_count=counts.get(c.connector_key, 0))
            for c in CONNECTOR_REGISTRY
            if c.get_readable_streams() and c.status != 'planned'
        ]

    async def list_destination_writers(self) -> list[dict[str, object]]:
        counts = await self._load_credential_counts()
        return [
            c.as_destination_writer_payload(credential_count=counts.get(c.connector_key, 0))
            for c in CONNECTOR_REGISTRY
            if c.get_writable_streams() and 'pipeline' in c.supported_modules
            and c.connector_key not in get_readable_connector_keys() - get_writable_connector_keys()
            # Only include connectors that are primarily destinations or explicitly support pipeline writes
            and c.connector_key in {'gsheets', 'gdrive', 'bigquery'}
        ]

    async def build_pipeline_catalog(self) -> dict[str, object]:
        sources = await self.list_source_readers()
        destinations = await self.list_destination_writers()
        return {
            'sources': sources,
            'destinations': destinations,
            'source_credential_count': sum(int(item.get('credential_count') or 0) for item in sources),
            'destination_credential_count': sum(int(item.get('credential_count') or 0) for item in destinations),
            'ready_destination_count': sum(1 for item in destinations if item.get('status') == 'ready'),
            'planned_destination_count': sum(1 for item in destinations if item.get('status') == 'planned'),
        }

    # ── Internal helpers ──────────────────────────────────────────────────

    async def _load_credential_counts(self) -> dict[str, int]:
        result = await self.db.execute(
            select(AppCredential.app_id, func.count(AppCredential.id))
            .group_by(AppCredential.app_id)
        )
        return {str(app_id): int(count or 0) for app_id, count in result.all()}