-- ============================================================
-- Helper: auto-update updated_at on any UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================================
-- app_config: key-value settings (secrets stored encrypted)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    is_secret BOOLEAN DEFAULT FALSE,   -- TRUE = value is Fernet-encrypted
    description VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_app_config_updated_at
    BEFORE UPDATE ON app_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- backup_source_apps: stores API call definitions per app
-- ============================================================
CREATE TABLE IF NOT EXISTS backup_source_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL UNIQUE,
    app_name VARCHAR(100) NOT NULL,
    base_url_template VARCHAR(500) NOT NULL,
    api_steps JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_source_apps_app_id ON backup_source_apps (app_id);

CREATE TRIGGER update_backup_source_apps_updated_at
    BEFORE UPDATE ON backup_source_apps
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

INSERT INTO backup_source_apps (app_id, app_name, base_url_template, api_steps) VALUES (
    'request',
    'Request',
    'https://request.{domain}/extapi/v1',
    '[
      {
        "order": 1,
        "key": "list_groups",
        "description": "Fetch all groups with pagination (20 per page). Stop when count < 20.",
        "endpoint": "/group/list",
        "method": "POST",
        "content_type": "application/x-www-form-urlencoded",
        "params": {
          "access_token_v2": "__access_token__",
          "page": "__page__"
        },
        "pagination": {
          "param": "page",
          "start": 1,
          "increment": 1,
          "stop_when": "response_count_less_than",
          "stop_value": 20
        },
        "extract": {
          "list_key": "groups",
          "fields": ["id", "name"]
        }
      },
      {
        "order": 2,
        "key": "list_requests",
        "description": "Fetch requests per group. Uses limit=1 per page for memory efficiency. Stop when response is empty.",
        "for_each_from_step": "list_groups",
        "for_each_item_field": "id",
        "inject_as_param": "group",
        "endpoint": "/request/list",
        "method": "POST",
        "content_type": "application/x-www-form-urlencoded",
        "params": {
          "access_token_v2": "__access_token__",
          "group": "__group_id__",
          "page": "__page__",
          "limit": "1"
        },
        "pagination": {
          "param": "page",
          "start": 0,
          "increment": 1,
          "stop_when": "response_empty"
        },
        "extract": {
          "list_key": "requests",
          "fields": [
            "id", "name", "since", "last_update",
            "followers", "owners", "approvals", "rejecters",
            "group_id", "stats", "form"
          ],
          "form_include_types": ["text", "number", "date", "select", "radio", "checkbox"],
          "form_skip_types": ["input-table", "select-master"]
        },
        "skip": ["files", "posts", "comments"]
      }
    ]'::jsonb
);

-- ============================================================
-- google_connections: stores OAuth tokens for Google Drive/Sheets
-- ============================================================
CREATE TABLE IF NOT EXISTS google_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    picture_url VARCHAR(500),
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    token_expiry TIMESTAMP WITH TIME ZONE,
    scopes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_google_connections_email ON google_connections (email);

CREATE TRIGGER update_google_connections_updated_at
    BEFORE UPDATE ON google_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- app_credentials: unified registry owned by the Apps module.
-- Role-neutral. Backup decides whether a given credential is used
-- as a source or a destination at flow-configuration time.
-- ============================================================
CREATE TABLE IF NOT EXISTS app_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description VARCHAR(500),
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    app_id VARCHAR(50) NOT NULL CHECK (
        app_id IN ('request', 'workflow', 'wework', 'service', 'gdrive', 'gsheets')
    ),
    app_name VARCHAR(100) NOT NULL,
    auth_mode VARCHAR(50) NOT NULL CHECK (
        auth_mode IN ('access_token', 'google_oauth', 'service_account')
    ),
    auth JSONB NOT NULL,
    config JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_app_credentials_app_id ON app_credentials (app_id);
CREATE INDEX idx_app_credentials_auth_mode ON app_credentials (auth_mode);
CREATE INDEX idx_app_credentials_owner_id ON app_credentials (owner_id);
CREATE INDEX idx_app_credentials_created_at ON app_credentials (created_at DESC);

CREATE TRIGGER update_app_credentials_updated_at
    BEFORE UPDATE ON app_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- backup_flows: a backup job. References app_credentials for role.
-- ============================================================
CREATE TABLE IF NOT EXISTS backup_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,

    source_credential_id UUID REFERENCES app_credentials(id) ON DELETE RESTRICT,
    destination_credential_id UUID REFERENCES app_credentials(id) ON DELETE RESTRICT,

    -- Per-flow destination target (folder/drive selected for this backup).
    -- Example: { "folder_id": "...", "folder_name": "...", "drive_id": "...", "drive_name": "..." }
    destination_target JSONB,

    backup_type VARCHAR(50) CHECK (backup_type IS NULL OR backup_type IN ('structured', 'unstructured', 'all')),

    structure JSONB,
    schedule JSONB,

    is_draft SMALLINT DEFAULT 1 CHECK (is_draft IN (0, 1)),
    is_published SMALLINT DEFAULT 0 CHECK (is_published IN (0, 1)),

    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),

    last_run_at TIMESTAMP,
    last_run_status VARCHAR(20) CHECK (last_run_status IN ('completed', 'failed', 'running')),
    last_run_message TEXT,

    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_backup_flows_source_credential ON backup_flows (source_credential_id);
CREATE INDEX idx_backup_flows_destination_credential ON backup_flows (destination_credential_id);
CREATE INDEX idx_backup_flows_owner_id ON backup_flows (owner_id);
CREATE INDEX idx_backup_flows_status ON backup_flows (status);
CREATE INDEX idx_backup_flows_created_at ON backup_flows (created_at DESC);
CREATE INDEX idx_backup_flows_created_by ON backup_flows (created_by);

CREATE TABLE IF NOT EXISTS resource_shares (
    id SERIAL PRIMARY KEY,
    resource_type VARCHAR(50) NOT NULL CHECK (
        resource_type IN ('app_credential', 'backup_flow')
    ),
    resource_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(16) NOT NULL DEFAULT 'view' CHECK (
        permission IN ('view', 'edit')
    ),
    shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_resource_shares UNIQUE (resource_type, resource_id, user_id)
);

CREATE INDEX idx_resource_shares_resource ON resource_shares (resource_type, resource_id);
CREATE INDEX idx_resource_shares_user_id ON resource_shares (user_id);

CREATE TABLE IF NOT EXISTS backup_flow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL REFERENCES backup_flows(id) ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,

    execution_details JSONB,

    logs TEXT,
    error_message TEXT,

    triggered_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_backup_flow_runs_flow_id ON backup_flow_runs (flow_id);
CREATE INDEX idx_backup_flow_runs_status ON backup_flow_runs (status);
CREATE INDEX idx_backup_flow_runs_started_at ON backup_flow_runs (started_at DESC);

CREATE TRIGGER update_backup_flows_updated_at
    BEFORE UPDATE ON backup_flows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
