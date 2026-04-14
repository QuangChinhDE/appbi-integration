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
    app_id VARCHAR(50) NOT NULL UNIQUE,        -- 'request', 'workflow', ...
    app_name VARCHAR(100) NOT NULL,            -- 'Request', 'Workflow', ...
    base_url_template VARCHAR(500) NOT NULL,   -- 'https://request.{domain}/extapi/v1'
    -- Ordered list of API steps to execute when running a backup
    -- Each step describes: endpoint, method, params, pagination, extraction rules
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

-- ============================================================
-- Seed: Request app (from request.py + group.py)
-- Skipped: xlsx creation, comments/posts, file attachments
-- ============================================================
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
    refresh_token_encrypted TEXT,          -- NULL if not yet received
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
-- Create backup_flows table
CREATE TABLE IF NOT EXISTS backup_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    
    -- Source information (JSON)
    source JSONB,
    -- {
    --   "app": "request",
    --   "app_name": "Request",
    --   "domain": "company.vn",
    --   "access_token_hash": "bcrypt_hash_here"
    -- }
    
    -- Backup type
    backup_type VARCHAR(50) CHECK (backup_type IS NULL OR backup_type IN ('structured', 'unstructured', 'all')),
    
    -- Destination information (JSON)
    destination JSONB,
    -- {
    --   "type": "gdrive" | "gsheets",
    --   "name": "Google Drive" | "Google Sheets",
    --   "auth": {
    --     "email": "user@gmail.com",
    --     "refresh_token_hash": "encrypted_refresh_token"
    --   }
    -- }
    
    -- Backup structure (JSON)
    structure JSONB,
    -- {
    --   "objects": ["group", "request"],
    --   "custom_fields": ["field1", "field2"],
    --   "export_formats": {"field1": "json", "field2": "excel"}
    -- }
    
    -- Schedule information (JSON)
    schedule JSONB,
    -- {
    --   "type": "manual" | "daily" | "weekly" | "monthly",
    --   "time": "02:00",
    --   "day_of_week": 1,
    --   "day_of_month": 1,
    --   "enabled": true
    -- }
    
    -- Draft / publish flags
    is_draft SMALLINT DEFAULT 1 CHECK (is_draft IN (0, 1)),
    is_published SMALLINT DEFAULT 0 CHECK (is_published IN (0, 1)),

    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    
    -- Last run information
    last_run_at TIMESTAMP,
    last_run_status VARCHAR(20) CHECK (last_run_status IN ('completed', 'failed', 'running')),
    last_run_message TEXT,
    
    -- Audit fields
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX idx_backup_flows_app ON backup_flows ((source->>'app'));
CREATE INDEX idx_backup_flows_status ON backup_flows (status);
CREATE INDEX idx_backup_flows_created_at ON backup_flows (created_at DESC);
CREATE INDEX idx_backup_flows_created_by ON backup_flows (created_by);

-- Create backup_flow_runs table for tracking execution history
CREATE TABLE IF NOT EXISTS backup_flow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL REFERENCES backup_flows(id) ON DELETE CASCADE,
    
    -- Run information
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Execution details (JSON)
    execution_details JSONB,
    -- {
    --   "total_records": 1000,
    --   "processed_records": 1000,
    --   "failed_records": 0,
    --   "output_files": ["file1.xlsx", "file2.json"],
    --   "storage_destination": "https://drive.google.com/...",
    --   "error_messages": []
    -- }
    
    -- Logs
    logs TEXT,
    error_message TEXT,
    
    -- Audit
    triggered_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for run history
CREATE INDEX idx_backup_flow_runs_flow_id ON backup_flow_runs (flow_id);
CREATE INDEX idx_backup_flow_runs_status ON backup_flow_runs (status);
CREATE INDEX idx_backup_flow_runs_started_at ON backup_flow_runs (started_at DESC);

-- (function already created above)

-- Trigger to auto-update updated_at
CREATE TRIGGER update_backup_flows_updated_at
    BEFORE UPDATE ON backup_flows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
