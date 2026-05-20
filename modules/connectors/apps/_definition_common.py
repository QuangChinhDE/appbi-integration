from __future__ import annotations

from modules.connectors.backend.shared.contracts import (
    AuthSpec,
    ConnectorDefinition,
    FieldDescriptor,
    OperationSpec,
    StreamDefinition,
    WriteConfig,
)


# Shared auth and connection UI presets used by packaged app definitions.
BASE_TOKEN_AUTH = AuthSpec(
    auth_type='token',
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
            description='API access token (access_token_v2)',
            secret=True,
            storage='auth',
            input_kind='password',
        ),
    ),
    test_connection_operation='test_connection',
)

GOOGLE_AUTH = AuthSpec(
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
    ),
    supported_auth_modes=('google_oauth', 'service_account'),
)

MICROSOFT_STORAGE_AUTH = AuthSpec(
    auth_type='microsoft_oauth',
    fields=(
        FieldDescriptor(
            name='auth_mode',
            field_type='string',
            required=False,
            description='access_token or microsoft_oauth',
            storage='auth',
            input_kind='select',
        ),
        FieldDescriptor(
            name='access_token',
            field_type='string',
            required=True,
            description='Microsoft Graph access token with OneDrive file permissions',
            secret=True,
            storage='auth',
            input_kind='password',
        ),
        FieldDescriptor(
            name='refresh_token',
            field_type='string',
            required=False,
            description='Optional Microsoft refresh token for long-running backups',
            secret=True,
            storage='auth',
            input_kind='password',
        ),
        FieldDescriptor(
            name='client_id',
            field_type='string',
            required=False,
            description='Optional Azure app client ID used with refresh_token',
            storage='auth',
        ),
        FieldDescriptor(
            name='client_secret',
            field_type='string',
            required=False,
            description='Optional Azure app client secret used with refresh_token',
            secret=True,
            storage='auth',
            input_kind='password',
        ),
        FieldDescriptor(
            name='tenant_id',
            field_type='string',
            required=False,
            description='Azure tenant ID, or common for multi-tenant OAuth',
            storage='auth',
        ),
        FieldDescriptor(
            name='token_expiry',
            field_type='string',
            required=False,
            description='Optional ISO timestamp for access token expiry',
            storage='auth',
        ),
        FieldDescriptor(
            name='account_email',
            field_type='string',
            required=False,
            description='Optional account label shown in Apps/Backup UI',
            storage='auth',
        ),
    ),
    supported_auth_modes=('access_token', 'microsoft_oauth'),
)

BASE_CONNECTION_CONFIG = {
    'step_title': 'Base Connection',
    'step_description': 'Provide the domain and Base Account access token.',
    'domain_label': 'Base Domain',
    'domain_placeholder': 'company.base.com.vn',
    'domain_help': 'Enter your Base domain (e.g. company.base.com.vn). The backend will normalize it.',
    'token_label': 'Access Token V2',
    'token_placeholder': 'Paste your Base Account access_token_v2 here…',
    'token_help': 'Get this from Settings → API Keys. Use the Base Account access_token_v2.',
}

GOOGLE_CONNECTION_CONFIG = {
    'step_title': 'Google Connection',
    'step_description': 'Connect via Sign in or a Service Account.',
    'auth_mode_label': 'Authentication Mode',
    'auth_mode_help': 'Choose Sign in for interactive login or Service account for server-to-server.',
}

MICROSOFT_CONNECTION_CONFIG = {
    'step_title': 'Microsoft OneDrive Connection',
    'step_description': 'Connect with Microsoft Graph access to OneDrive files.',
    'auth_mode_label': 'Authentication Mode',
    'auth_mode_help': 'Use an access token now; add refresh token/client details for scheduled backups.',
}
